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

module.exports = {
  listTracks
};
