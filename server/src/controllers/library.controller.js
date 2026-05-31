'use strict';

const libraryService = require('../services/library.service');

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

async function scanLibrary(req, res) {
  if (!req.body || !isNonEmptyString(req.body.path)) {
    return res.status(400).json({
      error: 'Invalid library path'
    });
  }

  try {
    const result = await libraryService.scanLibrary(req.body.path.trim());
    return res.json(result);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
      return res.status(400).json({
        error: 'Library path does not exist'
      });
    }

    return res.status(500).json({
      error: 'Failed to scan library',
      message: err.message
    });
  }
}

module.exports = {
  scanLibrary
};
