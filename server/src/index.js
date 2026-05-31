'use strict';

require('dotenv').config();

const express = require('express');
const path = require('path');
const db = require('./config/database');
const coverRoutes = require('./routes/cover.routes');
const libraryRoutes = require('./routes/library.routes');
const recentlyRoutes = require('./routes/recently.routes');
const streamRoutes = require('./routes/stream.routes');
const tracksRoutes = require('./routes/tracks.routes');

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
app.use('/library', libraryRoutes);
app.use('/recently-played', recentlyRoutes);
app.use('/stream', streamRoutes);

let isShuttingDown = false;
let shouldForceExit = false;

const server = app.listen(port, (err) => {
  if (err) {
    console.error('Failed to start server:', err.message);
    process.exit(1);
  }

  console.log(`Music Server running on port ${port}`);
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
