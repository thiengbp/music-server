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

async function listRecentlyPlayed(req, res) {
  try {
    const tracks = await dbAll(`
      SELECT
        ph.id AS play_id,
        ph.played_at,
        t.id,
        t.title,
        t.artist,
        t.album,
        t.file_path,
        t.duration,
        t.created_at,
        CASE WHEN f.track_id IS NULL THEN 0 ELSE 1 END AS is_favorite
      FROM play_history ph
      JOIN tracks t ON t.id = ph.track_id
      LEFT JOIN favorites f ON f.track_id = t.id
      ORDER BY ph.played_at DESC, ph.id DESC
      LIMIT 20
    `);

    return res.json({
      tracks: tracks.map((track) => ({
        ...track,
        is_favorite: Boolean(track.is_favorite)
      }))
    });
  } catch (err) {
    return res.status(500).json({
      error: 'Failed to load recently played',
      message: err.message
    });
  }
}

module.exports = {
  listRecentlyPlayed
};
