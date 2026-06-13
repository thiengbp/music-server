const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const defaultDbPath = path.join(__dirname, '../../data/music.db');
const dbPath = process.env.DATABASE_PATH || defaultDbPath;

// Ensure containing directory exists
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Database connection error:', err.message);
  } else {
    console.log('Connected to SQLite database');
  }
});

module.exports = db;
