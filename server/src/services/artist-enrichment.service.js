'use strict';

const db = require('../config/database');

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 6000;
const MUSICBRAINZ_MIN_INTERVAL_MS = 1100;
const USER_AGENT = 'music-server/2.4 (self-hosted music library)';
const CACHE_MAPPING_VERSION = 5;
const LASTFM_PLACEHOLDER_IMAGE_IDS = new Set([
  '2a96cbd8b46e442fc41c2b86b821562f'
]);

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
        image_source TEXT,
        musicbrainz_id TEXT,
        musicbrainz_disambiguation TEXT,
        musicbrainz_type TEXT,
        wikidata_id TEXT,
        wikidata_url TEXT,
        wikipedia_url TEXT,
        lastfm_url TEXT,
        listeners INTEGER,
        playcount INTEGER,
        popular_tracks_json TEXT NOT NULL DEFAULT '[]',
        sources_json TEXT NOT NULL DEFAULT '[]',
        mapping_version INTEGER NOT NULL DEFAULT 5,
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

      if (!columnNames.has('popular_tracks_json')) {
        await dbRun("ALTER TABLE artist_metadata_cache ADD COLUMN popular_tracks_json TEXT NOT NULL DEFAULT '[]'");
      }

      if (!columnNames.has('image_source')) {
        await dbRun('ALTER TABLE artist_metadata_cache ADD COLUMN image_source TEXT');
      }

      if (!columnNames.has('wikidata_id')) {
        await dbRun('ALTER TABLE artist_metadata_cache ADD COLUMN wikidata_id TEXT');
      }

      if (!columnNames.has('wikidata_url')) {
        await dbRun('ALTER TABLE artist_metadata_cache ADD COLUMN wikidata_url TEXT');
      }

      if (!columnNames.has('wikipedia_url')) {
        await dbRun('ALTER TABLE artist_metadata_cache ADD COLUMN wikipedia_url TEXT');
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
    imageSource: row.image_source,
    musicbrainzId: row.musicbrainz_id,
    musicbrainzDisambiguation: row.musicbrainz_disambiguation,
    musicbrainzType: row.musicbrainz_type,
    wikidataId: row.wikidata_id,
    wikidataUrl: row.wikidata_url,
    wikipediaUrl: row.wikipedia_url,
    lastfmUrl: row.lastfm_url,
    listeners: row.listeners,
    playcount: row.playcount,
    popularTracks: parseJsonArray(row.popular_tracks_json),
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
  return mapCacheRow(row);
}

