'use strict';

require('dotenv').config();

const express = require('express');
const path = require('path');
const db = require('./config/database');
const artistRoutes = require('./routes/artists.routes');
const coverRoutes = require('./routes/cover.routes');
const libraryRoutes = require('./routes/library.routes');
const recentlyRoutes = require('./routes/recently.routes');
const streamRoutes = require('./routes/stream.routes');
const tracksRoutes = require('./routes/tracks.routes');
const libraryService = require('./services/library.service');

const app = express();
const port = process.env.PORT || 3000;
const publicPath = path.join(__dirname, '../../public');

app.use(express.json());
app.use(express.static(publicPath));

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

app.get('/health', async (req, res) => {
  try {
    await dbGet('SELECT 1 AS ok');

    res.json({
      status: 'ok',
      database: 'ok'
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      database: 'error',
      message: err.message
    });
  }
});

app.use('/tracks', tracksRoutes);
app.use('/tracks', coverRoutes);
app.use('/artists', artistRoutes);
app.use('/library', libraryRoutes);
app.use('/recently-played', recentlyRoutes);
app.use('/stream', streamRoutes);

let isShuttingDown = false;
let shouldForceExit = false;
let autoScanInterval = null;
let isAutoScanRunning = false;
const autoScanState = {
  enabled: false,
  libraryPath: process.env.MUSIC_LIBRARY_PATH || null,
  intervalMinutes: getScanIntervalMinutes(),
  isRunning: false,
  lastScanAt: null,
  nextScanAt: null,
  lastResult: null,
  lastError: null
};

function getScanIntervalMinutes() {
  const configuredValue = process.env.LIBRARY_SCAN_INTERVAL_MINUTES;

  if (!configuredValue) {
    return 10;
  }

  const parsedValue = Number(configuredValue);

  if (!Number.isFinite(parsedValue)) {
    return 10;
  }

  return parsedValue;
}

async function runAutoLibraryScan(libraryPath) {
  if (isAutoScanRunning) {
    console.log('Library scan skipped: previous scan still running');
    return {
      skipped: true,
      reason: 'previous scan still running'
    };
  }

  isAutoScanRunning = true;
  autoScanState.isRunning = true;
  autoScanState.lastError = null;
  console.log('Auto scan started');

  try {
    const result = await libraryService.scanLibrary(libraryPath);
    autoScanState.lastScanAt = new Date().toISOString();
    autoScanState.lastResult = result;
    console.log(
      `Auto scan completed: scanned=${result.scanned}, inserted=${result.inserted}, skipped=${result.skipped}`
    );
    return result;
  } catch (err) {
    autoScanState.lastScanAt = new Date().toISOString();
    autoScanState.lastError = err.message;
    console.error(`Auto scan failed: ${err.message}`);
    throw err;
  } finally {
    isAutoScanRunning = false;
    autoScanState.isRunning = false;
  }
}

function startAutoLibraryScan() {
  const libraryPath = process.env.MUSIC_LIBRARY_PATH;
  const intervalMinutes = getScanIntervalMinutes();

  autoScanState.libraryPath = libraryPath || null;
  autoScanState.intervalMinutes = intervalMinutes;

  if (!libraryPath || intervalMinutes <= 0) {
    autoScanState.enabled = false;
    autoScanState.nextScanAt = null;
    console.log('Auto library scan disabled');
    return;
  }

  const intervalMs = intervalMinutes * 60 * 1000;

  autoScanState.enabled = true;
  autoScanState.nextScanAt = new Date(Date.now() + intervalMs).toISOString();
  console.log(`Auto library scan enabled: ${libraryPath} every ${intervalMinutes} minutes`);
  setImmediate(() => {
    runAutoLibraryScan(libraryPath).catch(() => {});
  });
  autoScanInterval = setInterval(() => {
    autoScanState.nextScanAt = new Date(Date.now() + intervalMs).toISOString();
    runAutoLibraryScan(libraryPath).catch(() => {});
  }, intervalMs);
}

app.locals.getAutoScanStatus = () => ({
  ...autoScanState,
  libraryPath: autoScanState.libraryPath ? autoScanState.libraryPath : null
});

app.locals.runConfiguredLibraryScan = async () => {
  if (!autoScanState.libraryPath) {
    const err = new Error('Auto scan library path is not configured');
    err.code = 'AUTO_SCAN_NOT_CONFIGURED';
    throw err;
  }

  return runAutoLibraryScan(autoScanState.libraryPath);
};

const server = app.listen(port, (err) => {
  if (err) {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  }

  console.log(`Music Server running on port ${port}`);
  startAutoLibraryScan();
});

function shutdown(signal) {
  if (isShuttingDown) {
    if (shouldForceExit) {
      console.error(`${signal} received during shutdown, forcing exit...`);
      process.exit(1);
    }

    return;
  }

  isShuttingDown = true;
  setTimeout(() => {
    shouldForceExit = true;
  }, 1000);

  console.log(`${signal} received, shutting down...`);

  if (autoScanInterval) {
    clearInterval(autoScanInterval);
    autoScanInterval = null;
  }

  server.close(() => {
    db.close((err) => {
      if (err) {
        console.error('Failed to close database:', err.message);
        process.exit(1);
      }

      process.exit(0);
    });
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = app;
