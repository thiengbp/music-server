'use strict';

const db = require('../config/database');

const ARTIST_INFO_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MUSICBRAINZ_TIMEOUT_MS = 3500;
const artistInfoCache = new Map();

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

function normalizeArtistName(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const decodedValue = decodeURIComponent(value).trim();
  return decodedValue.length > 0 ? decodedValue : null;
}

function artistCacheKey(artistName) {
  return `artist:${artistName.trim().toLowerCase()}`;
}

function getCachedArtistInfo(artistName) {
  const cached = artistInfoCache.get(artistCacheKey(artistName));

  if (!cached || Date.now() - cached.cachedAt > ARTIST_INFO_CACHE_TTL_MS) {
    return null;
  }

  return {
    ...cached.data,
    cached: true
  };
}

function setCachedArtistInfo(artistName, data) {
  artistInfoCache.set(artistCacheKey(artistName), {
    cachedAt: Date.now(),
    data
  });
}

function inferLocalTags(artistName, tracks) {
  const searchableText = [artistName, ...tracks.flatMap((track) => [
    track.title,
    track.album
  ])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const tags = [];

  if (artistName === 'Unknown artist') {
    tags.push('Unknown');
  }

  if (/(classical|concerto|sonata|symphony|arrau|beethoven|mozart|chopin|bach)/i.test(searchableText)) {
    tags.push('Classical');
  }

  if (/(remix|mix|edit)/i.test(searchableText)) {
    tags.push('Remix');
  }

  if (/(instrumental|piano|orchestra|solo)/i.test(searchableText)) {
    tags.push('Instrumental');
  }

  if (/(pop|single|hit|love|dance)/i.test(searchableText)) {
    tags.push('Pop');
  }

  return [...new Set(tags)].slice(0, 3);
}

function normalizeMusicBrainzTags(tags) {
  if (!Array.isArray(tags)) {
    return [];
  }

  return tags
    .slice()
    .sort((a, b) => (b.count || 0) - (a.count || 0))
    .map((tag) => tag.name)
    .filter((tag) => typeof tag === 'string' && tag.trim().length > 0)
    .slice(0, 3);
}

async function fetchMusicBrainzArtistInfo(artistName) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MUSICBRAINZ_TIMEOUT_MS);
  const url = new URL('https://musicbrainz.org/ws/2/artist/');

  url.searchParams.set('query', `artist:"${artistName}"`);
  url.searchParams.set('fmt', 'json');
  url.searchParams.set('limit', '1');

  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'music-server/1.0.0 (local-development)'
      },
      signal: controller.signal
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const artist = Array.isArray(data.artists) ? data.artists[0] : null;

    if (!artist) {
      return null;
    }

    const genres = normalizeMusicBrainzTags(artist.tags);

    return {
      artist: artist.name || artistName,
      bio: artist.disambiguation || null,
      country: artist.country || null,
      genres,
      image: null,
      source: 'musicbrainz',
      mbid: artist.id || null
    };
  } catch (err) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function getArtistInfo(req, res) {
  const artistName = normalizeArtistName(req.params.name);

  if (!artistName) {
    return res.status(400).json({
      error: 'Invalid artist name'
    });
  }

  try {
    const cachedArtistInfo = getCachedArtistInfo(artistName);

    if (cachedArtistInfo) {
      return res.json(cachedArtistInfo);
    }

    const stats = await dbGet(`
      SELECT
        COUNT(*) AS trackCount,
        COUNT(DISTINCT NULLIF(TRIM(album), '')) AS albumCount
      FROM tracks
      WHERE COALESCE(NULLIF(TRIM(artist), ''), 'Unknown artist') = ?
    `, [artistName]);
    const topTracks = await dbAll(`
      SELECT
        id,
        title
      FROM tracks
      WHERE COALESCE(NULLIF(TRIM(artist), ''), 'Unknown artist') = ?
      ORDER BY created_at DESC, id DESC
      LIMIT 3
    `, [artistName]);
    const tagTracks = await dbAll(`
      SELECT
        title,
        album
      FROM tracks
      WHERE COALESCE(NULLIF(TRIM(artist), ''), 'Unknown artist') = ?
      LIMIT 25
    `, [artistName]);
    const localTags = inferLocalTags(artistName, tagTracks);
    const onlineInfo = artistName === 'Unknown artist'
      ? null
      : await fetchMusicBrainzArtistInfo(artistName);
    const genres = onlineInfo && onlineInfo.genres.length > 0
      ? onlineInfo.genres
      : localTags;
    const source = onlineInfo ? onlineInfo.source : 'local';
    const artistInfo = {
      artist: onlineInfo ? onlineInfo.artist : artistName,
      bio: onlineInfo ? onlineInfo.bio : null,
      country: onlineInfo ? onlineInfo.country : null,
      genres,
      image: onlineInfo ? onlineInfo.image : null,
      source,
      tags: genres,
      listeners: null,
      playcount: null,
      albumCount: stats ? stats.albumCount : 0,
      trackCount: stats ? stats.trackCount : 0,
      topTracks,
      updatedAt: new Date().toISOString(),
      cached: false
      // TODO: Add optional Last.fm enrichment if an API key is configured.
    };

    setCachedArtistInfo(artistName, artistInfo);

    return res.json(artistInfo);
  } catch (err) {
    return res.json({
      artist: artistName,
      bio: null,
      country: null,
      genres: [],
      image: null,
      source: 'local',
      tags: [],
      listeners: null,
      playcount: null,
      albumCount: 0,
      trackCount: 0,
      topTracks: [],
      updatedAt: new Date().toISOString(),
      cached: false
    });
  }
}

module.exports = {
  getArtistInfo
};
