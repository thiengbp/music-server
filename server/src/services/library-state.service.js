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

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
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

async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await dbRun('PRAGMA foreign_keys = ON');
      await dbRun(`
        CREATE TABLE IF NOT EXISTS playlists (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await dbRun(`
        CREATE TABLE IF NOT EXISTS playlist_tracks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          playlist_id INTEGER NOT NULL,
          track_id INTEGER NOT NULL,
          position INTEGER NOT NULL DEFAULT 0,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(playlist_id, track_id),
          FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
          FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
        )
      `);
      await dbRun(`
        CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist_position
        ON playlist_tracks (playlist_id, position, id)
      `);
      await dbRun(`
        CREATE INDEX IF NOT EXISTS idx_playlist_tracks_track_id
        ON playlist_tracks (track_id)
      `);
      await dbRun(`
        CREATE TABLE IF NOT EXISTS queue_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          track_id INTEGER NOT NULL,
          position INTEGER NOT NULL DEFAULT 0,
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
        )
      `);
      await dbRun(`
        CREATE INDEX IF NOT EXISTS idx_queue_items_position
        ON queue_items (position, id)
      `);
      await dbRun(`
        CREATE INDEX IF NOT EXISTS idx_queue_items_track_id
        ON queue_items (track_id)
      `);
      await dbRun(`
        CREATE TABLE IF NOT EXISTS queue_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          current_track_id INTEGER,
          repeat_mode TEXT DEFAULT 'off',
          shuffle_enabled INTEGER DEFAULT 0,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (current_track_id) REFERENCES tracks(id) ON DELETE SET NULL
        )
      `);
      await dbRun('INSERT OR IGNORE INTO queue_state (id) VALUES (1)');
    })();
  }

  return schemaPromise;
}

function normalizeTrack(track) {
  if (!track) {
    return null;
  }

  return {
    ...track,
    is_favorite: Boolean(track.is_favorite)
  };
}

function normalizePlaylistRow(row) {
  if (!row) {
    return null;
  }

  const trackCount = Number(row.trackCount || 0);

  return {
    id: row.id,
    name: row.name,
    trackCount,
    cover_track_id: row.cover_track_id || null,
    cover: row.cover_track_id ? `/tracks/${row.cover_track_id}/cover` : null,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function parsePositiveInteger(value) {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

async function findTrack(trackId) {
  await ensureSchema();

  return dbGet('SELECT id FROM tracks WHERE id = ?', [trackId]);
}

async function findPlaylist(playlistId) {
  await ensureSchema();

  return dbGet('SELECT id, name, created_at, updated_at FROM playlists WHERE id = ?', [playlistId]);
}

async function listPlaylists() {
  await ensureSchema();

  const rows = await dbAll(`
    SELECT
      p.id,
      p.name,
      p.created_at,
      p.updated_at,
      COUNT(pt.track_id) AS trackCount,
      (
        SELECT pt_cover.track_id
        FROM playlist_tracks pt_cover
        WHERE pt_cover.playlist_id = p.id
        ORDER BY pt_cover.position ASC, pt_cover.id ASC
        LIMIT 1
      ) AS cover_track_id
    FROM playlists p
    LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
    GROUP BY p.id
    ORDER BY p.updated_at DESC, p.id DESC
  `);

  return rows.map(normalizePlaylistRow);
}

async function getPlaylistTracks(playlistId) {
  await ensureSchema();

  const tracks = await dbAll(`
    SELECT
      pt.position,
      t.id,
      t.title,
      t.artist,
      t.album,
      t.file_path,
      t.duration,
      t.created_at,
      CASE WHEN f.track_id IS NULL THEN 0 ELSE 1 END AS is_favorite
    FROM playlist_tracks pt
    JOIN tracks t ON t.id = pt.track_id
    LEFT JOIN favorites f ON f.track_id = t.id
    WHERE pt.playlist_id = ?
    ORDER BY pt.position ASC, pt.id ASC
  `, [playlistId]);

  return tracks.map(normalizeTrack);
}

async function getPlaylist(playlistId) {
  await ensureSchema();

  const playlist = await findPlaylist(playlistId);

  if (!playlist) {
    return null;
  }

  const tracks = await getPlaylistTracks(playlistId);

  return {
    ...playlist,
    trackCount: tracks.length,
    cover_track_id: tracks[0] ? tracks[0].id : null,
    cover: tracks[0] ? `/tracks/${tracks[0].id}/cover` : null,
    tracks
  };
}

async function createPlaylist(name) {
  await ensureSchema();

  const result = await dbRun(`
    INSERT INTO playlists (name)
    VALUES (?)
  `, [name]);

  return getPlaylist(result.id);
}

async function updatePlaylist(playlistId, name) {
  await ensureSchema();

  await dbRun(`
    UPDATE playlists
    SET name = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [name, playlistId]);

  return getPlaylist(playlistId);
}

