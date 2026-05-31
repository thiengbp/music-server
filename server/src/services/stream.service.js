'use strict';

const fs = require('fs');
const fsPromises = require('fs/promises');
const path = require('path');
const db = require('../config/database');

const CONTENT_TYPES = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav'
};

function createHttpError(statusCode, message, headers) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.headers = headers;
  return err;
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

async function findTrackById(trackId) {
  return dbGet(`
    SELECT
      id,
      file_path
    FROM tracks
    WHERE id = ?
  `, [trackId]);
}

function getContentType(filePath) {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()];
}

function parseRangeHeader(rangeHeader, fileSize) {
  if (!rangeHeader) {
    return null;
  }

  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);

  if (!match) {
    throw createHttpError(416, 'Invalid range', {
      'Content-Range': `bytes */${fileSize}`
    });
  }

  const [, startValue, endValue] = match;

  if (startValue === '' && endValue === '') {
    throw createHttpError(416, 'Invalid range', {
      'Content-Range': `bytes */${fileSize}`
    });
  }

  let start;
  let end;

  if (startValue === '') {
    const suffixLength = Number(endValue);

    if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
      throw createHttpError(416, 'Invalid range', {
        'Content-Range': `bytes */${fileSize}`
      });
    }

    start = Math.max(fileSize - suffixLength, 0);
    end = fileSize - 1;
  } else {
    start = Number(startValue);
    end = endValue === '' ? fileSize - 1 : Number(endValue);
  }

  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    start >= fileSize
  ) {
    throw createHttpError(416, 'Invalid range', {
      'Content-Range': `bytes */${fileSize}`
    });
  }

  return {
    start,
    end: Math.min(end, fileSize - 1)
  };
}

async function createTrackStream(trackId, rangeHeader) {
  const track = await findTrackById(trackId);

  if (!track) {
    throw createHttpError(404, 'Track not found');
  }

  const contentType = getContentType(track.file_path);

  if (!contentType) {
    throw createHttpError(415, 'Unsupported audio format');
  }

  let stats;

  try {
    stats = await fsPromises.stat(track.file_path);
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw createHttpError(404, 'Audio file not found');
    }

    throw err;
  }

  if (!stats.isFile()) {
    throw createHttpError(404, 'Audio file not found');
  }

  const fileSize = stats.size;
  const range = parseRangeHeader(rangeHeader, fileSize);

  if (range) {
    const chunkSize = range.end - range.start + 1;

    return {
      statusCode: 206,
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Type': contentType,
        'Content-Length': chunkSize,
        'Content-Range': `bytes ${range.start}-${range.end}/${fileSize}`
      },
      stream: fs.createReadStream(track.file_path, {
        start: range.start,
        end: range.end
      })
    };
  }

  return {
    statusCode: 200,
    headers: {
      'Accept-Ranges': 'bytes',
      'Content-Type': contentType,
      'Content-Length': fileSize
    },
    stream: fs.createReadStream(track.file_path)
  };
}

module.exports = {
  createTrackStream
};