async function saveCachedArtist(artistName, metadata) {
  await ensureCacheTable();
  const updatedAt = new Date().toISOString();

  await dbRun(`
    INSERT INTO artist_metadata_cache (
      normalized_key, artist_name, bio, country, area, tags_json, image, image_source,
      musicbrainz_id, musicbrainz_disambiguation, musicbrainz_type,
      wikidata_id, wikidata_url, wikipedia_url,
      lastfm_url, listeners, playcount, popular_tracks_json,
      sources_json, mapping_version, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(normalized_key) DO UPDATE SET
      artist_name = excluded.artist_name,
      bio = excluded.bio,
      country = excluded.country,
      area = excluded.area,
      tags_json = excluded.tags_json,
      image = excluded.image,
      image_source = excluded.image_source,
      musicbrainz_id = excluded.musicbrainz_id,
      musicbrainz_disambiguation = excluded.musicbrainz_disambiguation,
      musicbrainz_type = excluded.musicbrainz_type,
      wikidata_id = excluded.wikidata_id,
      wikidata_url = excluded.wikidata_url,
      wikipedia_url = excluded.wikipedia_url,
      lastfm_url = excluded.lastfm_url,
      listeners = excluded.listeners,
      playcount = excluded.playcount,
      popular_tracks_json = excluded.popular_tracks_json,
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
    metadata.imageSource,
    metadata.musicbrainzId,
    metadata.musicbrainzDisambiguation,
    metadata.musicbrainzType,
    metadata.wikidataId,
    metadata.wikidataUrl,
    metadata.wikipediaUrl,
    metadata.lastfmUrl,
    metadata.listeners,
    metadata.playcount,
    JSON.stringify(metadata.popularTracks || []),
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

function wikidataIdFromUrl(value) {
  if (typeof value !== 'string') {
    return null;
  }

  return value.match(/wikidata\.org\/(?:wiki|entity)\/(Q\d+)/i)?.[1] || null;
}

async function fetchMusicBrainzWikidataId(musicbrainzId) {
  if (!musicbrainzId) {
    return null;
  }

  const url = `https://musicbrainz.org/ws/2/artist/${encodeURIComponent(musicbrainzId)}?inc=url-rels&fmt=json`;

  return scheduleMusicBrainzRequest(async () => {
    const payload = await fetchJson(url, {
      Accept: 'application/json',
      'User-Agent': USER_AGENT
    });
    const relation = Array.isArray(payload.relations)
      ? payload.relations.find((item) => item.type === 'wikidata' && item.url?.resource)
      : null;

    return wikidataIdFromUrl(relation?.url?.resource);
  });
}

async function searchWikidataArtistId(artistName) {
  const params = new URLSearchParams({
    action: 'wbsearchentities',
    search: artistName,
    language: 'en',
    format: 'json',
    limit: '5'
  });
  const payload = await fetchJson(`https://www.wikidata.org/w/api.php?${params}`, {
    Accept: 'application/json',
    'User-Agent': USER_AGENT
  });
  const results = Array.isArray(payload.search) ? payload.search : [];
  const exactKey = normalizedArtistKey(artistName);
  const entity = results.find((item) => normalizedArtistKey(item.label || '') === exactKey)
    || results[0];

  return entity?.id || null;
}

function wikimediaFileUrl(fileName) {
  if (!fileName) {
    return null;
  }

  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(fileName.replace(/ /g, '_'))}`;
}

async function fetchWikidataArtist(artistName, musicbrainzId) {
  const wikidataId = await fetchMusicBrainzWikidataId(musicbrainzId)
    || await searchWikidataArtistId(artistName);

  if (!wikidataId) {
    return null;
  }

  const params = new URLSearchParams({
    action: 'wbgetentities',
    ids: wikidataId,
    props: 'claims|sitelinks',
    sitefilter: 'enwiki',
    format: 'json'
  });
  const payload = await fetchJson(`https://www.wikidata.org/w/api.php?${params}`, {
    Accept: 'application/json',
    'User-Agent': USER_AGENT
  });
  const entity = payload.entities?.[wikidataId];
  const imageFileName = entity?.claims?.P18?.[0]?.mainsnak?.datavalue?.value || null;
  const wikipediaTitle = entity?.sitelinks?.enwiki?.title || null;

  return {
    wikidataId,
    wikidataUrl: `https://www.wikidata.org/wiki/${wikidataId}`,
    wikipediaUrl: wikipediaTitle
      ? `https://en.wikipedia.org/wiki/${encodeURIComponent(wikipediaTitle.replace(/ /g, '_'))}`
      : null,
    image: wikimediaFileUrl(imageFileName)
  };
}

function stripHtml(value) {
  return typeof value === 'string'
    ? value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
    : null;
}

function isLastFmPlaceholderImage(url) {
  if (typeof url !== 'string' || !url.trim()) {
    return true;
  }

  const normalizedUrl = url.trim().toLowerCase();

  return LASTFM_PLACEHOLDER_IMAGE_IDS.has(normalizedUrl.match(/\/([^/.]+)\.png(?:$|\?)/)?.[1])
    || normalizedUrl.includes('/2a96cbd8b46e442fc41c2b86b821562f.')
    || normalizedUrl.includes('default_album')
    || normalizedUrl.includes('noimage')
    || normalizedUrl.includes('placeholder');
}

function selectLastFmArtistImage(images) {
  if (!Array.isArray(images)) {
    return null;
  }

  const sizePriority = ['extralarge', 'large', 'medium', 'small'];

  for (const size of sizePriority) {
    const url = images.find((item) => item.size === size && item['#text'])?.['#text'];

    if (url && !isLastFmPlaceholderImage(url)) {
      return url;
    }
  }

  return null;
}

