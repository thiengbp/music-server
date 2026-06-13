'use strict';

const discoveryService = require('../services/discovery.service');

function parseLimit(value, defaultValue = 50) {
  if (value === undefined) return defaultValue;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? Math.min(n, 100) : defaultValue;
}

function parseTrackId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// GET /discovery/similar-artists/:name
async function getSimilarArtists(req, res) {
  const artistName = (req.params.name || '').trim();
  if (!artistName) {
    return res.status(400).json({ error: 'Artist name is required' });
  }
  const limit = parseLimit(req.query.limit, 12);

  try {
    const artists = await discoveryService.getSimilarArtists(artistName, limit);
    return res.json({ artists, seed: artistName });
  } catch (err) {
    console.error(`similar-artists error for "${artistName}": ${err.message}`);
    return res.status(500).json({ error: 'Failed to find similar artists', message: err.message });
  }
}

// GET /discovery/artist-radio/:name
async function getArtistRadio(req, res) {
  const artistName = (req.params.name || '').trim();
  if (!artistName) {
    return res.status(400).json({ error: 'Artist name is required' });
  }
  const limit = parseLimit(req.query.limit);

  try {
    const result = await discoveryService.getArtistRadio(artistName, limit);
    return res.json(result);
  } catch (err) {
    console.error(`artist-radio error for "${artistName}": ${err.message}`);
    return res.status(500).json({ error: 'Failed to build artist radio', message: err.message });
  }
}

// GET /discovery/album-radio?album=X&artist=Y&limit=N
async function getAlbumRadio(req, res) {
  const albumName = (req.query.album || '').trim();
  if (!albumName) {
    return res.status(400).json({ error: 'album query param is required' });
  }
  const artistName = (req.query.artist || '').trim() || null;
  const limit = parseLimit(req.query.limit);

  try {
    const result = await discoveryService.getAlbumRadio(albumName, artistName, limit);
    return res.json(result);
  } catch (err) {
    console.error(`album-radio error for "${albumName}": ${err.message}`);
    return res.status(500).json({ error: 'Failed to build album radio', message: err.message });
  }
}

// GET /discovery/track-radio/:trackId
async function getTrackRadio(req, res) {
  const trackId = parseTrackId(req.params.trackId);
  if (!trackId) {
    return res.status(400).json({ error: 'Invalid track id' });
  }
  const limit = parseLimit(req.query.limit);

  try {
    const result = await discoveryService.getTrackRadio(trackId, limit);
    if (!result) {
      return res.status(404).json({ error: 'Track not found' });
    }
    return res.json(result);
  } catch (err) {
    console.error(`track-radio error for trackId ${trackId}: ${err.message}`);
    return res.status(500).json({ error: 'Failed to build track radio', message: err.message });
  }
}

// GET /discovery/auto-mix?limit=N
async function getAutoMix(req, res) {
  const limit = parseLimit(req.query.limit);

  try {
    const result = await discoveryService.getAutoMix(limit);
    return res.json(result);
  } catch (err) {
    console.error(`auto-mix error: ${err.message}`);
    return res.status(500).json({ error: 'Failed to build auto mix', message: err.message });
  }
}

// GET /discovery/daily-mix?limit=N
async function getDailyMix(req, res) {
  const limit = parseLimit(req.query.limit);

  try {
    const result = await discoveryService.getDailyMix(limit);
    return res.json(result);
  } catch (err) {
    console.error(`daily-mix error: ${err.message}`);
    return res.status(500).json({ error: 'Failed to build daily mix', message: err.message });
  }
}

// GET /discovery/because-you-played?limit=N
async function getBecauseYouPlayed(req, res) {
  const limit = parseLimit(req.query.limit);

  try {
    const result = await discoveryService.getBecauseYouPlayed(limit);
    return res.json(result);
  } catch (err) {
    console.error(`because-you-played error: ${err.message}`);
    return res.status(500).json({ error: 'Failed to build recommendation', message: err.message });
  }
}

module.exports = {
  getSimilarArtists,
  getArtistRadio,
  getAlbumRadio,
  getTrackRadio,
  getAutoMix,
  getDailyMix,
  getBecauseYouPlayed
};
