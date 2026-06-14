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
    duration: null,
    album_artist: null,
    genre: null,
    year: null,
    track_number: null
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

    let genre = null;
    if (Array.isArray(common.genre) && common.genre.length > 0) {
      genre = common.genre.join(', ');
    } else if (typeof common.genre === 'string') {
      genre = common.genre;
    }

    let trackNumber = null;
    if (common.track && typeof common.track.no === 'number') {
      trackNumber = common.track.no;
    }

    let year = null;
    if (typeof common.year === 'number') {
      year = common.year;
    } else if (typeof common.year === 'string') {
      const parsedYear = parseInt(common.year, 10);
      if (!isNaN(parsedYear)) year = parsedYear;
    } else if (common.date) {
      const match = String(common.date).match(/^(\d{4})/);
      if (match) {
        year = parseInt(match[1], 10);
      }
    }

    return {
      title: normalizeOptionalString(common.title) || titleFromFilePath(filePath),
      artist: normalizeOptionalString(common.artist),
      album: normalizeOptionalString(common.album),
      duration: normalizeDuration(format.duration),
      
      // Basic Metadata
      album_artist: normalizeOptionalString(common.albumartist),
      genre: normalizeOptionalString(genre),
      year: year,
      track_number: trackNumber,
      
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