async function deletePlaylist(playlistId) {
  await ensureSchema();

  const result = await dbRun('DELETE FROM playlists WHERE id = ?', [playlistId]);

  return result.changes;
}

async function addTrackToPlaylist(playlistId, trackId) {
  await ensureSchema();

  const playlist = await findPlaylist(playlistId);

  if (!playlist) {
    const err = new Error('Playlist not found');
    err.code = 'PLAYLIST_NOT_FOUND';
    throw err;
  }

  const track = await findTrack(trackId);

  if (!track) {
    const err = new Error('Track not found');
    err.code = 'TRACK_NOT_FOUND';
    throw err;
  }

  const positionRow = await dbGet(`
    SELECT COALESCE(MAX(position), -1) + 1 AS position
    FROM playlist_tracks
    WHERE playlist_id = ?
  `, [playlistId]);

  await dbRun(`
    INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position)
    VALUES (?, ?, ?)
  `, [playlistId, trackId, positionRow.position]);
  await dbRun('UPDATE playlists SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [playlistId]);

  return getPlaylist(playlistId);
}

async function removeTrackFromPlaylist(playlistId, trackId) {
  await ensureSchema();

  const playlist = await findPlaylist(playlistId);

  if (!playlist) {
    const err = new Error('Playlist not found');
    err.code = 'PLAYLIST_NOT_FOUND';
    throw err;
  }

  await dbRun(`
    DELETE FROM playlist_tracks
    WHERE playlist_id = ? AND track_id = ?
  `, [playlistId, trackId]);
  await dbRun('UPDATE playlists SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [playlistId]);

  return getPlaylist(playlistId);
}

async function replacePlaylistTracks(playlistId, trackIds) {
  await ensureSchema();

  const playlist = await findPlaylist(playlistId);

  if (!playlist) {
    const err = new Error('Playlist not found');
    err.code = 'PLAYLIST_NOT_FOUND';
    throw err;
  }

  const uniqueTrackIds = [];
  const seenTrackIds = new Set();

  for (const trackId of trackIds) {
    if (seenTrackIds.has(trackId)) {
      continue;
    }

    const track = await findTrack(trackId);

    if (track) {
      seenTrackIds.add(trackId);
      uniqueTrackIds.push(trackId);
    }
  }

  await dbRun('BEGIN IMMEDIATE TRANSACTION');

  try {
    await dbRun('DELETE FROM playlist_tracks WHERE playlist_id = ?', [playlistId]);

    for (let index = 0; index < uniqueTrackIds.length; index += 1) {
      await dbRun(`
        INSERT INTO playlist_tracks (playlist_id, track_id, position)
        VALUES (?, ?, ?)
      `, [playlistId, uniqueTrackIds[index], index]);
    }

    await dbRun('UPDATE playlists SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [playlistId]);
    await dbRun('COMMIT');
  } catch (err) {
    await dbRun('ROLLBACK').catch(() => {});
    throw err;
  }

  return getPlaylist(playlistId);
}

async function getQueueItems() {
  await ensureSchema();

  const rows = await dbAll(`
    SELECT
      qi.id AS queue_item_id,
      qi.position,
      t.id,
      t.title,
      t.artist,
      t.album,
      t.file_path,
      t.duration,
      t.created_at,
      CASE WHEN f.track_id IS NULL THEN 0 ELSE 1 END AS is_favorite
    FROM queue_items qi
    JOIN tracks t ON t.id = qi.track_id
    LEFT JOIN favorites f ON f.track_id = t.id
    ORDER BY qi.position ASC, qi.id ASC
  `);

  return rows.map((row) => ({
    id: row.queue_item_id,
    position: row.position,
    track: normalizeTrack({
      id: row.id,
      title: row.title,
      artist: row.artist,
      album: row.album,
      file_path: row.file_path,
      duration: row.duration,
      created_at: row.created_at,
      is_favorite: row.is_favorite
    })
  }));
}

async function getQueue() {
  await ensureSchema();

  const state = await dbGet(`
    SELECT current_track_id, repeat_mode, shuffle_enabled, updated_at
    FROM queue_state
    WHERE id = 1
  `);

  return {
    currentTrackId: state && state.current_track_id ? state.current_track_id : null,
    repeatMode: state && state.repeat_mode ? state.repeat_mode : 'off',
    shuffleEnabled: Boolean(state && state.shuffle_enabled),
    updated_at: state ? state.updated_at : null,
    items: await getQueueItems()
  };
}

async function replaceQueue(trackIds, state = {}) {
  await ensureSchema();

  const validTrackIds = [];

  for (const trackId of trackIds) {
    const track = await findTrack(trackId);

    if (track) {
      validTrackIds.push(trackId);
    }
  }

  await dbRun('BEGIN IMMEDIATE TRANSACTION');

  try {
    await dbRun('DELETE FROM queue_items');

    for (let index = 0; index < validTrackIds.length; index += 1) {
      await dbRun(`
        INSERT INTO queue_items (track_id, position)
        VALUES (?, ?)
      `, [validTrackIds[index], index]);
    }

    await dbRun(`
      UPDATE queue_state
      SET
        current_track_id = ?,
        repeat_mode = ?,
        shuffle_enabled = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `, [
      state.currentTrackId || null,
      state.repeatMode || 'off',
      state.shuffleEnabled ? 1 : 0
    ]);

    await dbRun('COMMIT');
  } catch (err) {
    await dbRun('ROLLBACK').catch(() => {});
    throw err;
  }

  return getQueue();
}

async function addQueueItem(trackId) {
  await ensureSchema();

  const track = await findTrack(trackId);

  if (!track) {
    const err = new Error('Track not found');
    err.code = 'TRACK_NOT_FOUND';
    throw err;
  }

  const positionRow = await dbGet('SELECT COALESCE(MAX(position), -1) + 1 AS position FROM queue_items');

  await dbRun(`
    INSERT INTO queue_items (track_id, position)
    VALUES (?, ?)
  `, [trackId, positionRow.position]);

  return getQueue();
}

async function removeQueueItem(itemOrTrackId) {
  await ensureSchema();

  const queueItem = await dbGet(`
    SELECT id
    FROM queue_items
    WHERE id = ? OR track_id = ?
    ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, position ASC, id ASC
    LIMIT 1
  `, [itemOrTrackId, itemOrTrackId, itemOrTrackId]);

  if (!queueItem) {
    return getQueue();
  }

  await dbRun('DELETE FROM queue_items WHERE id = ?', [queueItem.id]);

  return getQueue();
}

async function clearQueue() {
  await ensureSchema();

  await dbRun('DELETE FROM queue_items');
  await dbRun(`
    UPDATE queue_state
    SET updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `);

  return getQueue();
}

module.exports = {
  parsePositiveInteger,
  ensureSchema,
  listPlaylists,
  getPlaylist,
  createPlaylist,
  updatePlaylist,
  deletePlaylist,
  addTrackToPlaylist,
  removeTrackFromPlaylist,
  replacePlaylistTracks,
  getQueue,
  replaceQueue,
  addQueueItem,
  removeQueueItem,
  clearQueue
};
