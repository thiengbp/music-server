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
  if (value === undefined) {
    return 50;
  }

  const limit = Number(value);

  if (!Number.isInteger(limit) || limit <= 0) {
    return null;
  }

  return Math.min(limit, 200);
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
    whereClauses.push('(title LIKE ? OR artist LIKE ? OR album LIKE ?)');
    params.push(searchValue, searchValue, searchValue);
  }

  addTextFilter(whereClauses, params, 'artist', query.artist);
  addTextFilter(whereClauses, params, 'album', query.album);

  const whereSql = whereClauses.length > 0
    ? `WHERE ${whereClauses.join(' AND ')}`
    : '';

  return {
    whereSql,
    params
  };
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
    const { whereSql, params } = buildTrackListQuery(req.query);
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
      ${whereSql}
      ORDER BY created_at DESC, id DESC
      LIMIT ?
      OFFSET ?
    `, [...params, limit, offset]);

    res.json({
      tracks,
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
        id,
        title,
        artist,
        album,
        file_path,
        duration,
        created_at
      FROM tracks
      WHERE id = ?
    `, [result.id]);

    return res.status(201).json({ track });
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
  createTrack,
  getTrackById
};
