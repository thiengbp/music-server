'use strict';

const db = require('../config/database');

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizedKey(value) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFC').trim().toLocaleLowerCase('vi');
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Weighted shuffle — Fisher-Yates variant.
 * Items with higher weight appear earlier more often.
 * Weight must be a positive number; defaults to 1 if missing.
 */
function weightedShuffle(items, getWeight) {
  const weighted = items.map((item) => ({
    item,
    key: Math.pow(Math.random(), 1 / (getWeight(item) || 1))
  }));
  weighted.sort((a, b) => b.key - a.key);
  return weighted.map((w) => w.item);
}

/**
 * Jaccard similarity between two arrays of strings (lowercased).
 * Returns 0–1.
 */
function jaccardSimilarity(tagsA, tagsB) {
  if (!tagsA.length || !tagsB.length) return 0;
  const setA = new Set(tagsA.map((t) => normalizedKey(t)));
  const setB = new Set(tagsB.map((t) => normalizedKey(t)));
  let intersection = 0;
  for (const tag of setA) {
    if (setB.has(tag)) intersection++;
  }
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

function sameNormalizedValue(left, right) {
  return normalizedKey(left || '') === normalizedKey(right || '');
}

// ---------------------------------------------------------------------------
// Local tag inference (mirrors artists.controller without DB dependency)
// ---------------------------------------------------------------------------

function inferLocalTags(artistName, trackTitles, albumTitles) {
  const searchableText = [artistName, ...trackTitles, ...albumTitles]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const tags = [];

  if (/(classical|concerto|sonata|symphony|arrau|beethoven|mozart|chopin|bach)/i.test(searchableText)) {
    tags.push('classical');
  }
  if (/(remix|mix|edit)/i.test(searchableText)) tags.push('remix');
  if (/(instrumental|piano|orchestra|solo)/i.test(searchableText)) tags.push('instrumental');
  if (/(pop|single|hit|love|dance)/i.test(searchableText)) tags.push('pop');

  return [...new Set(tags)];
}

// ---------------------------------------------------------------------------
// Core data loaders
// ---------------------------------------------------------------------------

/**
 * Load all artists present in the library with aggregated stats.
 * Returns: { name, trackCount, totalPlayCount, hasPlays, titles (sample) }
 */
async function loadLibraryArtists() {
  const rows = await dbAll(`
    SELECT
      COALESCE(NULLIF(TRIM(artist), ''), 'Unknown artist') AS name,
      COUNT(*) AS trackCount,
      SUM(COALESCE(play_count, 0)) AS totalPlayCount,
      GROUP_CONCAT(DISTINCT COALESCE(NULLIF(TRIM(album), ''), 'Unknown album')) AS albums,
      GROUP_CONCAT(title, '||') AS titles
    FROM tracks
    GROUP BY COALESCE(NULLIF(TRIM(artist), ''), 'Unknown artist')
  `);

  return rows.map((row) => ({
    name: row.name,
    trackCount: Number(row.trackCount || 0),
    totalPlayCount: Number(row.totalPlayCount || 0),
    hasPlays: Number(row.totalPlayCount || 0) > 0,
    albums: row.albums ? row.albums.split(',').slice(0, 5) : [],
    titles: row.titles ? row.titles.split('||').slice(0, 10) : []
  }));
}

/**
 * Load cached metadata for a list of artist names.
 * Returns a Map<normalizedKey, { tags, country, image }>
 */
async function loadCachedMetadataMap(artistNames) {
  if (!artistNames.length) return new Map();
  const keys = artistNames.map(normalizedKey);
  const placeholders = keys.map(() => '?').join(',');
  const rows = await dbAll(
    `SELECT normalized_key, tags_json, country, image FROM artist_metadata_cache WHERE normalized_key IN (${placeholders})`,
    keys
  );
  const map = new Map();
  for (const row of rows) {
    map.set(row.normalized_key, {
      tags: parseJsonArray(row.tags_json),
      country: row.country || null,
      image: row.image || null
    });
  }
  return map;
}

// ---------------------------------------------------------------------------
// Shared track loader (used by multiple radio functions)
// ---------------------------------------------------------------------------

async function loadTracksByArtist(artistName) {
  return dbAll(`
    SELECT
      t.id,
      t.title,
      t.artist,
      t.album,
      t.duration,
      t.play_count,
      t.last_played_at,
      CASE WHEN f.track_id IS NULL THEN 0 ELSE 1 END AS is_favorite
    FROM tracks t
    LEFT JOIN favorites f ON f.track_id = t.id
    WHERE LOWER(TRIM(COALESCE(t.artist, ''))) = LOWER(TRIM(?))
    ORDER BY t.play_count DESC, t.last_played_at DESC, t.id DESC
  `, [artistName.trim()]);
}

function normalizeTrack(track) {
  return {
    id: track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: track.duration,
    play_count: Number(track.play_count || 0),
    last_played_at: track.last_played_at || null,
    is_favorite: Boolean(track.is_favorite),
    cover: `/tracks/${track.id}/cover`
  };
}

// ---------------------------------------------------------------------------
// Similar Artists
// ---------------------------------------------------------------------------

/**
 * Returns similar artists to `artistName`, sorted by similarity score desc.
 * Only returns artists that are in the local library.
 * Max `limit` results.
 */
async function getSimilarArtists(artistName, limit = 12) {
  const targetKey = normalizedKey(artistName);

  // 1. Load all library artists
  const libraryArtists = await loadLibraryArtists();

  // 2. Load cached metadata for all of them + target
  const allNames = [artistName, ...libraryArtists.map((a) => a.name)];
  const metaMap = await loadCachedMetadataMap(allNames);

  // 3. Get target tags
  const targetMeta = metaMap.get(targetKey);
  let targetTags = targetMeta?.tags || [];
  const targetCountry = targetMeta?.country || null;

  // Fallback: infer tags locally if no cache
  const targetLibraryArtist = libraryArtists.find((a) => normalizedKey(a.name) === targetKey);
  if (!targetTags.length && targetLibraryArtist) {
    targetTags = inferLocalTags(artistName, targetLibraryArtist.titles, targetLibraryArtist.albums);
  }

  // 4. Score each library artist
  const scored = [];
  for (const candidate of libraryArtists) {
    const candidateKey = normalizedKey(candidate.name);
    if (candidateKey === targetKey) continue; // skip self
    if (candidate.name === 'Unknown artist') continue;

    const candidateMeta = metaMap.get(candidateKey);
    let candidateTags = candidateMeta?.tags || [];
    const candidateCountry = candidateMeta?.country || null;

    // Infer local tags as fallback
    if (!candidateTags.length) {
      candidateTags = inferLocalTags(candidate.name, candidate.titles, candidate.albums);
    }

    // Signal 1: Tag/genre overlap (Jaccard)
    const tagScore = jaccardSimilarity(targetTags, candidateTags);

    // Strict filter: if both sides have tags but share nothing, skip entirely.
    const bothHaveTags = targetTags.length > 0 && candidateTags.length > 0;
    if (tagScore === 0 && bothHaveTags) continue;

    if (tagScore === 0 && !bothHaveTags) {
      // Target has tags but candidate has none → no basis for comparison
      if (targetTags.length > 0) continue;
      // No tags on either side → require at least plays in library
      if (!candidate.hasPlays) continue;
    }

    // Signal 2: In library with plays (bonus, not gate)
    const playBonus = candidate.hasPlays ? 0.15 : 0;

    // Signal 3: Country match
    const countryBonus = (
      targetCountry &&
      candidateCountry &&
      sameNormalizedValue(targetCountry, candidateCountry)
    ) ? 0.10 : 0;

    const score = clamp(tagScore * 0.75 + playBonus + countryBonus, 0, 1);

    // Require minimum meaningful similarity — filters play-only (0.15) and country-only (0.10) results
    const MIN_SCORE = 0.20;
    if (score < MIN_SCORE) continue;

    scored.push({
      name: candidate.name,
      tags: candidateTags.slice(0, 5),
      trackCount: candidate.trackCount,
      totalPlayCount: candidate.totalPlayCount,
      image: candidateMeta?.image || null,
      score
    });
  }

  // 5. Sort by score desc, then by play count
  scored.sort((a, b) => b.score - a.score || b.totalPlayCount - a.totalPlayCount);

  return scored.slice(0, limit);
}

// ---------------------------------------------------------------------------
// Artist Radio
// ---------------------------------------------------------------------------

/**
 * Build a radio queue seeded from an artist.
 * Mix: ~70% target artist tracks + ~30% similar artists tracks.
 */
async function getArtistRadio(artistName, limit = 50) {
  const targetTracks = await loadTracksByArtist(artistName);

  if (targetTracks.length === 0) {
    return {
      tracks: [],
      seed: artistName,
      type: 'artist-radio',
      seedArtistTrackCount: 0,
      similarArtists: []
    };
  }

  // Get similar artists that have tracks in library
  const similar = await getSimilarArtists(artistName, 5);
  const similarWithTracks = similar.filter((a) => a.trackCount > 0).slice(0, 3);

  // Load tracks from similar artists
  const similarTrackArrays = await Promise.all(
    similarWithTracks.map((a) => loadTracksByArtist(a.name))
  );
  const similarTracks = similarTrackArrays.flat();

  // Weighted shuffle: target artist tracks have higher weight
  const targetWeighted = weightedShuffle(
    targetTracks.map(normalizeTrack),
    (t) => 1 + t.play_count * 0.5
  );

  const similarWeighted = weightedShuffle(
    similarTracks.map(normalizeTrack),
    (t) => 1 + t.play_count * 0.2
  );

  // Interleave: ~70% target, ~30% similar.
  // Cap similar based on actual artist track count to preserve ratio
  // even when artist has fewer tracks than limit.
  const artistAvailable = targetWeighted.length;
  const maxSimilar = artistAvailable > 0
    ? Math.round(artistAvailable * (30 / 70))  // maintain 70/30 ratio
    : Math.ceil(limit * 0.30);
  const targetCount = Math.min(artistAvailable, limit);
  const similarCount = Math.min(maxSimilar, similarWeighted.length, limit - targetCount);

  // Deduplicate by track id
  const seen = new Set();
  const result = [];

  for (const track of [...targetWeighted.slice(0, targetCount), ...similarWeighted.slice(0, similarCount)]) {
    if (seen.has(track.id)) continue;
    seen.add(track.id);
    result.push(track);
    if (result.length >= limit) break;
  }

  // Final light shuffle to mix target + similar
  const final = weightedShuffle(result, () => 1);

  return {
    tracks: final.slice(0, limit),
    seed: artistName,
    type: 'artist-radio',
    seedArtistTrackCount: targetTracks.length,
    similarArtists: similarWithTracks.map((a) => a.name)
  };
}

// ---------------------------------------------------------------------------
// Album Radio
// ---------------------------------------------------------------------------

/**
 * Build a radio queue seeded from an album.
 * Mix: album tracks first, then similar artist tracks.
 */
async function getAlbumRadio(albumName, artistName, limit = 50) {
  // Album tracks
  const albumTracks = await dbAll(`
    SELECT
      t.id, t.title, t.artist, t.album, t.duration, t.play_count, t.last_played_at,
      CASE WHEN f.track_id IS NULL THEN 0 ELSE 1 END AS is_favorite
    FROM tracks t
    LEFT JOIN favorites f ON f.track_id = t.id
    WHERE LOWER(TRIM(COALESCE(t.album, ''))) = LOWER(TRIM(?))
      ${artistName ? "AND LOWER(TRIM(COALESCE(t.artist, ''))) = LOWER(TRIM(?))" : ''}
    ORDER BY t.id ASC
  `, artistName ? [albumName, artistName] : [albumName]);

  // Resolve artist for similarity lookup
  const resolvedArtist = artistName
    || (albumTracks[0] ? albumTracks[0].artist : null);

  if (albumTracks.length === 0) {
    return {
      tracks: [],
      seed: albumName,
      seedArtist: resolvedArtist,
      type: 'album-radio'
    };
  }

  let similarTracks = [];
  if (resolvedArtist) {
    const similar = await getSimilarArtists(resolvedArtist, 3);
    const similarWithTracks = similar.filter((a) => a.trackCount > 0).slice(0, 2);
    const arrays = await Promise.all(similarWithTracks.map((a) => loadTracksByArtist(a.name)));
    similarTracks = arrays.flat();
  }

  // Album tracks first, then weighted-shuffled similar
  const seen = new Set();
  const result = albumTracks.map(normalizeTrack).filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });

  const similarShuffled = weightedShuffle(
    similarTracks.map(normalizeTrack),
    (t) => 1 + t.play_count * 0.2
  );

  for (const track of similarShuffled) {
    if (seen.has(track.id)) continue;
    seen.add(track.id);
    result.push(track);
    if (result.length >= limit) break;
  }

  // Fill remaining slots with random tracks if below limit
  if (result.length < limit) {
    const needed = limit - result.length;
    const placeholders = Array.from(seen).map(() => '?').join(',');
    const fallbackTracks = await dbAll(`
      SELECT t.id, t.title, t.artist, t.album, t.duration, t.play_count, t.last_played_at,
        CASE WHEN f.track_id IS NULL THEN 0 ELSE 1 END AS is_favorite
      FROM tracks t
      LEFT JOIN favorites f ON f.track_id = t.id
      ${seen.size > 0 ? `WHERE t.id NOT IN (${placeholders})` : ''}
      ORDER BY RANDOM() LIMIT ?
    `, [...seen, needed]);

    for (const track of fallbackTracks) {
      if (seen.has(track.id)) continue;
      seen.add(track.id);
      result.push(normalizeTrack(track));
      if (result.length >= limit) break;
    }
  }

  return {
    tracks: result.slice(0, limit),
    seed: albumName,
    seedArtist: resolvedArtist,
    type: 'album-radio'
  };
}

