'use strict';

const db = require('../config/database');

const CACHE_MAX_AGE_SECONDS = 86400;
const SUPPORTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png']);
const FALLBACK_COVER_SVG = Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
  <rect width="96" height="96" rx="18" fill="#2b2529"/>
  <path d="M40 24v34.5A10.5 10.5 0 1 1 32 48V30l36-8v32.5A10.5 10.5 0 1 1 60 44V28.5z" fill="#ff2d55"/>
</svg>
`.trim());

function fallbackCover() {
  return {
    data: FALLBACK_COVER_SVG,
    contentType: 'image/svg+xml',
    cacheControl: `public, max-age=${CACHE_MAX_AGE_SECONDS}`
  };
}

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
    return fallbackCover();
  }

  if (!picture) {
    return fallbackCover();
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
