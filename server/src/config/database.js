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
    runMigrations();
  }
});

function runMigrations() {
  db.serialize(() => {
    // Check if the 'tracks' table exists
    db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='tracks'", (err, row) => {
      if (err) {
        console.error('Failed to check database schema:', err.message);
        return;
      }

      const tracksTableExists = !!row;

      if (!tracksTableExists) {
        console.log('Database is empty. Initializing base schema (001-005)...');
        const migrationsDir = path.join(__dirname, '../../migrations');
        if (fs.existsSync(migrationsDir)) {
          const files = fs.readdirSync(migrationsDir)
            .filter(f => f.endsWith('.sql'))
            .sort();

          files.forEach(file => {
            const match = file.match(/^(\d+)_/);
            if (!match) return;
            const fileVersion = parseInt(match[1], 10);

            // Only initialize base migrations (001-005)
            if (fileVersion >= 1 && fileVersion <= 5) {
              console.log(`Initializing migration: ${file}`);
              const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
              db.exec(sql, (execErr) => {
                if (execErr) {
                  console.error(`Initialization failed for ${file}:`, execErr.message);
                } else {
                  db.run(`PRAGMA user_version = ${fileVersion}`);
                }
              });
            }
          });
        }
      } else {
        console.log('Production schema detected. Skipping base migrations (001-005).');
      }

      // Safe check and alter for technical metadata columns (migration 006)
      ensureAudioTechnicalMetadataColumns();
    });
  });
}

function ensureAudioTechnicalMetadataColumns() {
  db.all("PRAGMA table_info(tracks)", (err, columns) => {
    if (err) {
      console.error('Failed to read table info for tracks:', err.message);
      return;
    }

    const existingColumns = new Set(columns.map(col => col.name.toLowerCase()));
    const columnsToEnsure = [
      { name: 'bitrate', type: 'INTEGER' },
      { name: 'sample_rate', type: 'INTEGER' },
      { name: 'bit_depth', type: 'INTEGER' },
      { name: 'codec', type: 'TEXT' },
      { name: 'container', type: 'TEXT' },
      { name: 'channels', type: 'INTEGER' },
      { name: 'file_size', type: 'INTEGER' }
    ];

    columnsToEnsure.forEach(col => {
      if (!existingColumns.has(col.name.toLowerCase())) {
        console.log(`Adding missing technical metadata column: ${col.name} (${col.type})`);
        db.run(`ALTER TABLE tracks ADD COLUMN ${col.name} ${col.type}`, (alterErr) => {
          if (alterErr) {
            console.error(`Failed to add column ${col.name}:`, alterErr.message);
          } else {
            console.log(`Column ${col.name} added successfully.`);
          }
        });
      }
    });

    db.run("PRAGMA user_version = 6", (versionErr) => {
      if (versionErr) {
        console.error('Failed to update user_version to 6:', versionErr.message);
      } else {
        console.log('Database user_version set to 6');
      }
    });
  });
}

module.exports = db;
