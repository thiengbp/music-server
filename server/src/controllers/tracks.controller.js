'use strict';

const db = require('../config/database');

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

function parseTrackId(id) {
  const trackId = Number(id);

  if (!Number.isInteger(trackId) || trackId <= 0) {
    return null;
  }

  return trackId;
}

async function listTracks(req, res) {
  try {
    const tracks = await dbAll(`
      SELECT
        id,
        title,
        artist,
        album,
        file_path,
        duration,
        created_at
      FROM tracks
      ORDER BY created_at DESC, id DESC
    `);

    res.json({ tracks });
  } catch (err) {
    res.status(500).json({
      error: 'Failed to load tracks',
      message: err.message
    });
  }
}

async function getTrackById(req, res) {
  const trackId = parseTrackId(req.params.id);

  if (!trackId) {
    return res.status(400).json({
      error: 'Invalid track id'
    });
  }

  try {
    const track = await dbGet(`
      SELECT
        id,
        title,
        artist,
        album,
        file_path,
        duration,
        created_at
      FROM tracks
      WHERE id = ?
    `, [trackId]);

    if (!track) {
      return res.status(404).json({
        error: 'Track not found'
      });
    }

    return res.json({ track });
  } catch (err) {
    return res.status(500).json({
      error: 'Failed to load track',
      message: err.message
    });
  }
}

module.exports = {
  listTracks,
  getTrackById
};
