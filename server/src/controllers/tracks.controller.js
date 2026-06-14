'use strict';

const db = require('../config/database');
const collectionsService = require('../services/collections.service');

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

function parseTrackId(id) {
  const trackId = Number(id);

  if (!Number.isInteger(trackId) || trackId <= 0) {
    return null;
  }

  return trackId;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeOptionalString(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : null;
}

function validateCreateTrackPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return null;
  }

  if (!isNonEmptyString(body.title) || !isNonEmptyString(body.file_path)) {
    return null;
  }

  const artist = normalizeOptionalString(body.artist);
  const album = normalizeOptionalString(body.album);

  if (artist === undefined || album === undefined) {
    return null;
  }

  if (
    body.duration !== undefined &&
    (!Number.isInteger(body.duration) || body.duration < 0)
  ) {
    return null;
  }

  return {
    title: body.title.trim(),
    artist,
    album,
    file_path: body.file_path.trim(),
    duration: body.duration === undefined ? null : body.duration
  };
}

function parseLimit(value) {
  const defaultMaxLimit = 1000;
  const envMaxLimit = process.env.TRACKS_MAX_LIMIT ? Number(process.env.TRACKS_MAX_LIMIT) : defaultMaxLimit;
  const maxLimit = Number.isInteger(envMaxLimit) && envMaxLimit > 0 ? envMaxLimit : defaultMaxLimit;

  if (value === undefined) {
    return 50;
  }

  const limit = Number(value);

  if (!Number.isInteger(limit) || limit <= 0) {
    return null;
  }

  return Math.min(limit, maxLimit);
}

function parseOffset(value) {
  if (value === undefined) {
    return 0;
  }

  const offset = Number(value);

  if (!Number.isInteger(offset) || offset < 0) {
    return null;
  }

  return offset;
}

function addTextFilter(whereClauses, params, column, value) {
  if (!isNonEmptyString(value)) {
    return;
  }

  whereClauses.push(`${column} LIKE ?`);
  params.push(`%${value.trim()}%`);
}

function buildTrackListQuery(query) {
  const whereClauses = [];
  const params = [];

  if (isNonEmptyString(query.search)) {
    const searchValue = `%${query.search.trim()}%`;
    whereClauses.push('(t.title LIKE ? OR t.artist LIKE ? OR t.album LIKE ?)');
    params.push(searchValue, searchValue, searchValue);
  }

  addTextFilter(whereClauses, params, 't.artist', query.artist);
  addTextFilter(whereClauses, params, 't.album', query.album);

  if (query.favorite === 'true') {
    whereClauses.push('f.track_id IS NOT NULL');
  }

  const whereSql = whereClauses.length > 0
    ? `WHERE ${whereClauses.join(' AND ')}`
    : '';

  return {
    whereSql,
    params
  };
}

function normalizeTrack(track) {
  if (!track) {
    return null;
  }

  return {
    ...track,
    play_count: Number(track.play_count || 0),
    is_favorite: Boolean(track.is_favorite)
  };
}

async function findTrackById(trackId) {
  await collectionsService.ensureListeningStatsSchema();

  const track = await dbGet(`
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
      t.bitrate,
      t.sample_rate,
      t.bit_depth,
      t.codec,
      t.container,
      t.channels,
      t.file_size,
      t.album_artist,
      t.genre,
      t.year,
      t.track_number,
      t.metadata_source,
      t.metadata_updated_at,
      CASE WHEN f.track_id IS NULL THEN 0 ELSE 1 END AS is_favorite
    FROM tracks t
    LEFT JOIN favorites f ON f.track_id = t.id
    WHERE t.id = ?
  `, [trackId]);

  return normalizeTrack(track);
}

