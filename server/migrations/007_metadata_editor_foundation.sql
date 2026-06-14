ALTER TABLE tracks ADD COLUMN album_artist TEXT;
ALTER TABLE tracks ADD COLUMN genre TEXT;
ALTER TABLE tracks ADD COLUMN year INTEGER;
ALTER TABLE tracks ADD COLUMN track_number INTEGER;
ALTER TABLE tracks ADD COLUMN metadata_source TEXT DEFAULT 'file';
ALTER TABLE tracks ADD COLUMN metadata_updated_at TEXT;