// ---------------------------------------------------------------------------
// Track Radio
// ---------------------------------------------------------------------------

/**
 * Build a radio queue seeded from a single track.
 * Priority: same album → same artist → similar artists.
 */
async function getTrackRadio(trackId, limit = 50) {
  const seed = await dbGet(`
    SELECT id, title, artist, album FROM tracks WHERE id = ?
  `, [trackId]);

  if (!seed) return null;

  // Same album (excluding seed)
  const albumTracks = await dbAll(`
    SELECT
      t.id, t.title, t.artist, t.album, t.duration, t.play_count, t.last_played_at,
      CASE WHEN f.track_id IS NULL THEN 0 ELSE 1 END AS is_favorite
    FROM tracks t
    LEFT JOIN favorites f ON f.track_id = t.id
    WHERE LOWER(TRIM(COALESCE(t.album, ''))) = LOWER(TRIM(?))
      AND t.id != ?
    ORDER BY t.id ASC
  `, [seed.album || '', seed.id]);

  // Same artist, different album
  const artistTracks = await dbAll(`
    SELECT
      t.id, t.title, t.artist, t.album, t.duration, t.play_count, t.last_played_at,
      CASE WHEN f.track_id IS NULL THEN 0 ELSE 1 END AS is_favorite
    FROM tracks t
    LEFT JOIN favorites f ON f.track_id = t.id
    WHERE LOWER(TRIM(COALESCE(t.artist, ''))) = LOWER(TRIM(?))
      AND LOWER(TRIM(COALESCE(t.album, ''))) != LOWER(TRIM(?))
      AND t.id != ?
    ORDER BY t.play_count DESC, t.id DESC
  `, [seed.artist || '', seed.album || '', seed.id]);

  // Similar artists
  let similarTracks = [];
  if (seed.artist) {
    const similar = await getSimilarArtists(seed.artist, 3);
    const similarWithTracks = similar.filter((a) => a.trackCount > 0).slice(0, 2);
    const arrays = await Promise.all(similarWithTracks.map((a) => loadTracksByArtist(a.name)));
    similarTracks = arrays.flat();
  }

  const seen = new Set([seed.id]);
  const result = [];

  const addTracks = (tracks, shuffled = false) => {
    const source = shuffled
      ? weightedShuffle(tracks.map(normalizeTrack), (t) => 1 + t.play_count * 0.3)
      : tracks.map(normalizeTrack);
    for (const track of source) {
      if (seen.has(track.id)) continue;
      seen.add(track.id);
      result.push(track);
      if (result.length >= limit) return;
    }
  };

  addTracks(albumTracks);
  addTracks(artistTracks, true);
  addTracks(similarTracks, true);

  // Fill remaining slots with random tracks if below limit
  if (result.length < limit) {
    const needed = limit - result.length;
    const placeholders = Array.from(seen).map(() => '?').join(',');
    const fallbackTracks = await dbAll(`
      SELECT t.id, t.title, t.artist, t.album, t.duration, t.play_count, t.last_played_at,
        CASE WHEN f.track_id IS NULL THEN 0 ELSE 1 END AS is_favorite
      FROM tracks t
      LEFT JOIN favorites f ON f.track_id = t.id
      ${seen.size > 0 ? `WHERE t.id NOT IN (${placeholders})` : ''}
      ORDER BY RANDOM() LIMIT ?
    `, [...seen, needed]);

    for (const track of fallbackTracks) {
      if (seen.has(track.id)) continue;
      seen.add(track.id);
      result.push(normalizeTrack(track));
      if (result.length >= limit) break;
    }
  }

  return {
    tracks: result.slice(0, limit),
    seed: { id: seed.id, title: seed.title, artist: seed.artist, album: seed.album },
    type: 'track-radio'
  };
}