async function listTracks(req, res) {
  const limit = parseLimit(req.query.limit);
  const offset = parseOffset(req.query.offset);

  if (limit === null || offset === null) {
    return res.status(400).json({
      error: 'Invalid pagination parameters'
    });
  }

  try {
    await collectionsService.ensureListeningStatsSchema();
    const { whereSql, params } = buildTrackListQuery(req.query);
    const tracks = await dbAll(`
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
        t.bitrate,
        t.sample_rate,
        t.bit_depth,
        t.codec,
        t.container,
        t.channels,
        t.file_size,
        t.album_artist,
        t.genre,
        t.year,
        t.track_number,
        t.metadata_source,
        t.metadata_updated_at,
        CASE WHEN f.track_id IS NULL THEN 0 ELSE 1 END AS is_favorite
      FROM tracks t
      LEFT JOIN favorites f ON f.track_id = t.id
      ${whereSql}
      ORDER BY t.created_at DESC, t.id DESC
      LIMIT ?
      OFFSET ?
    `, [...params, limit, offset]);

    res.json({
      tracks: tracks.map(normalizeTrack),
      pagination: {
        limit,
        offset,
        count: tracks.length
      }
    });
  } catch (err) {
    res.status(500).json({
      error: 'Failed to load tracks',
      message: err.message
    });
  }
}

