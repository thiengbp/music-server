'use strict';

const db = require('../config/database');

const CACHE_MAX_AGE_SECONDS = 86400;
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png']);

function createHttpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
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

async function readEmbeddedCover(filePath) {
  const { parseFile } = await import('music-metadata');
  const metadata = await parseFile(filePath);
  const pictures = metadata.common && Array.isArray(metadata.common.picture)
    ? metadata.common.picture
    : [];

  return pictures.find((picture) => {
    return picture && SUPPORTED_IMAGE_TYPES.has(picture.format) && picture.data;
  });
}

async function getTrackCover(trackId) {
  const track = await findTrackById(trackId);

  if (!track) {
    throw createHttpError(404, 'Track not found');
  }

  let picture;

  try {
    picture = await readEmbeddedCover(track.file_path);
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw createHttpError(404, 'Audio file not found');
    }

    throw err;
  }

  if (!picture) {
    throw createHttpError(404, 'Cover not found');
  }

  return {
    data: picture.data,
    contentType: picture.format,
    cacheControl: `public, max-age=${CACHE_MAX_AGE_SECONDS}`
  };
}

module.exports = {
  getTrackCover
};