// ---------------------------------------------------------------------------
// Auto Mix
// ---------------------------------------------------------------------------

/**
 * Mix from favorites + most played + recently played.
 */
async function getAutoMix(limit = 50) {
  const perBucket = Math.max(20, Math.ceil(limit / 3));

  const [mostPlayed, favorites, recentlyPlayed] = await Promise.all([
    dbAll(`
      SELECT t.id, t.title, t.artist, t.album, t.duration, t.play_count, t.last_played_at,
        CASE WHEN f.track_id IS NULL THEN 0 ELSE 1 END AS is_favorite
      FROM tracks t
      LEFT JOIN favorites f ON f.track_id = t.id
      WHERE t.play_count > 0
      ORDER BY t.play_count DESC LIMIT ?
    `, [perBucket]),
    dbAll(`
      SELECT t.id, t.title, t.artist, t.album, t.duration, t.play_count, t.last_played_at,
        1 AS is_favorite
      FROM tracks t
      INNER JOIN favorites f ON f.track_id = t.id
      ORDER BY f.created_at DESC LIMIT ?
    `, [perBucket]),
    dbAll(`
      SELECT t.id, t.title, t.artist, t.album, t.duration, t.play_count, t.last_played_at,
        CASE WHEN f.track_id IS NULL THEN 0 ELSE 1 END AS is_favorite
      FROM tracks t
      LEFT JOIN favorites f ON f.track_id = t.id
      WHERE t.last_played_at IS NOT NULL
      ORDER BY t.last_played_at DESC LIMIT ?
    `, [perBucket])
  ]);

  const seen = new Set();
  const pool = [];
  for (const track of [...mostPlayed, ...favorites, ...recentlyPlayed]) {
    if (seen.has(track.id)) continue;
    seen.add(track.id);
    pool.push(normalizeTrack(track));
  }

  let shuffled = weightedShuffle(pool, (t) => 1 + t.play_count * 0.3 + (t.is_favorite ? 0.5 : 0));

  // Fill remaining slots with random tracks if below limit
  if (shuffled.length < limit) {
    const poolSeen = new Set(shuffled.map((t) => t.id));
    const needed = limit - shuffled.length;
    const placeholders = Array.from(poolSeen).map(() => '?').join(',');
    const fallbackTracks = await dbAll(`
      SELECT t.id, t.title, t.artist, t.album, t.duration, t.play_count, t.last_played_at,
        CASE WHEN f.track_id IS NULL THEN 0 ELSE 1 END AS is_favorite
      FROM tracks t
      LEFT JOIN favorites f ON f.track_id = t.id
      ${poolSeen.size > 0 ? `WHERE t.id NOT IN (${placeholders})` : ''}
      ORDER BY RANDOM() LIMIT ?
    `, [...poolSeen, needed]);

    for (const track of fallbackTracks) {
      if (poolSeen.has(track.id)) continue;
      poolSeen.add(track.id);
      shuffled.push(normalizeTrack(track));
      if (shuffled.length >= limit) break;
    }
  }

  return {
    tracks: shuffled.slice(0, limit),
    type: 'auto-mix'
  };
}

