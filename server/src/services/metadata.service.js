const path = require('path');
const fs = require('fs/promises');

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

    let fileSize = null;
    try {
      const stats = await fs.stat(filePath);
      fileSize = stats.size;
    } catch (statErr) {
      console.warn(`Failed to stat file ${filePath}:`, statErr.message);
    }

    return {
      title: normalizeOptionalString(common.title) || titleFromFilePath(filePath),
      artist: normalizeOptionalString(common.artist),
      album: normalizeOptionalString(common.album),
      duration: normalizeDuration(format.duration),
      
      // Technical Metadata
      bitrate: format.bitrate ? Math.round(format.bitrate) : null,
      sample_rate: format.sampleRate ? Math.round(format.sampleRate) : null,
      bit_depth: format.bitsPerSample ? Math.round(format.bitsPerSample) : null,
      codec: format.codec || null,
      container: format.container || null,
      channels: format.numberOfChannels || format.channels || null,
      file_size: fileSize
    };
  } catch (err) {
    const fallback = fallbackMetadata(filePath);
    let fileSize = null;
    try {
      const stats = await fs.stat(filePath);
      fileSize = stats.size;
    } catch (statErr) {}
    return {
      ...fallback,
      bitrate: null,
      sample_rate: null,
      bit_depth: null,
      codec: null,
      container: null,
      channels: null,
      file_size: fileSize
    };
  }
}

module.exports = {
  readMetadata
};
