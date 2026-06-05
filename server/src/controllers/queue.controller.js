'use strict';

const libraryStateService = require('../services/library-state.service');

const REPEAT_MODES = new Set(['off', 'all', 'one']);

function parseTrackIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((trackId) => libraryStateService.parsePositiveInteger(trackId))
    .filter((trackId) => trackId !== null);
}

function parseRepeatMode(value) {
  return REPEAT_MODES.has(value) ? value : 'off';
}

async function getQueue(req, res) {
  try {
    const queue = await libraryStateService.getQueue();

    return res.json({ queue });
  } catch (err) {
    return res.status(500).json({
      error: 'Failed to load queue',
      message: err.message
    });
  }
}

async function replaceQueue(req, res) {
  const trackIds = parseTrackIds(req.body && req.body.trackIds);
  const currentTrackId = libraryStateService.parsePositiveInteger(req.body && req.body.currentTrackId);

  try {
    const queue = await libraryStateService.replaceQueue(trackIds, {
      currentTrackId,
      repeatMode: parseRepeatMode(req.body && req.body.repeatMode),
      shuffleEnabled: Boolean(req.body && req.body.shuffleEnabled)
    });

    return res.json({ queue });
  } catch (err) {
    return res.status(500).json({
      error: 'Failed to save queue',
      message: err.message
    });
  }
}

async function addQueueItem(req, res) {
  const trackId = libraryStateService.parsePositiveInteger(req.body && req.body.trackId);

  if (!trackId) {
    return res.status(400).json({ error: 'Invalid track id' });
  }

  try {
    const queue = await libraryStateService.addQueueItem(trackId);

    return res.status(201).json({ queue });
  } catch (err) {
    if (err.code === 'TRACK_NOT_FOUND') {
      return res.status(404).json({ error: 'Track not found' });
    }

    return res.status(500).json({
      error: 'Failed to add queue item',
      message: err.message
    });
  }
}

async function removeQueueItem(req, res) {
  const itemId = libraryStateService.parsePositiveInteger(req.params.id);

  if (!itemId) {
    return res.status(400).json({ error: 'Invalid queue item id' });
  }

  try {
    const queue = await libraryStateService.removeQueueItem(itemId);

    return res.json({ queue });
  } catch (err) {
    return res.status(500).json({
      error: 'Failed to remove queue item',
      message: err.message
    });
  }
}

async function clearQueue(req, res) {
  try {
    const queue = await libraryStateService.clearQueue();

    return res.json({ queue });
  } catch (err) {
    return res.status(500).json({
      error: 'Failed to clear queue',
      message: err.message
    });
  }
}

module.exports = {
  getQueue,
  replaceQueue,
  addQueueItem,
  removeQueueItem,
  clearQueue
};