// ---------------------------------------------------------------------------
// Daily Mix
// ---------------------------------------------------------------------------

/**
 * Personalized mix based on recent listening (last 7 days).
 * Seeds from top artists in that window, adds unplayed tracks too.
 */
async function getDailyMix(limit = 50) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Top artists in last 7 days
  const topArtists = await dbAll(`
    SELECT
      COALESCE(NULLIF(TRIM(t.artist), ''), 'Unknown artist') AS name,
      COUNT(*) AS recentPlays
    FROM play_history ph
    JOIN tracks t ON t.id = ph.track_id
    WHERE ph.played_at >= ?
      AND COALESCE(NULLIF(TRIM(t.artist), ''), 'Unknown artist') != 'Unknown artist'
    GROUP BY COALESCE(NULLIF(TRIM(t.artist), ''), 'Unknown artist')
    ORDER BY recentPlays DESC
    LIMIT 4
  `, [sevenDaysAgo]);

  // Fallback: if not enough recent history, use most played artists overall
  let seedArtists = topArtists;
  if (seedArtists.length < 2) {
    const fallback = await dbAll(`
      SELECT
        COALESCE(NULLIF(TRIM(artist), ''), 'Unknown artist') AS name,
        SUM(COALESCE(play_count, 0)) AS recentPlays
      FROM tracks
      WHERE COALESCE(NULLIF(TRIM(artist), ''), 'Unknown artist') != 'Unknown artist'
        AND play_count > 0
      GROUP BY COALESCE(NULLIF(TRIM(artist), ''), 'Unknown artist')
      ORDER BY recentPlays DESC
      LIMIT 4
    `);
    const seenArtistKeys = new Set();
    seedArtists = [...topArtists, ...fallback].filter((artist) => {
      const key = normalizedKey(artist.name);

      if (!key || seenArtistKeys.has(key)) {
        return false;
      }

      seenArtistKeys.add(key);
      return true;
    }).slice(0, 4);
  }

  // Fallback 3: if still no seed artists (fresh db with play_count = 0), get random artists in library
  if (seedArtists.length === 0) {
    const fallbackRandom = await dbAll(`
      SELECT
        COALESCE(NULLIF(TRIM(artist), ''), 'Unknown artist') AS name,
        0 AS recentPlays
      FROM tracks
      WHERE COALESCE(NULLIF(TRIM(artist), ''), 'Unknown artist') != 'Unknown artist'
      GROUP BY COALESCE(NULLIF(TRIM(artist), ''), 'Unknown artist')
      ORDER BY RANDOM()
      LIMIT 4
    `);
    seedArtists = fallbackRandom;
  }

  // For each seed artist: mix played + unplayed tracks
  const tracksPerArtist = Math.max(8, Math.ceil(limit / Math.max(seedArtists.length, 1)));
  const seen = new Set();
  const pool = [];

  for (const seedArtist of seedArtists.slice(0, 4)) {
    const artistTracks = await loadTracksByArtist(seedArtist.name);
    const half = Math.ceil(tracksPerArtist / 2);

    // Played tracks (weighted)
    const played = artistTracks.filter((t) => t.play_count > 0).slice(0, half);
    // Unplayed tracks (discovery element)
    const unplayed = artistTracks.filter((t) => t.play_count === 0).slice(0, half);

    for (const track of [...played, ...unplayed]) {
      if (seen.has(track.id)) continue;
      seen.add(track.id);
      pool.push(normalizeTrack(track));
    }
  }

  let shuffled = weightedShuffle(pool, (t) => 1 + t.play_count * 0.2 + (t.is_favorite ? 0.3 : 0));

  // Fill remaining slots with random tracks if below limit
  if (shuffled.length < limit) {
    const poolSeen = new Set(shuffled.map((t) => t.id));
    const needed = limit - shuffled.length;
    const placeholders = Array.from(poolSeen).map(() => '?').join(',');
    const fallbackTracks = await dbAll(`
      SELECT t.id, t.title, t.artist, t.album, t.duration, t.play_count, t.last_played_at,
        CASE WHEN f.track_id IS NULL THEN 0 ELSE 1 END AS is_favorite
      FROM tracks t
      LEFT JOIN favorites f ON f.track_id = t.id
      ${poolSeen.size > 0 ? `WHERE t.id NOT IN (${placeholders})` : ''}
      ORDER BY RANDOM() LIMIT ?
    `, [...poolSeen, needed]);

    for (const track of fallbackTracks) {
      if (poolSeen.has(track.id)) continue;
      poolSeen.add(track.id);
      shuffled.push(normalizeTrack(track));
      if (shuffled.length >= limit) break;
    }
  }

  return {
    tracks: shuffled.slice(0, limit),
    type: 'daily-mix',
    seedArtists: seedArtists.slice(0, 4).map((a) => a.name)
  };
}

