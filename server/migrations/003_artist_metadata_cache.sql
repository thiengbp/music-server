CREATE TABLE IF NOT EXISTS artist_metadata_cache (
  normalized_key TEXT PRIMARY KEY,
  artist_name TEXT NOT NULL,
  bio TEXT,
  country TEXT,
  area TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  image TEXT,
  musicbrainz_id TEXT,
  musicbrainz_disambiguation TEXT,
  musicbrainz_type TEXT,
  lastfm_url TEXT,
  listeners INTEGER,
  playcount INTEGER,
  sources_json TEXT NOT NULL DEFAULT '[]',
  mapping_version INTEGER NOT NULL DEFAULT 2,
  updated_at TEXT NOT NULL
);