async function createTrack(req, res) {
  const trackPayload = validateCreateTrackPayload(req.body);

  if (!trackPayload) {
    return res.status(400).json({
      error: 'Invalid track data'
    });
  }

  try {
    await collectionsService.ensureListeningStatsSchema();
    const result = await dbRun(`
      INSERT INTO tracks (
        title,
        artist,
        album,
        file_path,
        duration
      ) VALUES (?, ?, ?, ?, ?)
    `, [
      trackPayload.title,
      trackPayload.artist,
      trackPayload.album,
      trackPayload.file_path,
      trackPayload.duration
    ]);

    const track = await dbGet(`
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
        t.bitrate,
        t.sample_rate,
        t.bit_depth,
        t.codec,
        t.container,
        t.channels,
        t.file_size,
        t.album_artist,
        t.genre,
        t.year,
        t.track_number,
        t.metadata_source,
        t.metadata_updated_at,
        CASE WHEN f.track_id IS NULL THEN 0 ELSE 1 END AS is_favorite
      FROM tracks t
      LEFT JOIN favorites f ON f.track_id = t.id
      WHERE t.id = ?
    `, [result.id]);

    return res.status(201).json({ track: normalizeTrack(track) });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT') {
      return res.status(409).json({
        error: 'Track file already exists'
      });
    }

    return res.status(500).json({
      error: 'Failed to create track',
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
    const track = await findTrackById(trackId);

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

async function favoriteTrack(req, res) {
  const trackId = parseTrackId(req.params.id);

  if (!trackId) {
    return res.status(400).json({
      error: 'Invalid track id'
    });
  }

  try {
    const track = await findTrackById(trackId);

    if (!track) {
      return res.status(404).json({
        error: 'Track not found'
      });
    }

    await dbRun(`
      INSERT OR IGNORE INTO favorites (track_id)
      VALUES (?)
    `, [trackId]);

    return res.json({
      track: await findTrackById(trackId)
    });
  } catch (err) {
    return res.status(500).json({
      error: 'Failed to favorite track',
      message: err.message
    });
  }
}

async function unfavoriteTrack(req, res) {
  const trackId = parseTrackId(req.params.id);

  if (!trackId) {
    return res.status(400).json({
      error: 'Invalid track id'
    });
  }

  try {
    const track = await findTrackById(trackId);

    if (!track) {
      return res.status(404).json({
        error: 'Track not found'
      });
    }

    await dbRun(`
      DELETE FROM favorites
      WHERE track_id = ?
    `, [trackId]);

    return res.json({
      track: await findTrackById(trackId)
    });
  } catch (err) {
    return res.status(500).json({
      error: 'Failed to unfavorite track',
      message: err.message
    });
  }
}

async function recordTrackPlay(req, res) {
  const trackId = parseTrackId(req.params.id);

  if (!trackId) {
    return res.status(400).json({
      error: 'Invalid track id'
    });
  }

  try {
    const track = await findTrackById(trackId);

    if (!track) {
      return res.status(404).json({
        error: 'Track not found'
      });
    }

    await dbRun(`
      INSERT INTO play_history (track_id)
      VALUES (?)
    `, [trackId]);
    await collectionsService.ensureListeningStatsSchema();
    await dbRun(`
      UPDATE tracks
      SET
        play_count = COALESCE(play_count, 0) + 1,
        last_played_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [trackId]);

    return res.status(201).json({
      track: await findTrackById(trackId)
    });
  } catch (err) {
    return res.status(500).json({
      error: 'Failed to record track play',
      message: err.message
    });
  }
}

async function updateTrackMetadata(req, res) {
  const trackId = parseTrackId(req.params.id);
  if (!trackId) {
    return res.status(400).json({ error: 'Invalid track id' });
  }

  const { title, artist, album, album_artist, genre, year, track_number } = req.body || {};

  // Validate fields
  if (title !== undefined && (typeof title !== 'string' || title.trim().length === 0)) {
    return res.status(400).json({ error: 'Title must be a non-empty string' });
  }
  if (artist !== undefined && typeof artist !== 'string') {
    return res.status(400).json({ error: 'Artist must be a string' });
  }
  if (album !== undefined && typeof album !== 'string') {
    return res.status(400).json({ error: 'Album must be a string' });
  }
  if (album_artist !== undefined && typeof album_artist !== 'string') {
    return res.status(400).json({ error: 'Album Artist must be a string' });
  }
  if (genre !== undefined && typeof genre !== 'string') {
    return res.status(400).json({ error: 'Genre must be a string' });
  }

  let valYear = null;
  if (year !== undefined && year !== null) {
    valYear = Number(year);
    if (!Number.isInteger(valYear) || valYear < 0) {
      return res.status(400).json({ error: 'Year must be a valid positive integer' });
    }
  }

  let valTrackNum = null;
  if (track_number !== undefined && track_number !== null) {
    valTrackNum = Number(track_number);
    if (!Number.isInteger(valTrackNum) || valTrackNum < 0) {
      return res.status(400).json({ error: 'Track Number must be a valid positive integer' });
    }
  }

  try {
    const track = await findTrackById(trackId);
    if (!track) {
      return res.status(404).json({ error: 'Track not found' });
    }

    const updates = [];
    const params = [];

    if (title !== undefined) {
      updates.push('title = ?');
      params.push(title.trim());
    }
    if (artist !== undefined) {
      updates.push('artist = ?');
      params.push(artist.trim() || null);
    }
    if (album !== undefined) {
      updates.push('album = ?');
      params.push(album.trim() || null);
    }
    if (album_artist !== undefined) {
      updates.push('album_artist = ?');
      params.push(album_artist.trim() || null);
    }
    if (genre !== undefined) {
      updates.push('genre = ?');
      params.push(genre.trim() || null);
    }
    if (year !== undefined) {
      updates.push('year = ?');
      params.push(valYear);
    }
    if (track_number !== undefined) {
      updates.push('track_number = ?');
      params.push(valTrackNum);
    }

    updates.push("metadata_source = 'database'");
    updates.push("metadata_updated_at = CURRENT_TIMESTAMP");

    params.push(trackId);

    await dbRun(`
      UPDATE tracks
      SET ${updates.join(', ')}
      WHERE id = ?
    `, params);

    const updatedTrack = await findTrackById(trackId);
    return res.json({ track: updatedTrack });
  } catch (err) {
    return res.status(500).json({
      error: 'Failed to update track metadata',
      message: err.message
    });
  }
}

module.exports = {
  listTracks,
  createTrack,
  getTrackById,
  favoriteTrack,
  unfavoriteTrack,
  recordTrackPlay,
  updateTrackMetadata
};
