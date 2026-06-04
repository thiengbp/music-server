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

function getAutoScanStatus(req, res) {
  const getStatus = req.app.locals.getAutoScanStatus;

  if (typeof getStatus !== 'function') {
    return res.json({
      enabled: false,
      libraryPath: null,
      intervalMinutes: null,
      isRunning: false,
      lastScanAt: null,
      nextScanAt: null,
      lastResult: null,
      lastError: null
    });
  }

  return res.json(getStatus());
}

async function scanConfiguredLibrary(req, res) {
  const runConfiguredLibraryScan = req.app.locals.runConfiguredLibraryScan;

  if (typeof runConfiguredLibraryScan !== 'function') {
    return res.status(400).json({
      error: 'Auto scan is not configured'
    });
  }

  try {
    const result = await runConfiguredLibraryScan();

    if (result && result.skipped === true && result.reason === 'previous scan still running') {
      return res.status(409).json({
        error: 'Library scan already running'
      });
    }

    return res.json(result);
  } catch (err) {
    if (err.code === 'AUTO_SCAN_NOT_CONFIGURED') {
      return res.status(400).json({
        error: 'Auto scan is not configured'
      });
    }

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
  scanLibrary,
  getAutoScanStatus,
  scanConfiguredLibrary
};
