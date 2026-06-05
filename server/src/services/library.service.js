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

async function insertTrackIfMissing(filePath) {
  const metadata = await metadataService.readMetadata(filePath);

  const result = await dbRun(`
    INSERT OR IGNORE INTO tracks (
      title,
      artist,
      album,
      file_path,
      duration
    ) VALUES (?, ?, ?, ?, ?)
  `, [
    metadata.title,
    metadata.artist,
    metadata.album,
    filePath,
    metadata.duration
  ]);

  return result.changes === 1;
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

  for (const filePath of audioFiles) {
    const wasInserted = await insertTrackIfMissing(filePath);

    if (wasInserted) {
      inserted += 1;
    }
  }

  const removed = await removeOrphanTracks(libraryRoot, discoveredPaths);
  console.log(`Library scan cleanup completed: removed=${removed}`);

  return {
    scanned: audioFiles.length,
    inserted,
    skipped: audioFiles.length - inserted,
    removed
  };
}

module.exports = {
  scanLibrary
};
