'use strict';

const libraryStateService = require('../services/library-state.service');

function parsePlaylistId(value) {
  return libraryStateService.parsePositiveInteger(value);
}

function validateName(body) {
  if (!body || typeof body !== 'object' || typeof body.name !== 'string') {
    return null;
  }

  const name = body.name.trim();

  return name.length > 0 ? name : null;
}

function parseTrackId(body) {
  return libraryStateService.parsePositiveInteger(body && body.trackId);
}

function parseTrackIds(body) {
  if (!body || !Array.isArray(body.trackIds)) {
    return null;
  }

  const seenTrackIds = new Set();
  const trackIds = [];

  body.trackIds.forEach((value) => {
    const trackId = libraryStateService.parsePositiveInteger(value);

    if (trackId && !seenTrackIds.has(trackId)) {
      seenTrackIds.add(trackId);
      trackIds.push(trackId);
    }
  });

  return trackIds;
}

async function listPlaylists(req, res) {
  try {
    const playlists = await libraryStateService.listPlaylists();

    return res.json({ playlists });
  } catch (err) {
    return res.status(500).json({
      error: 'Failed to load playlists',
      message: err.message
    });
  }
}

async function createPlaylist(req, res) {
  const name = validateName(req.body);

  if (!name) {
    return res.status(400).json({ error: 'Invalid playlist name' });
  }

  try {
    const playlist = await libraryStateService.createPlaylist(name);

    return res.status(201).json({ playlist });
  } catch (err) {
    return res.status(500).json({
      error: 'Failed to create playlist',
      message: err.message
    });
  }
}

async function getPlaylist(req, res) {
  const playlistId = parsePlaylistId(req.params.id);

  if (!playlistId) {
    return res.status(400).json({ error: 'Invalid playlist id' });
  }

  try {
    const playlist = await libraryStateService.getPlaylist(playlistId);

    if (!playlist) {
      return res.status(404).json({ error: 'Playlist not found' });
    }

    return res.json({ playlist });
  } catch (err) {
    return res.status(500).json({
      error: 'Failed to load playlist',
      message: err.message
    });
  }
}

async function updatePlaylist(req, res) {
  const playlistId = parsePlaylistId(req.params.id);
  const name = validateName(req.body);

  if (!playlistId) {
    return res.status(400).json({ error: 'Invalid playlist id' });
  }

  if (!name) {
    return res.status(400).json({ error: 'Invalid playlist name' });
  }

  try {
    const playlist = await libraryStateService.updatePlaylist(playlistId, name);

    if (!playlist) {
      return res.status(404).json({ error: 'Playlist not found' });
    }

    return res.json({ playlist });
  } catch (err) {
    return res.status(500).json({
      error: 'Failed to update playlist',
      message: err.message
    });
  }
}

async function deletePlaylist(req, res) {
  const playlistId = parsePlaylistId(req.params.id);

  if (!playlistId) {
    return res.status(400).json({ error: 'Invalid playlist id' });
  }

  try {
    const changes = await libraryStateService.deletePlaylist(playlistId);

    if (changes === 0) {
      return res.status(404).json({ error: 'Playlist not found' });
    }

    return res.status(204).send();
  } catch (err) {
    return res.status(500).json({
      error: 'Failed to delete playlist',
      message: err.message
    });
  }
}

async function addTrackToPlaylist(req, res) {
  const playlistId = parsePlaylistId(req.params.id);
  const trackId = parseTrackId(req.body);

  if (!playlistId) {
    return res.status(400).json({ error: 'Invalid playlist id' });
  }

  if (!trackId) {
    return res.status(400).json({ error: 'Invalid track id' });
  }

  try {
    const playlist = await libraryStateService.addTrackToPlaylist(playlistId, trackId);

    return res.json({ playlist });
  } catch (err) {
    if (err.code === 'PLAYLIST_NOT_FOUND') {
      return res.status(404).json({ error: 'Playlist not found' });
    }

    if (err.code === 'TRACK_NOT_FOUND') {
      return res.status(404).json({ error: 'Track not found' });
    }

    return res.status(500).json({
      error: 'Failed to add track to playlist',
      message: err.message
    });
  }
}

async function removeTrackFromPlaylist(req, res) {
  const playlistId = parsePlaylistId(req.params.id);
  const trackId = libraryStateService.parsePositiveInteger(req.params.trackId);

  if (!playlistId) {
    return res.status(400).json({ error: 'Invalid playlist id' });
  }

  if (!trackId) {
    return res.status(400).json({ error: 'Invalid track id' });
  }

  try {
    const playlist = await libraryStateService.removeTrackFromPlaylist(playlistId, trackId);

    return res.json({ playlist });
  } catch (err) {
    if (err.code === 'PLAYLIST_NOT_FOUND') {
      return res.status(404).json({ error: 'Playlist not found' });
    }

    return res.status(500).json({
      error: 'Failed to remove track from playlist',
      message: err.message
    });
  }
}

async function replacePlaylistTracks(req, res) {
  const playlistId = parsePlaylistId(req.params.id);
  const trackIds = parseTrackIds(req.body);

  if (!playlistId) {
    return res.status(400).json({ error: 'Invalid playlist id' });
  }

  if (!trackIds) {
    return res.status(400).json({ error: 'Invalid track ids' });
  }

  try {
    const playlist = await libraryStateService.replacePlaylistTracks(playlistId, trackIds);

    return res.json({ playlist });
  } catch (err) {
    if (err.code === 'PLAYLIST_NOT_FOUND') {
      return res.status(404).json({ error: 'Playlist not found' });
    }

    return res.status(500).json({
      error: 'Failed to reorder playlist tracks',
      message: err.message
    });
  }
}

module.exports = {
  listPlaylists,
  createPlaylist,
  getPlaylist,
  updatePlaylist,
  deletePlaylist,
  addTrackToPlaylist,
  removeTrackFromPlaylist,
  replacePlaylistTracks
};