async function fetchLastFmArtist(artistName) {
  const apiKey = process.env.LASTFM_API_KEY;

  if (!apiKey) {
    return null;
  }

  const infoParams = new URLSearchParams({
    method: 'artist.getInfo',
    artist: artistName,
    api_key: apiKey,
    format: 'json',
    autocorrect: '1'
  });
  const topTracksParams = new URLSearchParams({
    method: 'artist.getTopTracks',
    artist: artistName,
    api_key: apiKey,
    format: 'json',
    autocorrect: '1',
    limit: '5'
  });
  const payload = await fetchJson(`https://ws.audioscrobbler.com/2.0/?${infoParams}`);
  let topTracksPayload = null;

  try {
    topTracksPayload = await fetchJson(`https://ws.audioscrobbler.com/2.0/?${topTracksParams}`);
  } catch (err) {
    console.warn(`Last.fm popular tracks unavailable for "${artistName}": ${err.message}`);
  }
  const artist = payload.artist;

  if (!artist) {
    return null;
  }

  const image = selectLastFmArtistImage(artist.image);
  const tags = Array.isArray(artist.tags?.tag)
    ? artist.tags.tag.map((tag) => tag.name).filter(Boolean)
    : [];
  const popularTracks = Array.isArray(topTracksPayload?.toptracks?.track)
    ? topTracksPayload.toptracks.track.map((track) => ({
      title: track.name,
      url: track.url || null,
      playcount: Number.isFinite(Number(track.playcount)) ? Number(track.playcount) : null
    })).filter((track) => track.title)
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
      : null,
    popularTracks
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
  const updatedAt = Date.parse(cached?.updatedAt || '');
  const isFresh = Number.isFinite(updatedAt) && Date.now() - updatedAt < CACHE_TTL_MS;
  const hasMusicBrainz = cached?.sources.includes('musicbrainz') || false;
  const hasLastFm = cached?.sources.includes('lastfm') || false;
  const shouldFetchLastFm = Boolean(process.env.LASTFM_API_KEY);
  const needsMappingRefresh = hasMusicBrainz
    && cached.mappingVersion !== CACHE_MAPPING_VERSION;

  if (
    cached
    && isFresh
    && hasMusicBrainz
    && (!shouldFetchLastFm || hasLastFm)
    && !needsMappingRefresh
  ) {
    return cached;
  }

  const metadata = {
    bio: cached?.bio || null,
    country: cached?.country || null,
    area: cached?.area || null,
    tags: cached?.tags || [],
    image: cached?.image || null,
    imageSource: cached?.imageSource || null,
    musicbrainzId: cached?.musicbrainzId || null,
    musicbrainzDisambiguation: cached?.musicbrainzDisambiguation || null,
    musicbrainzType: cached?.musicbrainzType || null,
    wikidataId: cached?.wikidataId || null,
    wikidataUrl: cached?.wikidataUrl || null,
    wikipediaUrl: cached?.wikipediaUrl || null,
    lastfmUrl: cached?.lastfmUrl || null,
    listeners: cached?.listeners ?? null,
    playcount: cached?.playcount ?? null,
    popularTracks: cached?.popularTracks || [],
    sources: cached?.sources ? [...cached.sources] : []
  };

  if (!isFresh || !hasMusicBrainz || needsMappingRefresh) {
    try {
      const musicBrainz = await fetchMusicBrainzArtist(artistName);

      if (musicBrainz) {
        metadata.country = musicBrainz.country;
        metadata.area = musicBrainz.area;
        metadata.tags = mergeTags(metadata.tags, musicBrainz.tags);
        metadata.musicbrainzId = musicBrainz.musicbrainzId;
        metadata.musicbrainzDisambiguation = musicBrainz.disambiguation;
        metadata.musicbrainzType = musicBrainz.type;
        metadata.sources = mergeTags(metadata.sources, ['musicbrainz']);
      }
    } catch (err) {
      console.warn(`MusicBrainz enrichment failed for "${artistName}": ${err.message}`);
    }
  }

  if (shouldFetchLastFm && (!isFresh || !hasLastFm)) {
    try {
      const lastFm = await fetchLastFmArtist(artistName);

      if (lastFm) {
        metadata.bio = lastFm.bio;
        metadata.tags = mergeTags(metadata.tags, lastFm.tags);
        if (lastFm.image && metadata.imageSource !== 'wikidata') {
          metadata.image = lastFm.image;
          metadata.imageSource = 'lastfm';
        }
        metadata.lastfmUrl = lastFm.lastfmUrl;
        metadata.listeners = lastFm.listeners;
        metadata.playcount = lastFm.playcount;
        metadata.popularTracks = lastFm.popularTracks;
        metadata.sources = mergeTags(metadata.sources, ['lastfm']);
      }
    } catch (err) {
      console.warn(`Last.fm enrichment failed for "${artistName}": ${err.message}`);
    }
  }

  if (!isFresh || needsMappingRefresh) {
    try {
      const wikidata = await fetchWikidataArtist(artistName, metadata.musicbrainzId);

      if (wikidata) {
        metadata.wikidataId = wikidata.wikidataId;
        metadata.wikidataUrl = wikidata.wikidataUrl;
        metadata.wikipediaUrl = wikidata.wikipediaUrl;
        if (wikidata.image) {
          metadata.image = wikidata.image;
          metadata.imageSource = 'wikidata';
        }
        metadata.sources = mergeTags(metadata.sources, ['wikidata']);
      }
    } catch (err) {
      console.warn(`Wikidata enrichment failed for "${artistName}": ${err.message}`);
    }
  }

  return saveCachedArtist(artistName, metadata);
}

module.exports = {
  CACHE_TTL_MS,
  enrichArtist,
  mergeTags,
  normalizedArtistKey
};
