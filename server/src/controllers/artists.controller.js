'use strict';

const db = require('../config/database');

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function normalizeArtistName(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const decodedValue = decodeURIComponent(value).trim();
  return decodedValue.length > 0 ? decodedValue : null;
}

function inferLocalTags(artistName, tracks) {
  const searchableText = [artistName, ...tracks.flatMap((track) => [
    track.title,
    track.album
  ])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const tags = [];

  if (artistName === 'Unknown artist') {
    tags.push('Unknown');
  }

  if (/(classical|concerto|sonata|symphony|arrau|beethoven|mozart|chopin|bach)/i.test(searchableText)) {
    tags.push('Classical');
  }

  if (/(remix|mix|edit)/i.test(searchableText)) {
    tags.push('Remix');
  }

  if (/(instrumental|piano|orchestra|solo)/i.test(searchableText)) {
    tags.push('Instrumental');
  }

  if (/(pop|single|hit|love|dance)/i.test(searchableText)) {
    tags.push('Pop');
  }

  return [...new Set(tags)].slice(0, 3);
}

async function getArtistInfo(req, res) {
  const artistName = normalizeArtistName(req.params.name);

  if (!artistName) {
    return res.status(400).json({
      error: 'Invalid artist name'
    });
  }

  try {
    const stats = await dbGet(`
      SELECT
        COUNT(*) AS trackCount,
        COUNT(DISTINCT NULLIF(TRIM(album), '')) AS albumCount
      FROM tracks
      WHERE COALESCE(NULLIF(TRIM(artist), ''), 'Unknown artist') = ?
    `, [artistName]);
    const topTracks = await dbAll(`
      SELECT
        id,
        title
      FROM tracks
      WHERE COALESCE(NULLIF(TRIM(artist), ''), 'Unknown artist') = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 3
    `, [artistName]);
    const tagTracks = await dbAll(`
      SELECT
        title,
        album
      FROM tracks
      WHERE COALESCE(NULLIF(TRIM(artist), ''), 'Unknown artist') = ?
      LIMIT 25
    `, [artistName]);

    return res.json({
      artist: artistName,
      bio: null,
      image: null,
      source: 'Local',
      tags: inferLocalTags(artistName, tagTracks),
      country: null,
      listeners: null,
      playcount: null,
      albumCount: stats ? stats.albumCount : 0,
      trackCount: stats ? stats.trackCount : 0,
      topTracks,
      updatedAt: new Date().toISOString()
      // TODO: Enrich this response with MusicBrainz / Last.fm metadata.
    });
  } catch (err) {
    return res.status(500).json({
      error: 'Failed to load artist info',
      message: err.message
    });
  }
}

module.exports = {
  getArtistInfo
};