// ---------------------------------------------------------------------------
// Because You Played
// ---------------------------------------------------------------------------

/**
 * Recommendation seeded from the most recently played track.
 */
async function getBecauseYouPlayed(limit = 50) {
  // Most recent play
  const recentPlay = await dbGet(`
    SELECT t.id, t.title, t.artist, t.album
    FROM play_history ph
    JOIN tracks t ON t.id = ph.track_id
    ORDER BY ph.played_at DESC
    LIMIT 1
  `);

  if (!recentPlay) {
    // Fallback to auto-mix if no history
    const mix = await getAutoMix(limit);
    return { ...mix, type: 'because-you-played', seed: null };
  }

  // Build an artist radio from the seed track's artist
  const radio = await getArtistRadio(recentPlay.artist || '', limit);

  // Remove the seed track from the result if present
  const tracks = radio.tracks.filter((t) => t.id !== recentPlay.id);

  return {
    tracks: tracks.slice(0, limit),
    seed: {
      id: recentPlay.id,
      title: recentPlay.title,
      artist: recentPlay.artist,
      album: recentPlay.album
    },
    type: 'because-you-played'
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  getSimilarArtists,
  getArtistRadio,
  getAlbumRadio,
  getTrackRadio,
  getAutoMix,
  getDailyMix,
  getBecauseYouPlayed
};
