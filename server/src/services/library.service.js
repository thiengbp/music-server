'use strict';

const fsSync = require('fs');
const fs = require('fs/promises');
const path = require('path');
const db = require('../config/database');
const metadataService = require('./metadata.service');

const AUDIO_EXTENSIONS = new Set(['.mp3', '.flac', '.m4a', '.wav']);

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve({
        id: this.lastID,
        changes: this.changes
      });
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function isAudioFile(filePath) {
  return AUDIO_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

async function collectAudioFiles(directoryPath) {
  const entries = await fs.readdir(directoryPath, {
    withFileTypes: true
  });

  const audioFiles = [];

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      const nestedAudioFiles = await collectAudioFiles(entryPath);
      audioFiles.push(...nestedAudioFiles);
      continue;
    }

    if (entry.isFile() && isAudioFile(entryPath)) {
      audioFiles.push(entryPath);
    }
  }

  return audioFiles;
}

async function processTrackScan(filePath) {
  // 1. Check if track already exists in database
  const existing = await dbGet(`
    SELECT id, bitrate, sample_rate, bit_depth, codec, container, channels, file_size, metadata_source,
           album_artist, genre, year, track_number, metadata_updated_at
    FROM tracks
    WHERE file_path = ?
  `, [filePath]);

  if (!existing) {
    // New track, perform insertion with full metadata
    const metadata = await metadataService.readMetadata(filePath);
    await dbRun(`
      INSERT INTO tracks (
        title,
        artist,
        album,
        file_path,
        duration,
        bitrate,
        sample_rate,
        bit_depth,
        codec,
        container,
        channels,
        file_size,
        album_artist,
        genre,
        year,
        track_number,
        metadata_source,
        metadata_updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'file', CURRENT_TIMESTAMP)
    `, [
      metadata.title,
      metadata.artist,
      metadata.album,
      filePath,
      metadata.duration,
      metadata.bitrate,
      metadata.sample_rate,
      metadata.bit_depth,
      metadata.codec,
      metadata.container,
      metadata.channels,
      metadata.file_size,
      metadata.album_artist,
      metadata.genre,
      metadata.year,
      metadata.track_number
    ]);
    return { status: 'inserted' };
  }

  // Track exists, check if we need to update/backfill technical metadata or new basic metadata
  const hasNullTechnicalField =
    existing.bitrate === null ||
    existing.sample_rate === null ||
    existing.bit_depth === null ||
    existing.codec === null ||
    existing.container === null ||
    existing.channels === null ||
    existing.file_size === null;

  const isFromFile = existing.metadata_source === 'file';
  
  // Backfill basic metadata if the file is the source and we have never performed a backfill (metadata_updated_at is null)
  const needBasicBackfill = isFromFile && existing.metadata_updated_at === null;

  const needUpdate = hasNullTechnicalField || needBasicBackfill;

  if (needUpdate) {
    const metadata = await metadataService.readMetadata(filePath);
    
    if (isFromFile) {
      // If it is 'file' source, we can safely backfill basic metadata if they are null in DB
      await dbRun(`
        UPDATE tracks SET
          bitrate = CASE WHEN bitrate IS NULL THEN ? ELSE bitrate END,
          sample_rate = CASE WHEN sample_rate IS NULL THEN ? ELSE sample_rate END,
          bit_depth = CASE WHEN bit_depth IS NULL THEN ? ELSE bit_depth END,
          codec = CASE WHEN codec IS NULL THEN ? ELSE codec END,
          container = CASE WHEN container IS NULL THEN ? ELSE container END,
          channels = CASE WHEN channels IS NULL THEN ? ELSE channels END,
          file_size = CASE WHEN file_size IS NULL THEN ? ELSE file_size END,
          album_artist = CASE WHEN album_artist IS NULL THEN ? ELSE album_artist END,
          genre = CASE WHEN genre IS NULL THEN ? ELSE genre END,
          year = CASE WHEN year IS NULL THEN ? ELSE year END,
          track_number = CASE WHEN track_number IS NULL THEN ? ELSE track_number END,
          metadata_updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `, [
        metadata.bitrate,
        metadata.sample_rate,
        metadata.bit_depth,
        metadata.codec,
        metadata.container,
        metadata.channels,
        metadata.file_size,
        metadata.album_artist,
        metadata.genre,
        metadata.year,
        metadata.track_number,
        existing.id
      ]);
      return { status: 'updated' };
    } else {
      // If it is 'database' (user edited), NEVER overwrite basic metadata fields.
      // Only backfill technical metadata if they are NULL.
      await dbRun(`
        UPDATE tracks SET
          bitrate = CASE WHEN bitrate IS NULL THEN ? ELSE bitrate END,
          sample_rate = CASE WHEN sample_rate IS NULL THEN ? ELSE sample_rate END,
          bit_depth = CASE WHEN bit_depth IS NULL THEN ? ELSE bit_depth END,
          codec = CASE WHEN codec IS NULL THEN ? ELSE codec END,
          container = CASE WHEN container IS NULL THEN ? ELSE container END,
          channels = CASE WHEN channels IS NULL THEN ? ELSE channels END,
          file_size = CASE WHEN file_size IS NULL THEN ? ELSE file_size END
        WHERE id = ?
      `, [
        metadata.bitrate,
        metadata.sample_rate,
        metadata.bit_depth,
        metadata.codec,
        metadata.container,
        metadata.channels,
        metadata.file_size,
        existing.id
      ]);
      return { status: 'updated' };
    }
  }

  return { status: 'skipped' };
}

