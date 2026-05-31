CREATE TABLE IF NOT EXISTS favorites (
  track_id INTEGER PRIMARY KEY,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS play_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  track_id INTEGER NOT NULL,
  played_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_play_history_played_at
ON play_history (played_at DESC);

CREATE INDEX IF NOT EXISTS idx_play_history_track_id
ON play_history (track_id);
