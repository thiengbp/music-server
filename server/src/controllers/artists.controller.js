'use strict';

const db = require('../config/database');
const artistEnrichmentService = require('../services/artist-enrichment.service');

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

  const artistName = value.normalize('NFC').trim();
  return artistName.length > 0 ? artistName : null;
}

function artistMatchKey(value, stripAccents = false) {
  const artistName = normalizeArtistName(value) || 'Unknown artist';
  const normalizedName = stripAccents
    ? artistName.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    : artistName;

  return normalizedName.toLocaleLowerCase('vi');
}

function albumTitle(value) {
  return typeof value === 'string' && value.trim()
    ? value.normalize('NFC').trim()
    : 'Unknown album';
}

function selectArtistTracks(tracks, artistName) {
  const exactKey = artistMatchKey(artistName);
  const exactMatches = tracks.filter((track) => artistMatchKey(track.artist) === exactKey);

  if (exactMatches.length > 0) {
    return exactMatches;
  }

  const fallbackKey = artistMatchKey(artistName, true);
  return tracks.filter((track) => artistMatchKey(track.artist, true) === fallbackKey);
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

async function getArtistInfo(req, res) {
  const artistName = normalizeArtistName(req.params.name);

  if (!artistName) {
    return res.status(400).json({
      error: 'Invalid artist name'
    });
  }

  try {
    const libraryTracks = await dbAll(`
      SELECT
        id,
        title,
        artist,
        album,
        duration,
        created_at
      FROM tracks
    `);
    const artistTracks = selectArtistTracks(libraryTracks, artistName);
    const resolvedArtistName = normalizeArtistName(
      artistTracks.find((track) => normalizeArtistName(track.artist))?.artist
    ) || artistName;
    const albumGroups = new Map();

    artistTracks.forEach((track) => {
      const title = albumTitle(track.album);
      const existingAlbum = albumGroups.get(title);

      if (existingAlbum) {
        existingAlbum.trackCount += 1;
      } else {
        albumGroups.set(title, {
          title,
          trackCount: 1,
          coverTrackId: track.id
        });
      }
    });

    const albums = [...albumGroups.values()]
      .sort((a, b) => b.trackCount - a.trackCount || a.title.localeCompare(b.title));
    const topTracks = [...artistTracks]
      .sort((a, b) => {
        const dateDifference = Date.parse(b.created_at || '') - Date.parse(a.created_at || '');
        return dateDifference || b.id - a.id;
      })
      .slice(0, 5);
    const localGenres = inferLocalTags(resolvedArtistName, artistTracks.slice(0, 25));
    const canEnrichOnline = artistMatchKey(resolvedArtistName, true) !== artistMatchKey('Unknown artist', true);
    let onlineMetadata = null;

    if (canEnrichOnline) {
      try {
        onlineMetadata = await artistEnrichmentService.enrichArtist(resolvedArtistName);
      } catch (err) {
        console.warn(`Artist enrichment unavailable for "${resolvedArtistName}": ${err.message}`);
      }
    }
    const genres = artistEnrichmentService.mergeTags(
      localGenres,
      onlineMetadata?.tags || []
    ).slice(0, 6);
    const onlineSources = onlineMetadata?.sources || [];
    const source = ['local', ...onlineSources].join('+');
    const localTopTracks = topTracks.map((track) => ({
      id: track.id,
      title: track.title.normalize('NFC'),
      album: albumTitle(track.album),
      duration: track.duration,
      cover: `/tracks/${track.id}/cover`
    }));
    const artistInfo = {
      name: resolvedArtistName,
      artist: resolvedArtistName,
      bio: onlineMetadata?.bio || null,
      country: onlineMetadata?.country || null,
      area: onlineMetadata?.area || null,
      genres,
      image: onlineMetadata?.image || null,
      imageSource: onlineMetadata?.imageSource || null,
      source,
      tags: genres,
      listeners: onlineMetadata?.listeners ?? null,
      playcount: onlineMetadata?.playcount ?? null,
      albumCount: albums.length,
      trackCount: artistTracks.length,
      albums: albums.map((album) => ({
        title: album.title,
        trackCount: album.trackCount,
        cover: `/tracks/${album.coverTrackId}/cover`
      })),
      topTracks: localTopTracks,
      popularTracks: onlineMetadata?.popularTracks?.length > 0
        ? onlineMetadata.popularTracks
        : localTopTracks,
      popularTracksSource: onlineMetadata?.popularTracks?.length > 0 ? 'lastfm' : 'local',
      externalIds: {
        musicbrainz: onlineMetadata?.musicbrainzId || null,
        lastfm: onlineMetadata?.lastfmUrl || null,
        wikidata: onlineMetadata?.wikidataId || null
      },
      wikidataUrl: onlineMetadata?.wikidataUrl || null,
      wikipediaUrl: onlineMetadata?.wikipediaUrl || null,
      disambiguation: onlineMetadata?.musicbrainzDisambiguation || null,
      artistType: onlineMetadata?.musicbrainzType || null,
      updatedAt: onlineMetadata?.updatedAt || new Date().toISOString(),
      cached: onlineMetadata?.cached || false
    };

    return res.json(artistInfo);
  } catch (err) {
    return res.json({
      name: artistName,
      artist: artistName,
      bio: null,
      country: null,
      area: null,
      genres: [],
      image: null,
      source: 'local',
      tags: [],
      listeners: null,
      playcount: null,
      albumCount: 0,
      trackCount: 0,
      albums: [],
      topTracks: [],
      popularTracks: [],
      popularTracksSource: 'local',
      externalIds: {},
      updatedAt: new Date().toISOString(),
      cached: false
    });
  }
}

module.exports = {
  getArtistInfo
};
