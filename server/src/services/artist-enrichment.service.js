'use strict';

const db = require('../config/database');

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 6000;
const MUSICBRAINZ_MIN_INTERVAL_MS = 1100;
const USER_AGENT = 'music-server/2.4 (self-hosted music library)';
const CACHE_MAPPING_VERSION = 2;

let cacheTableReady = null;
let lastMusicBrainzRequestAt = 0;
let musicBrainzQueue = Promise.resolve();

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function ensureCacheTable() {
  if (!cacheTableReady) {
    cacheTableReady = dbRun(`
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
      )
    `).then(async () => {
      const columns = await dbAll('PRAGMA table_info(artist_metadata_cache)');
      const columnNames = new Set(columns.map((column) => column.name));

      if (!columnNames.has('musicbrainz_disambiguation')) {
        await dbRun('ALTER TABLE artist_metadata_cache ADD COLUMN musicbrainz_disambiguation TEXT');
      }

      if (!columnNames.has('musicbrainz_type')) {
        await dbRun('ALTER TABLE artist_metadata_cache ADD COLUMN musicbrainz_type TEXT');
      }

      if (!columnNames.has('area')) {
        await dbRun('ALTER TABLE artist_metadata_cache ADD COLUMN area TEXT');
      }

      if (!columnNames.has('mapping_version')) {
        await dbRun('ALTER TABLE artist_metadata_cache ADD COLUMN mapping_version INTEGER NOT NULL DEFAULT 1');
      }
    }).catch((err) => {
      cacheTableReady = null;
      throw err;
    });
  }

  return cacheTableReady;
}

