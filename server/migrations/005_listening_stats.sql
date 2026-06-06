ALTER TABLE tracks ADD COLUMN play_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tracks ADD COLUMN last_played_at TEXT;

CREATE INDEX IF NOT EXISTS idx_tracks_play_count
ON tracks (play_count DESC, last_played_at DESC);

CREATE INDEX IF NOT EXISTS idx_tracks_last_played_at
ON tracks (last_played_at DESC);
