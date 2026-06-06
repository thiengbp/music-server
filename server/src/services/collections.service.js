'use strict';

const db = require('../config/database');

let schemaPromise = null;

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

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

async function addColumnIfMissing(sql) {
  try {
    await dbRun(sql);
  } catch (err) {
    if (!err.message.includes('duplicate column name')) {
      throw err;
    }
  }
}

async function ensureListeningStatsSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await addColumnIfMissing('ALTER TABLE tracks ADD COLUMN play_count INTEGER NOT NULL DEFAULT 0');
      await addColumnIfMissing('ALTER TABLE tracks ADD COLUMN last_played_at TEXT');
      await dbRun(`
        CREATE INDEX IF NOT EXISTS idx_tracks_play_count
        ON tracks (play_count DESC, last_played_at DESC)
      `);
      await dbRun(`
        CREATE INDEX IF NOT EXISTS idx_tracks_last_played_at
        ON tracks (last_played_at DESC)
      `);
    })();
  }

  return schemaPromise;
}

function normalizeTrack(track) {
  return {
    ...track,
    is_favorite: Boolean(track.is_favorite),
    play_count: Number(track.play_count || 0)
  };
}

async function trackRows(whereSql, params = [], orderSql = 'ORDER BY t.created_at DESC, t.id DESC', limit = 50) {
  await ensureListeningStatsSchema();

  const rows = await dbAll(`
    SELECT
      t.id,
      t.title,
      t.artist,
      t.album,
      t.file_path,
      t.duration,
      t.created_at,
      t.play_count,
      t.last_played_at,
      CASE WHEN f.track_id IS NULL THEN 0 ELSE 1 END AS is_favorite
    FROM tracks t
    LEFT JOIN favorites f ON f.track_id = t.id
    ${whereSql}
    ${orderSql}
    LIMIT ?
  `, [...params, limit]);

  return rows.map(normalizeTrack);
}

async function listCollections() {
  await ensureListeningStatsSchema();

  const [
    totalTracks,
    favoriteTracks,
    playedTracks,
    albumCount,
    artistCount
  ] = await Promise.all([
    dbAll('SELECT COUNT(*) AS count FROM tracks'),
    dbAll('SELECT COUNT(*) AS count FROM favorites'),
    dbAll('SELECT COUNT(*) AS count FROM tracks WHERE play_count > 0'),
    dbAll("SELECT COUNT(DISTINCT COALESCE(NULLIF(TRIM(album), ''), 'Unknown album')) AS count FROM tracks"),
    dbAll("SELECT COUNT(DISTINCT COALESCE(NULLIF(TRIM(artist), ''), 'Unknown artist')) AS count FROM tracks")
  ]);

  return [
    {
      id: 'most-played',
      title: 'Most Played',
      description: 'Tracks you play the most.',
      count: playedTracks[0].count
    },
    {
      id: 'recently-played',
      title: 'Recently Played',
      description: 'Tracks played most recently.',
      count: playedTracks[0].count
    },
    {
      id: 'recently-added',
      title: 'Recently Added',
      description: 'Newest tracks in the library.',
      count: totalTracks[0].count
    },
    {
      id: 'favorites',
      title: 'Favorites',
      description: 'Your favorite tracks.',
      count: favoriteTracks[0].count
    },
    {
      id: 'library-health',
      title: 'Library Health',
      description: `${totalTracks[0].count} tracks · ${albumCount[0].count} albums · ${artistCount[0].count} artists`,
      count: totalTracks[0].count
    }
  ];
}

async function getCollection(collectionId) {
  if (collectionId === 'most-played') {
    return {
      id: collectionId,
      title: 'Most Played',
      tracks: await trackRows(
        'WHERE t.play_count > 0',
        [],
        'ORDER BY t.play_count DESC, t.last_played_at DESC, t.title ASC',
        100
      )
    };
  }

  if (collectionId === 'recently-played') {
    return {
      id: collectionId,
      title: 'Recently Played',
      tracks: await trackRows(
        'WHERE t.last_played_at IS NOT NULL',
        [],
        'ORDER BY t.last_played_at DESC, t.play_count DESC',
        100
      )
    };
  }

  if (collectionId === 'recently-added') {
    return {
      id: collectionId,
      title: 'Recently Added',
      tracks: await trackRows('', [], 'ORDER BY t.created_at DESC, t.id DESC', 100)
    };
  }

  if (collectionId === 'favorites') {
    return {
      id: collectionId,
      title: 'Favorites',
      tracks: await trackRows('WHERE f.track_id IS NOT NULL', [], 'ORDER BY f.created_at DESC', 100)
    };
  }

  if (collectionId === 'library-health') {
    return {
      id: collectionId,
      title: 'Library Health',
      tracks: await trackRows('', [], 'ORDER BY t.created_at DESC, t.id DESC', 20)
    };
  }

  return null;
}

module.exports = {
  ensureListeningStatsSchema,
  listCollections,
  getCollection
};
