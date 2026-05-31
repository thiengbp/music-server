'use strict';

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

async function scanLibrary(libraryPath) {
  const stats = await fs.stat(libraryPath);

  if (!stats.isDirectory()) {
    const err = new Error('Library path is not a directory');
    err.code = 'ENOTDIR';
    throw err;
  }

  const audioFiles = await collectAudioFiles(libraryPath);
  let inserted = 0;

  for (const filePath of audioFiles) {
    const wasInserted = await insertTrackIfMissing(filePath);

    if (wasInserted) {
      inserted += 1;
    }
  }

  return {
    scanned: audioFiles.length,
    inserted,
    skipped: audioFiles.length - inserted
  };
}

module.exports = {
  scanLibrary
};