function isPathInsideRoot(filePath, libraryRoot) {
  const relativePath = path.relative(libraryRoot, filePath);

  return relativePath === '' || (
    relativePath !== '..' &&
    !relativePath.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativePath)
  );
}

async function deleteTrackIds(trackIds) {
  if (trackIds.length === 0) {
    return 0;
  }

  await dbRun('BEGIN IMMEDIATE TRANSACTION');

  try {
    let removed = 0;

    for (let index = 0; index < trackIds.length; index += 500) {
      const chunk = trackIds.slice(index, index + 500);
      const placeholders = chunk.map(() => '?').join(', ');

      await dbRun(`DELETE FROM favorites WHERE track_id IN (${placeholders})`, chunk);
      await dbRun(`DELETE FROM play_history WHERE track_id IN (${placeholders})`, chunk);
      await dbRun(`DELETE FROM playlist_tracks WHERE track_id IN (${placeholders})`, chunk).catch((err) => {
        if (!err.message.includes('no such table')) throw err;
      });
      await dbRun(`DELETE FROM queue_items WHERE track_id IN (${placeholders})`, chunk).catch((err) => {
        if (!err.message.includes('no such table')) throw err;
      });
      await dbRun(`UPDATE queue_state SET current_track_id = NULL WHERE current_track_id IN (${placeholders})`, chunk).catch((err) => {
        if (!err.message.includes('no such table')) throw err;
      });
      const result = await dbRun(`DELETE FROM tracks WHERE id IN (${placeholders})`, chunk);
      removed += result.changes;
    }

    await dbRun('COMMIT');
    return removed;
  } catch (err) {
    await dbRun('ROLLBACK').catch(() => {});
    throw err;
  }
}

async function removeOrphanTracks(libraryRoot, discoveredPaths) {
  const tracks = await dbAll('SELECT id, file_path FROM tracks');
  const orphanTrackIds = tracks
    .filter((track) => {
      if (typeof track.file_path !== 'string' || !track.file_path.trim()) {
        return true;
      }

      const trackPath = path.resolve(track.file_path);
      const fileExists = fsSync.existsSync(trackPath);

      if (!isPathInsideRoot(trackPath, libraryRoot)) {
        return true;
      }

      return !fileExists || !discoveredPaths.has(trackPath);
    })
    .map((track) => track.id);

  return deleteTrackIds(orphanTrackIds);
}

async function scanLibrary(libraryPath) {
  const libraryRoot = path.resolve(libraryPath);
  const stats = await fs.stat(libraryRoot);

  if (!stats.isDirectory()) {
    const err = new Error('Library path is not a directory');
    err.code = 'ENOTDIR';
    throw err;
  }

  const audioFiles = (await collectAudioFiles(libraryRoot)).map((filePath) => path.resolve(filePath));
  const discoveredPaths = new Set(audioFiles);
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const filePath of audioFiles) {
    const scanResult = await processTrackScan(filePath);

    if (scanResult.status === 'inserted') {
      inserted += 1;
    } else if (scanResult.status === 'updated') {
      updated += 1;
    } else {
      skipped += 1;
    }
  }

  const removed = await removeOrphanTracks(libraryRoot, discoveredPaths);
  console.log(`Library scan cleanup completed: removed=${removed}`);

  return {
    scanned: audioFiles.length,
    inserted,
    updated,
    skipped,
    removed
  };
}

module.exports = {
  scanLibrary
};
