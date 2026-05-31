'use strict';

const coverService = require('../services/cover.service');

function parseTrackId(id) {
  const trackId = Number(id);

  if (!Number.isInteger(trackId) || trackId <= 0) {
    return null;
  }

  return trackId;
}

async function getTrackCover(req, res) {
  const trackId = parseTrackId(req.params.id);

  if (!trackId) {
    return res.status(400).json({
      error: 'Invalid track id'
    });
  }

  try {
    const cover = await coverService.getTrackCover(trackId);

    res.set({
      'Cache-Control': cover.cacheControl,
      'Content-Type': cover.contentType,
      'Content-Length': cover.data.length
    });

    return res.send(cover.data);
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({
        error: err.message
      });
    }

    return res.status(500).json({
      error: 'Failed to load cover',
      message: err.message
    });
  }
}

module.exports = {
  getTrackCover
};
