'use strict';

const path = require('path');

function titleFromFilePath(filePath) {
  return path.basename(filePath, path.extname(filePath));
}

function normalizeOptionalString(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
}

function normalizeDuration(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }

  return Math.round(value);
}

function fallbackMetadata(filePath) {
  return {
    title: titleFromFilePath(filePath),
    artist: null,
    album: null,
    duration: null
  };
}

async function readMetadata(filePath) {
  try {
    const { parseFile } = await import('music-metadata');
    const metadata = await parseFile(filePath);
    const common = metadata.common || {};
    const format = metadata.format || {};

    return {
      title: normalizeOptionalString(common.title) || titleFromFilePath(filePath),
      artist: normalizeOptionalString(common.artist),
      album: normalizeOptionalString(common.album),
      duration: normalizeDuration(format.duration)
    };
  } catch (err) {
    return fallbackMetadata(filePath);
  }
}

module.exports = {
  readMetadata
};
