'use strict';

const streamService = require('../services/stream.service');

function parseTrackId(id) {
  const trackId = Number(id);

  if (!Number.isInteger(trackId) || trackId <= 0) {
    return null;
  }

  return trackId;
}

function sendStreamError(res, err) {
  if (err.statusCode === 400) {
    return res.status(400).json({
      error: 'Invalid track id'
    });
  }

  if (err.statusCode === 404) {
    return res.status(404).json({
      error: err.message
    });
  }

  if (err.statusCode === 415) {
    return res.status(415).json({
      error: err.message
    });
  }

  if (err.statusCode === 416) {
    if (err.headers) {
      res.set(err.headers);
    }

    return res.status(416).json({
      error: 'Invalid range'
    });
  }

  return res.status(500).json({
    error: 'Failed to stream track',
    message: err.message
  });
}

async function streamTrackHead(req, res) {
  const trackId = parseTrackId(req.params.id);

  if (!trackId) {
    return res.status(400).end();
  }

  try {
    const streamData = await streamService.createTrackStream(
      trackId,
      req.headers.range
    );

    res.status(streamData.statusCode);
    res.set(streamData.headers);
    streamData.stream.destroy();
    return res.end();
  } catch (err) {
    if (err.headers) {
      res.set(err.headers);
    }

    return res.status(err.statusCode || 500).end();
  }
}

async function streamTrack(req, res) {
  const trackId = parseTrackId(req.params.id);

  if (!trackId) {
    return res.status(400).json({
      error: 'Invalid track id'
    });
  }

  try {
    const streamData = await streamService.createTrackStream(
      trackId,
      req.headers.range
    );

    res.status(streamData.statusCode);
    res.set(streamData.headers);

    streamData.stream.on('error', (err) => {
      if (!res.headersSent) {
        res.status(500).json({
          error: 'Failed to stream track',
          message: err.message
        });
      } else {
        res.destroy(err);
      }
    });

    return streamData.stream.pipe(res);
  } catch (err) {
    return sendStreamError(res, err);
  }
}

module.exports = {
  streamTrackHead,
  streamTrack
};
