CREATE TABLE IF NOT EXISTS playlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS playlist_tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  playlist_id INTEGER NOT NULL,
  track_id INTEGER NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(playlist_id, track_id),
  FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
  FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist_position
ON playlist_tracks (playlist_id, position, id);

CREATE INDEX IF NOT EXISTS idx_playlist_tracks_track_id
ON playlist_tracks (track_id);

CREATE TABLE IF NOT EXISTS queue_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id INTEGER NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_queue_items_position
ON queue_items (position, id);

CREATE INDEX IF NOT EXISTS idx_queue_items_track_id
ON queue_items (track_id);

CREATE TABLE IF NOT EXISTS queue_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  current_track_id INTEGER,
  repeat_mode TEXT DEFAULT 'off',
  shuffle_enabled INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (current_track_id) REFERENCES tracks(id) ON DELETE SET NULL
);

INSERT OR IGNORE INTO queue_state (id)
VALUES (1);