function normalizedArtistKey(artistName) {
  return artistName.normalize('NFC').trim().toLocaleLowerCase('vi');
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mapCacheRow(row) {
  if (!row) {
    return null;
  }

  return {
    artistName: row.artist_name,
    bio: row.bio,
    country: row.country,
    area: row.area,
    tags: parseJsonArray(row.tags_json),
    image: row.image,
    musicbrainzId: row.musicbrainz_id,
    musicbrainzDisambiguation: row.musicbrainz_disambiguation,
    musicbrainzType: row.musicbrainz_type,
    lastfmUrl: row.lastfm_url,
    listeners: row.listeners,
    playcount: row.playcount,
    sources: parseJsonArray(row.sources_json),
    mappingVersion: row.mapping_version,
    updatedAt: row.updated_at,
    cached: true
  };
}

async function getCachedArtist(artistName) {
  await ensureCacheTable();
  const row = await dbGet(
    'SELECT * FROM artist_metadata_cache WHERE normalized_key = ?',
    [normalizedArtistKey(artistName)]
  );
  const cached = mapCacheRow(row);

  if (!cached) {
    return null;
  }

  const updatedAt = Date.parse(cached.updatedAt);
  const isFresh = Number.isFinite(updatedAt) && Date.now() - updatedAt < CACHE_TTL_MS;
  const needsLastFmRefresh = Boolean(process.env.LASTFM_API_KEY)
    && !cached.sources.includes('lastfm');
  const needsMappingRefresh = cached.sources.includes('musicbrainz')
    && cached.mappingVersion !== CACHE_MAPPING_VERSION;

  return isFresh && !needsLastFmRefresh && !needsMappingRefresh ? cached : null;
}

async function saveCachedArtist(artistName, metadata) {
  await ensureCacheTable();
  const updatedAt = new Date().toISOString();

  await dbRun(`
    INSERT INTO artist_metadata_cache (
      normalized_key, artist_name, bio, country, area, tags_json, image,
      musicbrainz_id, musicbrainz_disambiguation, musicbrainz_type,
      lastfm_url, listeners, playcount, sources_json, mapping_version, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(normalized_key) DO UPDATE SET
      artist_name = excluded.artist_name,
      bio = excluded.bio,
      country = excluded.country,
      area = excluded.area,
      tags_json = excluded.tags_json,
      image = excluded.image,
      musicbrainz_id = excluded.musicbrainz_id,
      musicbrainz_disambiguation = excluded.musicbrainz_disambiguation,
      musicbrainz_type = excluded.musicbrainz_type,
      lastfm_url = excluded.lastfm_url,
      listeners = excluded.listeners,
      playcount = excluded.playcount,
      sources_json = excluded.sources_json,
      mapping_version = excluded.mapping_version,
      updated_at = excluded.updated_at
  `, [
    normalizedArtistKey(artistName),
    artistName,
    metadata.bio,
    metadata.country,
    metadata.area,
    JSON.stringify(metadata.tags || []),
    metadata.image,
    metadata.musicbrainzId,
    metadata.musicbrainzDisambiguation,
    metadata.musicbrainzType,
    metadata.lastfmUrl,
    metadata.listeners,
    metadata.playcount,
    JSON.stringify(metadata.sources || []),
    CACHE_MAPPING_VERSION,
    updatedAt
  ]);

  return {
    ...metadata,
    artistName,
    updatedAt,
    cached: false
  };
}

async function fetchJson(url, headers = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers,
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function scheduleMusicBrainzRequest(task) {
  const scheduled = musicBrainzQueue.then(async () => {
    const waitMs = Math.max(
      0,
      MUSICBRAINZ_MIN_INTERVAL_MS - (Date.now() - lastMusicBrainzRequestAt)
    );

    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    lastMusicBrainzRequestAt = Date.now();
    return task();
  });

  musicBrainzQueue = scheduled.catch(() => {});
  return scheduled;
}

async function fetchMusicBrainzArtist(artistName) {
  const query = encodeURIComponent(`artist:"${artistName.replace(/"/g, '')}"`);
  const url = `https://musicbrainz.org/ws/2/artist/?query=${query}&limit=5&fmt=json`;

  return scheduleMusicBrainzRequest(async () => {
    const payload = await fetchJson(url, {
      Accept: 'application/json',
      'User-Agent': USER_AGENT
    });
    const artists = Array.isArray(payload.artists) ? payload.artists : [];
    const exactKey = normalizedArtistKey(artistName);
    const artist = artists.find((item) => normalizedArtistKey(item.name || '') === exactKey)
      || artists[0];

    if (!artist) {
      return null;
    }

    return {
      musicbrainzId: artist.id || null,
      country: artist.country || null,
      area: artist.area?.name || artist['begin-area']?.name || null,
      tags: Array.isArray(artist.tags)
        ? artist.tags.map((tag) => tag.name).filter(Boolean)
        : [],
      disambiguation: artist.disambiguation || null,
      type: artist.type || null
    };
  });
}

function stripHtml(value) {
  return typeof value === 'string'
    ? value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
    : null;
}

async function fetchLastFmArtist(artistName) {
  const apiKey = process.env.LASTFM_API_KEY;

  if (!apiKey) {
    return null;
  }

  const params = new URLSearchParams({
    method: 'artist.getInfo',
    artist: artistName,
    api_key: apiKey,
    format: 'json',
    autocorrect: '1'
  });
  const payload = await fetchJson(`https://ws.audioscrobbler.com/2.0/?${params}`);
  const artist = payload.artist;

  if (!artist) {
    return null;
  }

  const images = Array.isArray(artist.image) ? artist.image : [];
  const image = [...images].reverse().find((item) => item['#text'])?.['#text'] || null;
  const tags = Array.isArray(artist.tags?.tag)
    ? artist.tags.tag.map((tag) => tag.name).filter(Boolean)
    : [];

  return {
    bio: stripHtml(artist.bio?.summary || artist.bio?.content),
    tags,
    image,
    lastfmUrl: artist.url || null,
    listeners: Number.isFinite(Number(artist.stats?.listeners))
      ? Number(artist.stats.listeners)
      : null,
    playcount: Number.isFinite(Number(artist.stats?.playcount))
      ? Number(artist.stats.playcount)
      : null
  };
}

function mergeTags(...tagLists) {
  const seen = new Set();
  const result = [];

  tagLists.flat().filter(Boolean).forEach((tag) => {
    const key = String(tag).normalize('NFC').trim().toLocaleLowerCase('vi');

    if (key && !seen.has(key)) {
      seen.add(key);
      result.push(String(tag).normalize('NFC').trim());
    }
  });

  return result;
}

async function enrichArtist(artistName) {
  const cached = await getCachedArtist(artistName);

  if (cached) {
    return cached;
  }

  const metadata = {
    bio: null,
    country: null,
    area: null,
    tags: [],
    image: null,
    musicbrainzId: null,
    musicbrainzDisambiguation: null,
    musicbrainzType: null,
    lastfmUrl: null,
    listeners: null,
    playcount: null,
    sources: []
  };

  try {
    const musicBrainz = await fetchMusicBrainzArtist(artistName);

    if (musicBrainz) {
      metadata.country = musicBrainz.country;
      metadata.area = musicBrainz.area;
      metadata.tags = mergeTags(metadata.tags, musicBrainz.tags);
      metadata.musicbrainzId = musicBrainz.musicbrainzId;
      metadata.musicbrainzDisambiguation = musicBrainz.disambiguation;
      metadata.musicbrainzType = musicBrainz.type;
      metadata.sources.push('musicbrainz');
    }
  } catch (err) {
    console.warn(`MusicBrainz enrichment failed for "${artistName}": ${err.message}`);
  }

  try {
    const lastFm = await fetchLastFmArtist(artistName);

    if (lastFm) {
      metadata.bio = lastFm.bio;
      metadata.tags = mergeTags(metadata.tags, lastFm.tags);
      metadata.image = lastFm.image;
      metadata.lastfmUrl = lastFm.lastfmUrl;
      metadata.listeners = lastFm.listeners;
      metadata.playcount = lastFm.playcount;
      metadata.sources.push('lastfm');
    }
  } catch (err) {
    console.warn(`Last.fm enrichment failed for "${artistName}": ${err.message}`);
  }

  return saveCachedArtist(artistName, metadata);
}

module.exports = {
  CACHE_TTL_MS,
  enrichArtist,
  mergeTags,
  normalizedArtistKey
};
