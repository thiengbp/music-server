'use strict';

const db = require('../config/database');

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
    const genres = inferLocalTags(resolvedArtistName, artistTracks.slice(0, 25));
    const artistInfo = {
      name: resolvedArtistName,
      artist: resolvedArtistName,
      bio: null,
      country: null,
      genres,
      image: null,
      source: 'local',
      tags: genres,
      listeners: null,
      playcount: null,
      albumCount: albums.length,
      trackCount: artistTracks.length,
      albums: albums.map((album) => ({
        title: album.title,
        trackCount: album.trackCount,
        cover: `/tracks/${album.coverTrackId}/cover`
      })),
      topTracks: topTracks.map((track) => ({
        id: track.id,
        title: track.title.normalize('NFC'),
        album: albumTitle(track.album),
        duration: track.duration,
        cover: `/tracks/${track.id}/cover`
      })),
      externalIds: {},
      updatedAt: new Date().toISOString(),
      cached: false
      // TODO: A future phase can enrich this local response with MusicBrainz or Last.fm.
    };

    return res.json(artistInfo);
  } catch (err) {
    return res.json({
      name: artistName,
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
      albums: [],
      topTracks: [],
      externalIds: {},
      updatedAt: new Date().toISOString(),
      cached: false
    });
  }
}

module.exports = {
  getArtistInfo
};
