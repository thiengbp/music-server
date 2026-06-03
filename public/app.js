'use strict';

const QUEUE_STORAGE_KEY = 'music-server.queue.v1';
const PLAYLISTS_STORAGE_KEY = 'music-server.playlists.v1';
const PLAYLISTS_BACKUP_STORAGE_KEY = `${PLAYLISTS_STORAGE_KEY}.backup`;
const PLAYER_STATE_STORAGE_KEY = 'music-server.player-state.v1';
const RECENT_TRACKS_STORAGE_KEY = 'music-server.recent-tracks.v1';
const LEARNED_DURATIONS_STORAGE_KEY = 'music-server.learned-durations.v1';
const AUTO_SCAN_LAST_SCAN_STORAGE_KEY = 'musicServer.autoScan.lastScanAt';
const ARTIST_INFO_CACHE_KEY = 'music-server.artist-info-cache.v1';
const ARTIST_INFO_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const COVER_URL_VERSION = 'v2';
const RECENT_TRACK_LIMIT = 50;
const DEFAULT_AUTO_SCAN_INTERVAL_MINUTES = 30;

const trackList = document.getElementById('track-list');
const albumsList = document.getElementById('albums-list');
const artistsList = document.getElementById('artists-list');
const favoritesList = document.getElementById('favorites-list');
const recentlyAddedList = document.getElementById('recently-added-list');
const recentlyList = document.getElementById('recently-list');
const playlistsList = document.getElementById('playlists-list');
const queueList = document.getElementById('queue-list');
const statusMessage = document.getElementById('status');
const recentlyStatus = document.getElementById('recently-status');
const queueTitle = document.getElementById('queue-title');
const searchInput = document.getElementById('search-input');
const favoritesFilterButton = document.getElementById('favorites-filter');
const audioPlayer = document.getElementById('audio-player');
const shuffleButton = document.getElementById('shuffle-button');
const previousButton = document.getElementById('previous-button');
const playButton = document.getElementById('play-button');
const nextButton = document.getElementById('next-button');
const repeatButton = document.getElementById('repeat-button');
const progressInput = document.getElementById('progress-input');
const currentTimeLabel = document.getElementById('current-time');
const durationTimeLabel = document.getElementById('duration-time');
const volumeInput = document.getElementById('volume-input');
const nowTitle = document.getElementById('now-title');
const nowArtist = document.getElementById('now-artist');
const coverArt = document.getElementById('cover-art');
const coverPlaceholder = document.getElementById('cover-placeholder');
const heroCoverArt = document.getElementById('hero-cover-art');
const heroCoverPlaceholder = document.getElementById('hero-cover-placeholder');
const heroTitle = document.getElementById('hero-title');
const heroMeta = document.getElementById('hero-meta');
const heroArtistInfoTitle = document.getElementById('hero-artist-info-title');
const heroArtistInfoBio = document.getElementById('hero-artist-info-bio');
const heroArtistInfoSources = document.getElementById('hero-artist-info-sources');
const heroArtistTrackCount = document.getElementById('hero-artist-track-count');
const heroArtistAlbumCount = document.getElementById('hero-artist-album-count');
const heroArtistListeners = document.getElementById('hero-artist-listeners');
const heroArtistTags = document.getElementById('hero-artist-tags');
const heroArtistTopTracks = document.getElementById('hero-artist-top-tracks');
const heroArtistAvatar = document.getElementById('hero-artist-avatar');

let searchTimer = null;
let activeTrackId = null;
let allTracks = [];
let tracks = [];
let favoriteTracks = [];
let recentTracks = [];
let currentTrackIndex = -1;
let isShuffleEnabled = false;
let repeatMode = 'off';
let activeLibraryTab = 'songs';
let selectedAlbumName = null;
let selectedArtistName = null;
let selectedPlaylistId = null;
let lastSeenAutoScanAt = null;
let autoScanTimerId = null;
let isAutoScanning = false;
let lastAutoScanAt = null;
let savedPlayerState = normalizePlayerState(readStoredObject(PLAYER_STATE_STORAGE_KEY));
let queueTrackIds = savedPlayerState.queueTrackIds.length > 0
  ? [...savedPlayerState.queueTrackIds]
  : readStoredArray(QUEUE_STORAGE_KEY);
let queueActiveIndex = -1;
let queueHistory = Array.isArray(savedPlayerState.queueHistory)
  ? [...savedPlayerState.queueHistory]
  : [];
let playbackContext = normalizePlaybackContext(savedPlayerState.playbackContext);
let playlists = readStoredPlaylists();
let recentTrackIds = normalizeTrackIds(readStoredArray(RECENT_TRACKS_STORAGE_KEY), RECENT_TRACK_LIMIT);
let artistInfoCache = readStoredObject(ARTIST_INFO_CACHE_KEY);
let activeArtistInfoRequest = null;
let pendingResumeTime = null;
let hasRestoredPlayer = false;
let isRestoringPlayer = false;
let lastPlayerStateSaveAt = 0;
let canonicalDuration = 0;
let canonicalDurationTrackId = null;
const coverObjectUrlCache = new Map();
const trackDurationCache = new Map(
  Object.entries(readStoredObject(LEARNED_DURATIONS_STORAGE_KEY))
    .map(([trackId, duration]) => [Number(trackId), positiveFiniteNumber(Number(duration))])
    .filter(([trackId, duration]) => Number.isInteger(trackId) && duration)
);
const trackRatings = new Map();

function readStoredArray(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value : [];
  } catch (err) {
    return [];
  }
}

function readStoredObject(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch (err) {
    return {};
  }
}

function writeStoredArray(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function writeStoredObject(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function loadAutoScanSettings() {
  lastAutoScanAt = localStorage.getItem(AUTO_SCAN_LAST_SCAN_STORAGE_KEY);
}

function saveAutoScanSettings() {
  if (lastAutoScanAt) {
    localStorage.setItem(AUTO_SCAN_LAST_SCAN_STORAGE_KEY, lastAutoScanAt);
  }
}

function trackIdFromValue(value) {
  if (Number.isInteger(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const trackId = Number(value);
    return Number.isInteger(trackId) ? trackId : null;
  }

  if (value && typeof value === 'object') {
    if (Object.prototype.hasOwnProperty.call(value, 'id')) {
      return trackIdFromValue(value.id);
    }

    if (Object.prototype.hasOwnProperty.call(value, 'trackId')) {
      return trackIdFromValue(value.trackId);
    }

    if (value.track && typeof value.track === 'object') {
      return trackIdFromValue(value.track);
    }
  }

  return null;
}

function normalizeTrackIds(value, limit = Infinity) {
  const seenTrackIds = new Set();
  const trackIds = [];

  if (!Array.isArray(value)) {
    return trackIds;
  }

  value.forEach((item) => {
    const trackId = trackIdFromValue(item);

    if (!Number.isInteger(trackId) || seenTrackIds.has(trackId)) {
      return;
    }

    seenTrackIds.add(trackId);
    trackIds.push(trackId);
  });

  return trackIds.slice(0, limit);
}

function normalizePlaylist(playlist, options = {}) {
  const storedTrackIds = Array.isArray(playlist.trackIds) ? playlist.trackIds : [];
  const storedTracks = Array.isArray(playlist.tracks) ? playlist.tracks : [];
  const normalizedPlaylist = {
    id: typeof playlist.id === 'string'
      ? playlist.id
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: typeof playlist.name === 'string' && playlist.name.trim()
      ? playlist.name.trim()
      : 'Untitled playlist',
    trackIds: normalizeTrackIds([...storedTrackIds, ...storedTracks])
  };

  if (options.preserveLegacyTracks) {
    const legacyTracks = storedTracks.filter((track) => (
      track && typeof track === 'object' && Number.isInteger(trackIdFromValue(track))
    ));

    if (legacyTracks.length > 0) {
      normalizedPlaylist.tracks = legacyTracks;
    }
  }

  return normalizedPlaylist;
}

function normalizePlaylists(value, options = {}) {
  return value
    .filter((playlist) => playlist && typeof playlist === 'object')
    .map((playlist) => normalizePlaylist(playlist, options));
}

function playlistTrackIds(playlist) {
  return normalizeTrackIds([
    ...(Array.isArray(playlist.trackIds) ? playlist.trackIds : []),
    ...(Array.isArray(playlist.tracks) ? playlist.tracks : [])
  ]);
}

function playlistMatchKey(playlist) {
  if (typeof playlist.id === 'string' && playlist.id) {
    return `id:${playlist.id}`;
  }

  return `name:${playlist.name}`;
}

function readStoredPlaylists() {
  const currentPlaylists = normalizePlaylists(readStoredArray(PLAYLISTS_STORAGE_KEY), {
    preserveLegacyTracks: true
  });
  const backupPlaylists = normalizePlaylists(readStoredArray(PLAYLISTS_BACKUP_STORAGE_KEY), {
    preserveLegacyTracks: true
  });

  if (backupPlaylists.length === 0) {
    return currentPlaylists;
  }

  const backupByKey = new Map(backupPlaylists.map((playlist) => [playlistMatchKey(playlist), playlist]));

  return currentPlaylists.map((playlist) => {
    if (playlist.trackIds.length > 0) {
      return playlist;
    }

    const backupPlaylist = backupByKey.get(playlistMatchKey(playlist));

    return backupPlaylist && backupPlaylist.trackIds.length > 0
      ? { ...playlist, trackIds: backupPlaylist.trackIds }
      : playlist;
  });
}

function backupPlaylistsBeforeWrite() {
  if (localStorage.getItem(PLAYLISTS_BACKUP_STORAGE_KEY)) {
    return;
  }

  const currentValue = localStorage.getItem(PLAYLISTS_STORAGE_KEY);

  if (currentValue !== null) {
    localStorage.setItem(PLAYLISTS_BACKUP_STORAGE_KEY, currentValue);
  }
}

function hasPlaylistNormalizationLossRisk(value) {
  return value.some((playlist) => {
    if (!playlist || typeof playlist !== 'object' || !Array.isArray(playlist.tracks) || playlist.tracks.length === 0) {
      return false;
    }

    const trackIds = playlistTrackIds(playlist);

    return trackIds.length === 0;
  });
}

function normalizePlayerState(value) {
  const repeatValues = new Set(['off', 'all', 'one']);
  const libraryTabs = new Set([
    'songs',
    'albums',
    'artists',
    'favorites',
    'recentAdded',
    'recent',
    'playlists',
    'queue'
  ]);
  const volume = Number(value.volume);
  const currentTime = Number(value.currentTime);

  return {
    currentTrackId: Number.isInteger(value.currentTrackId) ? value.currentTrackId : null,
    currentTime: Number.isFinite(currentTime) && currentTime >= 0 ? currentTime : 0,
    volume: Number.isFinite(volume) && volume >= 0 && volume <= 1 ? volume : 1,
    shuffle: Boolean(value.shuffle),
    repeat: repeatValues.has(value.repeat) ? value.repeat : 'off',
    queueTrackIds: Array.isArray(value.queueTrackIds)
      ? value.queueTrackIds.filter((trackId) => Number.isInteger(trackId))
      : [],
    queueActiveIndex: Number.isInteger(value.queueActiveIndex) ? value.queueActiveIndex : -1,
    queueHistory: Array.isArray(value.queueHistory)
      ? value.queueHistory.filter((item) => (
        item &&
        Number.isInteger(item.trackId) &&
        (item.source === 'queue' || item.source === 'context')
      )).slice(-50)
      : [],
    playbackContext: normalizePlaybackContext(value.playbackContext),
    activeLibraryTab: libraryTabs.has(value.activeLibraryTab) ? value.activeLibraryTab : 'songs',
    selectedPlaylistId: typeof value.selectedPlaylistId === 'string' ? value.selectedPlaylistId : null,
    paused: value.paused !== false
  };
}

function normalizePlaybackContext(value) {
  if (!value || typeof value !== 'object') {
    return {
      contextType: 'songs',
      contextId: null,
      orderedTrackIds: [],
      currentIndex: -1
    };
  }

  return {
    contextType: typeof value.contextType === 'string' ? value.contextType : 'songs',
    contextId: typeof value.contextId === 'string' ? value.contextId : null,
    orderedTrackIds: Array.isArray(value.orderedTrackIds)
      ? value.orderedTrackIds.filter((trackId) => Number.isInteger(trackId))
      : [],
    currentIndex: Number.isInteger(value.currentIndex) ? value.currentIndex : -1
  };
}

function saveQueue() {
  writeStoredArray(QUEUE_STORAGE_KEY, queueTrackIds);
  savePlayerState();
}

function savePlaylists() {
  backupPlaylistsBeforeWrite();

  if (hasPlaylistNormalizationLossRisk(playlists)) {
    statusMessage.textContent = 'Playlist migration skipped to avoid losing legacy tracks';
    return;
  }

  playlists = normalizePlaylists(playlists);
  writeStoredArray(PLAYLISTS_STORAGE_KEY, playlists);
}

function saveRecentlyPlayed() {
  recentTrackIds = normalizeTrackIds(recentTrackIds, RECENT_TRACK_LIMIT);
  writeStoredArray(RECENT_TRACKS_STORAGE_KEY, recentTrackIds);
}

function savePlayerState() {
  if (isRestoringPlayer) {
    return;
  }

  writeStoredObject(PLAYER_STATE_STORAGE_KEY, {
    currentTrackId: activeTrackId,
    currentTime: Number.isFinite(audioPlayer.currentTime) ? audioPlayer.currentTime : 0,
    volume: Number.isFinite(audioPlayer.volume) ? audioPlayer.volume : Number(volumeInput.value),
    shuffle: isShuffleEnabled,
    repeat: repeatMode,
    queueTrackIds,
    queueActiveIndex,
    queueHistory,
    playbackContext,
    activeLibraryTab,
    selectedPlaylistId,
    paused: audioPlayer.paused,
    updatedAt: new Date().toISOString()
  });
}

function savePlayerStateThrottled() {
  const now = Date.now();

  if (now - lastPlayerStateSaveAt < 1000) {
    return;
  }

  lastPlayerStateSaveAt = now;
  savePlayerState();
}

function restoreSavedPreferences() {
  isShuffleEnabled = savedPlayerState.shuffle;
  repeatMode = savedPlayerState.repeat;
  audioPlayer.volume = savedPlayerState.volume;
  volumeInput.value = String(savedPlayerState.volume);
  activeLibraryTab = savedPlayerState.activeLibraryTab;
  selectedPlaylistId = savedPlayerState.selectedPlaylistId;
  if (savedPlayerState.playbackContext.contextType === 'album') {
    selectedAlbumName = savedPlayerState.playbackContext.contextId;
  } else if (savedPlayerState.playbackContext.contextType === 'artist') {
    selectedArtistName = savedPlayerState.playbackContext.contextId;
  }
}

function restorePlayerFromState() {
  if (hasRestoredPlayer) {
    return;
  }

  hasRestoredPlayer = true;

  if (!savedPlayerState.currentTrackId) {
    return;
  }

  const track = findTrackById(savedPlayerState.currentTrackId);

  if (!track) {
    return;
  }

  isRestoringPlayer = true;
  playbackContext = normalizePlaybackContext(savedPlayerState.playbackContext);
  activeTrackId = track.id;
  currentTrackIndex = playbackContext.currentIndex >= 0
    ? playbackContext.currentIndex
    : tracks.findIndex((currentTrack) => currentTrack.id === track.id);
  queueActiveIndex = -1;
  pendingResumeTime = savedPlayerState.currentTime;
  loadTrackIntoPlayer(track);
  audioPlayer.pause();
  renderLibrary();
  syncActiveTrack();
  updateQueueControls();
  updatePlayButton();
  isRestoringPlayer = false;
}

function formatTime(secondsValue) {
  if (!Number.isFinite(secondsValue) || secondsValue < 0) {
    return '0:00';
  }

  const totalSeconds = Math.floor(secondsValue);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function hydrateTrack(track) {
  if (!track || !Number.isInteger(track.id)) {
    return track;
  }

  const latestTrack = findTrackById(track.id);
  return latestTrack ? { ...track, ...latestTrack } : track;
}

function positiveFiniteNumber(value) {
  return Number.isFinite(value) && value > 0 ? value : null;
}

function activeTrack() {
  return findTrackById(activeTrackId);
}

function audioDuration() {
  return positiveFiniteNumber(audioPlayer.duration);
}

function audioSeekableEnd() {
  const seekable = audioPlayer.seekable;

  if (!seekable || seekable.length === 0) {
    return null;
  }

  try {
    return positiveFiniteNumber(seekable.end(seekable.length - 1));
  } catch (err) {
    return null;
  }
}

function activeTrackApiDuration() {
  const track = activeTrack();
  return track ? positiveFiniteNumber(Number(track.duration)) : null;
}

function cacheTrackDuration(trackId, duration) {
  const normalizedDuration = positiveFiniteNumber(duration);

  if (!Number.isInteger(trackId) || !normalizedDuration) {
    return;
  }

  const currentDuration = trackDurationCache.get(trackId) || 0;

  if (normalizedDuration > currentDuration) {
    trackDurationCache.set(trackId, normalizedDuration);
    writeStoredObject(
      LEARNED_DURATIONS_STORAGE_KEY,
      Object.fromEntries(trackDurationCache.entries())
    );
  }
}

function getTrackDisplayDuration(track) {
  const hydratedTrack = hydrateTrack(track);
  const apiDuration = hydratedTrack ? positiveFiniteNumber(Number(hydratedTrack.duration)) : null;

  if (apiDuration) {
    return apiDuration;
  }

  const learnedDuration = hydratedTrack
    ? positiveFiniteNumber(trackDurationCache.get(hydratedTrack.id))
    : null;

  if (learnedDuration) {
    return learnedDuration;
  }

  return hydratedTrack && hydratedTrack.id === activeTrackId && canonicalDuration > 0
    ? canonicalDuration
    : null;
}

function formatTrackDuration(track) {
  const duration = getTrackDisplayDuration(track);
  return duration ? formatTime(duration) : 'Unknown duration';
}

function syncTrackDurationLabels() {
  document.querySelectorAll('[data-duration-track-id]').forEach((label) => {
    const track = findTrackById(Number(label.dataset.durationTrackId));

    if (track) {
      label.textContent = formatTrackDuration(track);
    }
  });
}

function canonicalPlayerDuration() {
  if (canonicalDurationTrackId !== activeTrackId) {
    canonicalDurationTrackId = activeTrackId;
    canonicalDuration = 0;
  }

  const audioDur = audioDuration();
  const seekableDur = audioSeekableEnd();
  const apiDur = activeTrackApiDuration();
  const nextDuration = audioDur || seekableDur || apiDur || 0;

  if (nextDuration > canonicalDuration) {
    canonicalDuration = nextDuration;
    cacheTrackDuration(activeTrackId, canonicalDuration);
  }

  return canonicalDuration;
}

function formatArtist(track) {
  return track.artist || 'Unknown artist';
}

function formatAlbum(track) {
  return track.album || 'Unknown album';
}

function formatGenre(track) {
  if (Array.isArray(track.genres) && track.genres.length > 0) {
    return track.genres.filter(Boolean).join(', ') || '—';
  }

  return track.genre || '—';
}

function formatYear(track) {
  const value = track.year || track.releaseYear || track.date || track.releaseDate;

  if (!value) {
    return '—';
  }

  const match = String(value).match(/\d{4}/);
  return match ? match[0] : '—';
}

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase();
}

function trackMatchesSearch(track, query) {
  const normalizedQuery = normalizeSearchText(query).trim();

  if (!normalizedQuery) {
    return true;
  }

  return [
    track.title,
    formatArtist(track),
    formatAlbum(track)
  ].some((value) => normalizeSearchText(value).includes(normalizedQuery));
}

function applyTrackSearch(searchValue = '') {
  const keyword = searchValue.trim();

  tracks = keyword
    ? allTracks.filter((track) => trackMatchesSearch(track, keyword))
    : [...allTracks];
  currentTrackIndex = contextTracks().findIndex((track) => track.id === activeTrackId);
}

function updateTracksStatus(searchValue = '') {
  const stats = getLibraryStats();

  if (stats.tracks === 0) {
    statusMessage.textContent = searchValue.trim() ? '0 tracks found' : 'No tracks found';
    return;
  }

  const tracksStat = document.createElement('span');
  const albumsStat = document.createElement('span');
  const artistsStat = document.createElement('span');

  statusMessage.classList.add('library-stats');
  tracksStat.textContent = `Tracks: ${stats.tracks}`;
  albumsStat.textContent = `Albums: ${stats.albums}`;
  artistsStat.textContent = `Artists: ${stats.artists}`;
  statusMessage.replaceChildren(tracksStat, albumsStat, artistsStat);
}

function getLibraryStats() {
  const libraryTracks = Array.isArray(allTracks) ? allTracks : [];
  const albums = new Set();
  const artists = new Set();

  libraryTracks.forEach((track) => {
    albums.add(formatAlbum(track));
    artists.add(formatArtist(track));
  });

  return {
    tracks: libraryTracks.length,
    albums: albums.size,
    artists: artists.size
  };
}

function isUnknownArtistName(artistName) {
  return !artistName || artistName === 'Unknown artist';
}

function emptyArtistInfo(artistName = 'No artist selected') {
  return {
    artistName,
    bio: null,
    image: null,
    source: null,
    tags: [],
    genres: [],
    country: null,
    listeners: null,
    playcount: null,
    albumCount: null,
    trackCount: null,
    topTracks: [],
    loading: false,
    error: null,
    updatedAt: null
  };
}

function artistInitials(artistName) {
  if (isUnknownArtistName(artistName) || artistName === 'No artist selected') {
    return '—';
  }

  const words = artistName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) {
    return '—';
  }

  return words
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');
}

function cacheKeyForArtist(artistName) {
  return artistName.trim().toLowerCase();
}

function isFreshArtistInfo(info) {
  if (!info || !info.updatedAt) {
    return false;
  }

  const updatedAt = Date.parse(info.updatedAt);
  return Number.isFinite(updatedAt) && Date.now() - updatedAt < ARTIST_INFO_CACHE_TTL_MS;
}

function saveArtistInfoToCache(info) {
  if (!info || isUnknownArtistName(info.artistName)) {
    return;
  }

  artistInfoCache[cacheKeyForArtist(info.artistName)] = info;
  writeStoredObject(ARTIST_INFO_CACHE_KEY, artistInfoCache);
}

function normalizeArtistInfoPayload(payload, artistName) {
  const genres = Array.isArray(payload.genres)
    ? payload.genres
    : Array.isArray(payload.tags)
      ? payload.tags
      : [];

  return {
    artistName: payload.artist || artistName,
    bio: payload.bio || null,
    image: payload.image || null,
    source: payload.source || 'local',
    tags: genres,
    genres,
    country: payload.country || null,
    listeners: payload.listeners,
    playcount: payload.playcount,
    albumCount: Number.isInteger(payload.albumCount) ? payload.albumCount : null,
    trackCount: Number.isInteger(payload.trackCount) ? payload.trackCount : null,
    topTracks: Array.isArray(payload.topTracks) ? payload.topTracks : [],
    loading: false,
    error: null,
    updatedAt: payload.updatedAt || new Date().toISOString()
  };
}

function renderSourceBadges(info) {
  const sourceLabels = {
    local: 'Local',
    musicbrainz: 'MusicBrainz',
    lastfm: 'Last.fm'
  };
  const sources = [];

  if (info.source) {
    sources.push(sourceLabels[info.source] || info.source);
  }

  heroArtistInfoSources.replaceChildren(
    ...(sources.length > 0 ? sources : ['Local']).map((source) => {
      const badge = document.createElement('span');
      badge.className = 'artist-source-pill';
      badge.textContent = source;
      return badge;
    })
  );
}

function renderHeroArtistInfo(info) {
  const artistInfo = info || emptyArtistInfo();
  const visibleTags = artistInfo.tags && artistInfo.tags.length > 0
    ? artistInfo.tags.slice(0, 3)
    : [];

  heroArtistInfoTitle.textContent = artistInfo.artistName;
  heroArtistAvatar.textContent = artistInitials(artistInfo.artistName);
  heroArtistInfoBio.textContent = artistInfo.loading
    ? 'Loading artist info...'
    : artistInfo.bio || 'Additional artist information is unavailable.';
  heroArtistTrackCount.textContent = Number.isInteger(artistInfo.trackCount)
    ? String(artistInfo.trackCount)
    : '—';
  heroArtistAlbumCount.textContent = Number.isInteger(artistInfo.albumCount)
    ? String(artistInfo.albumCount)
    : '—';
  heroArtistListeners.textContent = artistInfo.country || '—';
  heroArtistTags.textContent = artistInfo.error
    ? artistInfo.error
    : visibleTags.length > 0
      ? visibleTags.join(' · ')
      : 'Data will be provided by MusicBrainz / Last.fm in a future phase.';
  heroArtistTopTracks.replaceChildren();

  if (artistInfo.topTracks && artistInfo.topTracks.length > 0) {
    const label = document.createElement('span');

    label.className = 'artist-top-tracks-title';
    label.textContent = 'Top Tracks';
    heroArtistTopTracks.append(label);
    artistInfo.topTracks.slice(0, 3).forEach((track) => {
      const item = document.createElement('span');

      item.className = 'artist-top-track';
      item.textContent = track.title;
      heroArtistTopTracks.append(item);
    });
  }

  renderSourceBadges(artistInfo);
}

async function loadArtistInfoForTrack(track) {
  const artistName = formatArtist(track);

  if (isUnknownArtistName(artistName)) {
    activeArtistInfoRequest = null;
    renderHeroArtistInfo(emptyArtistInfo());
    return;
  }

  const cacheKey = cacheKeyForArtist(artistName);
  const cachedInfo = artistInfoCache[cacheKey];

  if (isFreshArtistInfo(cachedInfo)) {
    renderHeroArtistInfo(cachedInfo);
    return;
  }

  activeArtistInfoRequest = artistName;
  renderHeroArtistInfo({
    ...emptyArtistInfo(artistName),
    loading: true
  });

  try {
    const response = await fetch(`/artists/${encodeURIComponent(artistName)}/info`);

    if (!response.ok) {
      throw new Error(`Failed to load artist info: ${response.status}`);
    }

    const payload = await response.json();

    if (activeArtistInfoRequest !== artistName) {
      return;
    }

    const artistInfo = normalizeArtistInfoPayload(payload, artistName);
    saveArtistInfoToCache(artistInfo);
    renderHeroArtistInfo(artistInfo);
  } catch (err) {
    if (activeArtistInfoRequest !== artistName) {
      return;
    }

    renderHeroArtistInfo({
      ...emptyArtistInfo(artistName),
      error: 'Artist info is unavailable.'
    });
  }
}

function findTrackById(trackId) {
  return allTracks.find((track) => track.id === trackId) ||
    tracks.find((track) => track.id === trackId) ||
    favoriteTracks.find((track) => track.id === trackId) ||
    recentTracks.find((track) => track.id === trackId) ||
    null;
}

function queuedTracks() {
  return queueTrackIds
    .map((trackId) => findTrackById(trackId))
    .filter(Boolean);
}

function currentPlaybackSource() {
  return queueActiveIndex >= 0 ? 'queue' : 'context';
}

function pushQueueHistory(trackId, source) {
  if (!Number.isInteger(trackId)) {
    return;
  }

  const previousEntry = queueHistory[queueHistory.length - 1];

  if (previousEntry && previousEntry.trackId === trackId && previousEntry.source === source) {
    return;
  }

  queueHistory.push({
    trackId,
    source
  });
  queueHistory = queueHistory.slice(-50);
}

function popPreviousHistoryEntry() {
  if (queueHistory.length <= 1) {
    return null;
  }

  queueHistory.pop();
  return queueHistory.pop() || null;
}

function playlistTracks(playlist) {
  const trackIds = playlistTrackIds(playlist);
  const legacyTracksById = new Map(
    (Array.isArray(playlist.tracks) ? playlist.tracks : [])
      .map((track) => [trackIdFromValue(track), track])
      .filter(([trackId, track]) => Number.isInteger(trackId) && track && typeof track === 'object')
  );

  return trackIds
    .map((trackId) => findTrackById(trackId) || legacyTracksById.get(trackId) || null)
    .map((track) => hydrateTrack(track))
    .filter(Boolean);
}

function refreshRecentlyPlayed() {
  recentTracks = recentTrackIds
    .map((trackId) => findTrackById(trackId))
    .filter(Boolean);
  renderRecentlyPlayed();
}

function contextTracks() {
  const items = playbackContext.orderedTrackIds
    .map((trackId) => findTrackById(trackId))
    .filter(Boolean);

  return items.length > 0 ? items : tracks;
}

function setPlaybackContext(contextType, contextId, orderedTracks, trackId) {
  const orderedTrackIds = orderedTracks.map((track) => track.id);
  const currentIndex = orderedTrackIds.findIndex((currentTrackId) => currentTrackId === trackId);

  playbackContext = {
    contextType,
    contextId,
    orderedTrackIds,
    currentIndex
  };
}

function updatePlaybackContextIndex(trackId) {
  const index = playbackContext.orderedTrackIds.findIndex((currentTrackId) => currentTrackId === trackId);

  playbackContext.currentIndex = index;
}

function formatDateTime(value) {
  if (!value) {
    return '—';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function recentAddedTracks() {
  return [...tracks].sort((a, b) => {
    const dateA = Date.parse(a.created_at || '');
    const dateB = Date.parse(b.created_at || '');

    if (Number.isNaN(dateA) && Number.isNaN(dateB)) {
      return b.id - a.id;
    }

    if (Number.isNaN(dateA)) {
      return 1;
    }

    if (Number.isNaN(dateB)) {
      return -1;
    }

    return dateB - dateA;
  });
}

function coverUrl(trackId) {
  return `/tracks/${trackId}/cover?v=${COVER_URL_VERSION}`;
}

async function resolveTrackCover(trackId) {
  if (coverObjectUrlCache.has(trackId)) {
    return coverObjectUrlCache.get(trackId);
  }

  const coverRequest = fetch(coverUrl(trackId), {
    cache: 'force-cache'
  })
    .then(async (response) => {
      if (!response.ok) {
        return null;
      }

      const blob = await response.blob();
      return URL.createObjectURL(blob);
    })
    .catch(() => false);

  coverObjectUrlCache.set(trackId, coverRequest);

  const objectUrl = await coverRequest;
  coverObjectUrlCache.set(trackId, objectUrl);

  return objectUrl;
}

async function setCoverImage(image, placeholder, trackId) {
  image.dataset.trackId = String(trackId);
  placeholder.hidden = false;
  image.hidden = true;
  image.removeAttribute('src');

  const resolvedCoverUrl = await resolveTrackCover(trackId);

  if (resolvedCoverUrl && image.dataset.trackId === String(trackId)) {
    image.src = resolvedCoverUrl;
  }
}

async function setActiveCoverBackground(trackId) {
  document.documentElement.style.setProperty('--active-cover-url', 'none');

  const resolvedCoverUrl = await resolveTrackCover(trackId);

  if (resolvedCoverUrl && activeTrackId === trackId) {
    document.documentElement.style.setProperty(
      '--active-cover-url',
      `url("${resolvedCoverUrl}")`
    );
  }
}

function renderCover(track, className) {
  const wrapper = document.createElement('span');
  const image = document.createElement('img');
  const placeholder = document.createElement('span');

  wrapper.className = className;
  placeholder.textContent = '♪';
  image.alt = '';
  image.hidden = true;

  image.addEventListener('load', () => {
    placeholder.hidden = true;
    image.hidden = false;
  });

  image.addEventListener('error', () => {
    image.hidden = true;
    placeholder.hidden = false;
  });

  setCoverImage(image, placeholder, track.id);
  wrapper.append(image, placeholder);

  return wrapper;
}

function updateQueueControls() {
  const queueItems = queuedTracks();
  const isQueuePlayback = queueActiveIndex >= 0;
  const hasPendingQueue = queueItems.length > 0 && !isQueuePlayback;
  const activeIndex = isQueuePlayback ? queueActiveIndex : currentTrackIndex;
  const activeLength = isQueuePlayback ? queueItems.length : contextTracks().length;

  previousButton.disabled = activeIndex <= 0;
  previousButton.disabled = previousButton.disabled && queueHistory.length <= 1;
  nextButton.disabled = hasPendingQueue ? false : activeIndex < 0 ||
    (activeLength <= 1 && repeatMode !== 'one') ||
    (!isShuffleEnabled && repeatMode === 'off' && activeIndex >= activeLength - 1);
  shuffleButton.classList.toggle('active', isShuffleEnabled);
  shuffleButton.setAttribute('aria-pressed', String(isShuffleEnabled));
  shuffleButton.setAttribute('aria-label', isShuffleEnabled ? 'Shuffle on' : 'Shuffle off');
  repeatButton.classList.toggle('active', repeatMode !== 'off');
  repeatButton.setAttribute('aria-pressed', String(repeatMode !== 'off'));
  repeatButton.setAttribute('aria-label', `Repeat ${repeatMode}`);
  repeatButton.textContent = repeatMode === 'one' ? '↺1' : '↻';
  repeatButton.title = repeatMode === 'off'
    ? 'Repeat off'
    : repeatMode === 'all'
      ? 'Repeat all'
      : 'Repeat one';
  shuffleButton.title = isShuffleEnabled ? 'Shuffle on' : 'Shuffle off';
}

function updatePlayButton() {
  const isPlaying = !audioPlayer.paused;

  playButton.textContent = isPlaying ? '❚❚' : '▶';
  playButton.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
}

function updateProgress() {
  const duration = canonicalPlayerDuration();
  const currentTime = Number.isFinite(audioPlayer.currentTime) ? audioPlayer.currentTime : 0;
  const progressMax = duration > 0 ? duration : currentTime;

  progressInput.max = String(Math.floor(progressMax));
  progressInput.value = String(Math.min(Math.floor(currentTime), Math.floor(progressMax)));
  currentTimeLabel.textContent = formatTime(currentTime);
  durationTimeLabel.textContent = formatTime(duration);
  syncTrackDurationLabels();
}

function syncActiveTrack() {
  document.querySelectorAll('.track, .queue-item, .detail-track-row').forEach((item) => {
    const trackId = Number(item.dataset.trackId);
    item.classList.toggle('active', trackId === activeTrackId);
  });
}

function loadTrackIntoPlayer(track) {
  canonicalDurationTrackId = track.id;
  canonicalDuration = 0;
  setActiveCoverBackground(track.id);
  nowTitle.textContent = track.title;
  nowArtist.textContent = formatArtist(track);
  heroTitle.textContent = track.title;
  heroMeta.textContent = `${formatArtist(track)} • ${formatAlbum(track)}`;
  setCoverImage(coverArt, coverPlaceholder, track.id);
  setCoverImage(heroCoverArt, heroCoverPlaceholder, track.id);
  loadArtistInfoForTrack(track);
  audioPlayer.src = `/stream/${track.id}`;
  updateProgress();
}

function updateTrackInMemory(updatedTrack) {
  allTracks = allTracks.map((track) => (
    track.id === updatedTrack.id ? updatedTrack : track
  ));
  tracks = tracks.map((track) => (
    track.id === updatedTrack.id ? updatedTrack : track
  ));
  favoriteTracks = favoriteTracks.map((track) => (
    track.id === updatedTrack.id ? updatedTrack : track
  ));
  recentTracks = recentTracks.map((track) => (
    track.id === updatedTrack.id ? updatedTrack : track
  ));
}

function addToQueue(track) {
  if (queueTrackIds[queueTrackIds.length - 1] === track.id) {
    statusMessage.textContent = `Already at end of queue: ${track.title}`;
    renderQueue();
    return;
  }

  queueTrackIds.push(track.id);
  saveQueue();
  renderQueue();
  statusMessage.textContent = `Added to queue: ${track.title}`;
}

function playNext(track) {
  const insertIndex = queueActiveIndex >= 0 ? queueActiveIndex + 1 : 0;
  queueTrackIds.splice(insertIndex, 0, track.id);
  saveQueue();
  renderQueue();
  statusMessage.textContent = `Will play next: ${track.title}`;
}

function removeFromQueue(index) {
  queueTrackIds.splice(index, 1);

  if (queueActiveIndex === index) {
    queueActiveIndex = -1;
  } else if (queueActiveIndex > index) {
    queueActiveIndex -= 1;
  }

  saveQueue();
  renderQueue();
  updateQueueControls();
}

function clearQueue() {
  queueTrackIds = [];
  queueActiveIndex = -1;
  saveQueue();
  renderQueue();
  updateQueueControls();
}

function createPlaylist(name) {
  const trimmedName = name.trim();

  if (!trimmedName) {
    return;
  }

  playlists.push({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: trimmedName,
    trackIds: []
  });
  savePlaylists();
  renderLibrary();
  statusMessage.textContent = `Created playlist: ${trimmedName}`;
}

function addTrackToPlaylist(track, playlistId) {
  const hydratedTrack = hydrateTrack(track);
  const targetPlaylist = playlists.find((playlist) => playlist.id === playlistId);
  const targetTrackIds = targetPlaylist ? playlistTrackIds(targetPlaylist) : [];

  if (!targetPlaylist) {
    statusMessage.textContent = 'Playlist not found';
    return;
  }

  if (targetTrackIds.includes(hydratedTrack.id)) {
    statusMessage.textContent = `Already in playlist: ${targetPlaylist.name}`;
    renderLibrary();
    return;
  }

  playlists = playlists.map((playlist) => {
    const trackIds = playlistTrackIds(playlist);

    if (playlist.id !== playlistId) {
      return playlist;
    }

    return {
      ...playlist,
      trackIds: [...trackIds, hydratedTrack.id]
    };
  });
  savePlaylists();
  renderLibrary();
  statusMessage.textContent = `Added to playlist: ${targetPlaylist.name}`;
}

function removeTrackFromPlaylist(playlistId, trackId) {
  const playlist = playlists.find((currentPlaylist) => currentPlaylist.id === playlistId);
  const track = findTrackById(trackId);

  playlists = playlists.map((playlist) => {
    const trackIds = playlistTrackIds(playlist);

    if (playlist.id !== playlistId) {
      return playlist;
    }

    return {
      ...playlist,
      trackIds: trackIds.filter((currentTrackId) => currentTrackId !== trackId)
    };
  });
  savePlaylists();
  renderLibrary();
  statusMessage.textContent = playlist && track
    ? `Removed from playlist: ${playlist.name}`
    : 'Removed from playlist';
}

async function recordTrackPlay(trackId) {
  recentTrackIds = [
    trackId,
    ...recentTrackIds.filter((currentTrackId) => currentTrackId !== trackId)
  ].slice(0, RECENT_TRACK_LIMIT);
  saveRecentlyPlayed();
  refreshRecentlyPlayed();

  try {
    await fetch(`/tracks/${trackId}/play`, {
      method: 'POST'
    });
  } catch (err) {
    recentlyStatus.textContent = recentTracks.length === 0
      ? err.message
      : `${recentTracks.length} recently played`;
  }
}

function setCurrentTrackIndex(index, options = {}) {
  currentTrackIndex = index;
  queueActiveIndex = -1;
  const contextItems = contextTracks();
  activeTrackId = contextItems[index] ? contextItems[index].id : null;
  updatePlaybackContextIndex(activeTrackId);
  if (activeTrackId && !options.skipHistory) {
    pushQueueHistory(activeTrackId, 'context');
  }
  renderQueue();
  syncActiveTrack();
  updateQueueControls();
  savePlayerState();
}

function playTrackAt(index, options = {}) {
  const contextItems = contextTracks();
  const track = contextItems[index];

  if (!track) {
    return;
  }

  setCurrentTrackIndex(index, options);
  loadTrackIntoPlayer(track);
  audioPlayer.play().catch(() => {});
  recordTrackPlay(track.id);
}

function playQueueAt(index, options = {}) {
  const trackId = queueTrackIds.splice(index, 1)[0];
  const track = findTrackById(trackId);

  if (!track) {
    saveQueue();
    return;
  }

  queueActiveIndex = -1;
  if (!options.skipHistory) {
    pushQueueHistory(track.id, 'queue');
  }
  saveQueue();
  loadTrackIntoPlayer(track);
  renderQueue();
  syncActiveTrack();
  updateQueueControls();
  savePlayerState();
  audioPlayer.play().catch(() => {});
  recordTrackPlay(track.id);
}

function playNextQueuedTrack(options = {}) {
  const nextTrackId = queueTrackIds.shift();
  const track = findTrackById(nextTrackId);

  queueActiveIndex = -1;
  saveQueue();

  if (!track) {
    playNextTrack(options);
    return;
  }

  activeTrackId = track.id;
  pushQueueHistory(track.id, 'queue');
  loadTrackIntoPlayer(track);
  renderQueue();
  syncActiveTrack();
  updateQueueControls();
  savePlayerState();
  audioPlayer.play().catch(() => {});
  recordTrackPlay(track.id);
}

function playTrackFromContext(track, contextType, contextId, orderedTracks) {
  setPlaybackContext(contextType, contextId, orderedTracks, track.id);
  playTrackAt(playbackContext.currentIndex);
}

function playTrackFromList(track) {
  const index = contextTracks().findIndex((currentTrack) => currentTrack.id === track.id);

  if (index >= 0) {
    playTrackAt(index);
    return;
  }

  activeTrackId = track.id;
  queueActiveIndex = -1;
  currentTrackIndex = -1;
  pushQueueHistory(track.id, 'context');
  loadTrackIntoPlayer(track);
  renderQueue();
  syncActiveTrack();
  updateQueueControls();
  audioPlayer.play().catch(() => {});
  recordTrackPlay(track.id);
}

function playPreviousTrack() {
  if (Number.isFinite(audioPlayer.currentTime) && audioPlayer.currentTime > 3) {
    audioPlayer.currentTime = 0;
    updateProgress();
    savePlayerState();
    return;
  }

  if (queueActiveIndex < 0 && currentTrackIndex > 0) {
    playTrackAt(currentTrackIndex - 1);
    return;
  }

  const historyEntry = popPreviousHistoryEntry();

  if (historyEntry) {
    const queueIndex = historyEntry.source === 'queue'
      ? queueTrackIds.findIndex((trackId) => trackId === historyEntry.trackId)
      : -1;
    const contextIndex = contextTracks().findIndex((track) => track.id === historyEntry.trackId);

    if (queueActiveIndex >= 0 && queueIndex >= 0) {
      playQueueAt(queueIndex);
      return;
    }

    if (contextIndex >= 0) {
      playTrackAt(contextIndex);
      return;
    }
  }

  if (queueActiveIndex > 0) {
    playQueueAt(queueActiveIndex - 1);
    return;
  }

  audioPlayer.currentTime = 0;
  updateProgress();
}

function randomNextIndex(listLength, activeIndex, trackIds = []) {
  if (listLength <= 1) {
    return activeIndex;
  }

  const recentTrackIds = new Set(queueHistory.slice(-Math.min(queueHistory.length, listLength - 1)).map((entry) => entry.trackId));
  const candidates = Array.from({ length: listLength }, (_, index) => index)
    .filter((index) => index !== activeIndex);
  const freshCandidates = candidates.filter((index) => !recentTrackIds.has(trackIds[index]));
  const usableCandidates = freshCandidates.length > 0 ? freshCandidates : candidates;

  return usableCandidates[Math.floor(Math.random() * usableCandidates.length)];
}

function nextIndexForList(listLength, activeIndex, trackIds = []) {
  if (activeIndex < 0) {
    return -1;
  }

  if (repeatMode === 'one') {
    return activeIndex;
  }

  if (isShuffleEnabled) {
    return randomNextIndex(listLength, activeIndex, trackIds);
  }

  if (activeIndex < listLength - 1) {
    return activeIndex + 1;
  }

  if (repeatMode === 'all' && listLength > 0) {
    return 0;
  }

  return -1;
}

function nextTrackIndex() {
  const contextItems = contextTracks();

  return nextIndexForList(
    contextItems.length,
    playbackContext.currentIndex,
    contextItems.map((track) => track.id)
  );
}

function playNextTrack(options = {}) {
  if (queueTrackIds.length > 0) {
    playNextQueuedTrack(options);
    return;
  }

  const nextIndex = nextTrackIndex();

  if (nextIndex >= 0) {
    playTrackAt(nextIndex);
  }
}

function toggleShuffle() {
  isShuffleEnabled = !isShuffleEnabled;
  updateQueueControls();
  renderQueue();
  savePlayerState();
}

function cycleRepeatMode() {
  if (repeatMode === 'off') {
    repeatMode = 'all';
  } else if (repeatMode === 'all') {
    repeatMode = 'one';
  } else {
    repeatMode = 'off';
  }

  updateQueueControls();
  savePlayerState();
}

function togglePlayPause() {
  if (!audioPlayer.src) {
    if (tracks.length > 0) {
      playTrackAt(0);
    }

    return;
  }

  if (audioPlayer.paused) {
    audioPlayer.play().catch(() => {});
  } else {
    audioPlayer.pause();
  }
}

function closeActionMenus() {
  document.querySelectorAll('.track-actions.open').forEach((wrapper) => {
    wrapper.classList.remove('open');
    const actionMenu = wrapper.actionMenu || document.querySelector(`.action-menu[data-action-menu-owner="${wrapper.dataset.actionMenuOwner}"]`);

    if (!actionMenu) {
      return;
    }

    actionMenu.classList.remove('open');
    actionMenu.style.top = '';
    actionMenu.style.left = '';
    actionMenu.style.maxHeight = '';

    if (actionMenu.parentElement !== wrapper) {
      wrapper.append(actionMenu);
    }
  });
}

function positionActionMenu(trigger, menu) {
  if (!trigger || !menu) {
    return;
  }

  const viewportPadding = 12;
  const triggerGap = 8;

  menu.style.maxHeight = '';
  menu.classList.add('open');

  const triggerRect = trigger.getBoundingClientRect();
  const menuWidth = menu.offsetWidth;
  const menuHeight = menu.offsetHeight;
  const spaceBelow = window.innerHeight - triggerRect.bottom - viewportPadding;
  const spaceAbove = triggerRect.top - viewportPadding;
  const opensBelow = spaceBelow >= menuHeight + triggerGap || spaceBelow >= spaceAbove;
  const availableHeight = Math.max(
    96,
    (opensBelow ? spaceBelow : spaceAbove) - triggerGap
  );
  const left = Math.min(
    Math.max(viewportPadding, triggerRect.right - menuWidth),
    window.innerWidth - menuWidth - viewportPadding
  );
  const top = opensBelow
    ? Math.min(triggerRect.bottom + triggerGap, window.innerHeight - availableHeight - viewportPadding)
    : Math.max(viewportPadding, triggerRect.top - Math.min(menuHeight, availableHeight) - triggerGap);

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.style.maxHeight = `${availableHeight}px`;
}

function setTrackRating(track, rating) {
  trackRatings.set(track.id, rating);
  renderLibrary();
}

function viewTrackAlbum(track) {
  selectedAlbumName = formatAlbum(track);
  setActiveLibraryTab('albums');
  renderAlbums();
}

function viewTrackArtist(track) {
  selectedArtistName = formatArtist(track);
  setActiveLibraryTab('artists');
  renderArtists();
}

async function copyTrackInfo(track) {
  const text = `${track.title} — ${formatArtist(track)}\n${formatAlbum(track)}`;

  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      statusMessage.textContent = `Copied: ${track.title}`;
      return;
    } catch (err) {
      // Fall back to the selection-based copy path below.
    }
  }

  const textarea = document.createElement('textarea');

  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();

  try {
    document.execCommand('copy');
    statusMessage.textContent = `Copied: ${track.title}`;
  } catch (err) {
    statusMessage.textContent = 'Copy is unavailable';
  } finally {
    textarea.remove();
  }
}

function renderRatingControl(track) {
  const wrapper = document.createElement('span');
  const currentRating = trackRatings.get(track.id) || 0;

  wrapper.className = 'rating-control';

  for (let rating = 1; rating <= 5; rating += 1) {
    const button = document.createElement('button');

    button.type = 'button';
    button.className = 'rating-star';
    button.classList.toggle('active', rating <= currentRating);
    button.textContent = rating <= currentRating ? '★' : '☆';
    button.setAttribute('aria-label', `Rate ${rating} stars`);
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      setTrackRating(track, rating);
    });

    wrapper.append(button);
  }

  return wrapper;
}

function renderActionMenu(track, options = {}) {
  const wrapper = document.createElement('span');
  const trigger = document.createElement('button');
  const menu = document.createElement('span');
  const playNowButton = document.createElement('button');
  const addToQueueButton = document.createElement('button');
  const playNextButton = document.createElement('button');
  const addToPlaylist = document.createElement('button');
  const copyInfo = document.createElement('button');
  const removeFromPlaylist = document.createElement('button');
  const favorite = document.createElement('button');
  const ratingLabel = document.createElement('span');
  const viewAlbum = document.createElement('button');
  const viewArtist = document.createElement('button');

  wrapper.className = 'track-actions';
  wrapper.dataset.actionMenuOwner = `track-${track.id}-${Math.random().toString(16).slice(2)}`;
  trigger.type = 'button';
  trigger.className = 'action-trigger';
  trigger.textContent = '⋯';
  trigger.setAttribute('aria-label', `Track actions for ${track.title}`);

  menu.className = 'action-menu';
  menu.dataset.actionMenuOwner = wrapper.dataset.actionMenuOwner;
  wrapper.actionMenu = menu;

  playNowButton.type = 'button';
  playNowButton.textContent = 'Play now';
  playNowButton.addEventListener('click', (event) => {
    event.stopPropagation();
    closeActionMenus();
    if (typeof options.onClick === 'function') {
      options.onClick();
    } else {
      playTrackFromList(track);
    }
  });

  addToQueueButton.type = 'button';
  addToQueueButton.textContent = 'Add to queue';
  addToQueueButton.addEventListener('click', (event) => {
    event.stopPropagation();
    closeActionMenus();
    addToQueue(track);
  });

  playNextButton.type = 'button';
  playNextButton.textContent = 'Play next';
  playNextButton.addEventListener('click', (event) => {
    event.stopPropagation();
    closeActionMenus();
    playNext(track);
  });

  addToPlaylist.type = 'button';
  addToPlaylist.textContent = playlists.length === 0
    ? 'Create a playlist first'
    : 'Add to playlist';
  addToPlaylist.disabled = playlists.length === 0;

  copyInfo.type = 'button';
  copyInfo.textContent = 'Copy track info';
  copyInfo.addEventListener('click', async (event) => {
    event.stopPropagation();
    closeActionMenus();
    await copyTrackInfo(track);
  });

  removeFromPlaylist.type = 'button';
  removeFromPlaylist.textContent = 'Remove from playlist';
  removeFromPlaylist.addEventListener('click', (event) => {
    event.stopPropagation();
    closeActionMenus();
    removeTrackFromPlaylist(options.playlistId, track.id);
  });

  favorite.type = 'button';
  favorite.textContent = track.is_favorite ? 'Unfavorite' : 'Favorite';
  favorite.addEventListener('click', async (event) => {
    event.stopPropagation();
    closeActionMenus();
    await toggleFavorite(track);
  });

  ratingLabel.className = 'action-label';
  ratingLabel.textContent = 'Rating';

  viewAlbum.type = 'button';
  viewAlbum.textContent = 'View album';
  viewAlbum.addEventListener('click', (event) => {
    event.stopPropagation();
    closeActionMenus();
    viewTrackAlbum(track);
  });

  viewArtist.type = 'button';
  viewArtist.textContent = 'View artist';
  viewArtist.addEventListener('click', (event) => {
    event.stopPropagation();
    closeActionMenus();
    viewTrackArtist(track);
  });

  trigger.addEventListener('click', (event) => {
    event.stopPropagation();
    const isOpen = wrapper.classList.contains('open');
    closeActionMenus();

    if (!isOpen) {
      wrapper.classList.add('open');
      document.body.append(menu);
      positionActionMenu(trigger, menu);
    }
  });

  menu.addEventListener('click', (event) => {
    event.stopPropagation();
  });

  menu.append(
    playNowButton,
    addToQueueButton,
    playNextButton,
    addToPlaylist,
    ...playlists.map((playlist) => {
      const playlistButton = document.createElement('button');

      playlistButton.type = 'button';
      playlistButton.textContent = `+ ${playlist.name}`;
      playlistButton.addEventListener('click', (event) => {
        event.stopPropagation();
        closeActionMenus();
        addTrackToPlaylist(track, playlist.id);
      });

      return playlistButton;
    }),
    ...(options.playlistId ? [removeFromPlaylist] : []),
    copyInfo,
    favorite,
    ratingLabel,
    renderRatingControl(track),
    viewAlbum,
    viewArtist
  );
  wrapper.append(trigger, menu);

  return wrapper;
}

function renderFavoriteButton(track) {
  const favoriteButton = document.createElement('button');
  const isFavorite = Boolean(track.is_favorite);

  favoriteButton.type = 'button';
  favoriteButton.className = 'favorite-button';
  favoriteButton.classList.toggle('active', isFavorite);
  favoriteButton.textContent = isFavorite ? '♥' : '♡';
  favoriteButton.setAttribute('aria-label', isFavorite ? 'Remove favorite' : 'Add favorite');
  favoriteButton.setAttribute('aria-pressed', String(isFavorite));

  favoriteButton.addEventListener('click', async (event) => {
    event.stopPropagation();
    await toggleFavorite(track);
  });

  return favoriteButton;
}

function renderTrack(track, options = {}) {
  track = hydrateTrack(track);

  const button = document.createElement('div');
  const details = document.createElement('span');
  const title = document.createElement('span');
  const artist = document.createElement('span');
  const album = document.createElement('span');
  const genre = document.createElement('span');
  const year = document.createElement('span');
  const duration = document.createElement('span');

  button.className = 'track';
  button.setAttribute('role', 'button');
  button.tabIndex = 0;
  button.dataset.trackId = String(track.id);
  button.classList.toggle('active', track.id === activeTrackId);

  details.className = 'track-info';
  title.className = 'title';
  artist.className = 'meta';
  album.className = 'meta';
  genre.className = 'meta track-genre';
  year.className = 'meta track-year';
  duration.className = 'duration';

  title.textContent = track.title;
  artist.textContent = formatArtist(track);
  album.textContent = formatAlbum(track);
  genre.textContent = formatGenre(track);
  year.textContent = formatYear(track);
  duration.dataset.durationTrackId = String(track.id);
  duration.textContent = formatTrackDuration(track);

  details.append(title, artist, album, genre, year, duration);
  button.append(
    renderCover(track, 'thumbnail'),
    details,
    renderFavoriteButton(track),
    renderActionMenu(track, options)
  );
  button.addEventListener('click', () => {
    if (options.onClick) {
      options.onClick(track);
      return;
    }

    playTrackFromList(track);
  });
  button.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (options.onClick) {
        options.onClick(track);
        return;
      }

      playTrackFromList(track);
    }
  });

  return button;
}

function renderDetailTrackRow(track, options = {}) {
  track = hydrateTrack(track);

  const row = document.createElement('div');
  const details = document.createElement('span');
  const title = document.createElement('span');
  const artist = document.createElement('span');
  const album = document.createElement('span');
  const duration = document.createElement('span');

  row.className = 'detail-track-row';
  row.setAttribute('role', 'button');
  row.tabIndex = 0;
  row.dataset.trackId = String(track.id);
  row.classList.toggle('active', track.id === activeTrackId);

  details.className = 'detail-track-info';
  title.className = 'detail-track-title';
  artist.className = 'detail-track-meta';
  album.className = 'detail-track-meta';
  duration.className = 'detail-track-duration';

  title.textContent = track.title;
  artist.textContent = formatArtist(track);
  album.textContent = formatAlbum(track);
  duration.dataset.durationTrackId = String(track.id);
  duration.textContent = formatTrackDuration(track);

  details.append(title, artist, album);
  row.append(
    renderCover(track, 'detail-cover'),
    details,
    duration,
    renderFavoriteButton(track),
    renderActionMenu(track, options)
  );
  row.addEventListener('click', () => {
    if (options.onClick) {
      options.onClick(track);
      return;
    }

    playTrackFromList(track);
  });
  row.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (options.onClick) {
        options.onClick(track);
        return;
      }

      playTrackFromList(track);
    }
  });

  return row;
}

function renderQueueItem(track, index) {
  const item = document.createElement('div');
  const title = document.createElement('span');
  const artist = document.createElement('span');
  const album = document.createElement('span');
  const duration = document.createElement('span');
  const removeButton = document.createElement('button');
  const isActive = queueActiveIndex === index && track.id === activeTrackId;

  item.className = 'queue-item';
  item.setAttribute('role', 'button');
  item.tabIndex = 0;
  item.classList.toggle('active', isActive);
  item.dataset.trackId = String(track.id);
  item.setAttribute('aria-label', `Play ${track.title}`);

  title.className = 'queue-name';
  artist.className = 'queue-artist';
  album.className = 'queue-album';
  duration.className = 'queue-duration';
  removeButton.type = 'button';
  removeButton.className = 'queue-remove-button';
  removeButton.textContent = '×';
  removeButton.setAttribute('aria-label', `Remove ${track.title} from queue`);

  title.textContent = track.title;
  artist.textContent = formatArtist(track);
  album.textContent = formatAlbum(track);
  duration.textContent = formatTrackDuration(track);

  removeButton.addEventListener('click', (event) => {
    event.stopPropagation();
    removeFromQueue(index);
  });

  item.append(renderCover(track, 'queue-cover'), title, artist, album, duration, removeButton);
  item.addEventListener('click', () => playQueueAt(index));
  item.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      playQueueAt(index);
    }
  });

  return item;
}

function renderQueueNowPlaying(track) {
  const item = document.createElement('div');
  const title = document.createElement('span');
  const artist = document.createElement('span');
  const album = document.createElement('span');
  const duration = document.createElement('span');
  const spacer = document.createElement('span');

  item.className = 'queue-item queue-now-playing active';
  title.className = 'queue-name';
  artist.className = 'queue-artist';
  album.className = 'queue-album';
  duration.className = 'queue-duration';
  spacer.className = 'queue-action-spacer';

  title.textContent = track.title;
  artist.textContent = formatArtist(track);
  album.textContent = formatAlbum(track);
  duration.textContent = formatTrackDuration(track);

  item.append(renderCover(track, 'queue-cover'), title, artist, album, duration, spacer);

  return item;
}

function renderTrackHeaderRow() {
  const header = document.createElement('div');
  const title = document.createElement('span');
  const artist = document.createElement('span');
  const album = document.createElement('span');
  const genre = document.createElement('span');
  const year = document.createElement('span');

  header.className = 'songs-header-row track-header-row';
  header.setAttribute('aria-hidden', 'true');
  title.className = 'songs-header-title';
  title.textContent = 'Song name';
  artist.textContent = 'Artist';
  album.textContent = 'Album';
  genre.textContent = 'Genre';
  year.textContent = 'Year';
  header.append(title, artist, album, genre, year);

  return header;
}

function renderDetailTrackHeaderRow() {
  const header = document.createElement('div');
  const title = document.createElement('span');
  const artist = document.createElement('span');
  const album = document.createElement('span');
  const duration = document.createElement('span');
  const actions = document.createElement('span');

  header.className = 'detail-track-header-row';
  header.setAttribute('aria-hidden', 'true');
  title.className = 'detail-track-header-title';
  duration.className = 'detail-track-header-duration';
  actions.className = 'detail-track-header-actions';
  title.textContent = 'Song name';
  artist.textContent = 'Artist';
  album.textContent = 'Album';
  duration.textContent = 'Duration';
  actions.textContent = 'Actions';
  header.append(title, artist, album, duration, actions);

  return header;
}

function renderQueueHeaderRow() {
  const header = document.createElement('div');
  const title = document.createElement('span');
  const artist = document.createElement('span');
  const album = document.createElement('span');
  const duration = document.createElement('span');
  const actions = document.createElement('span');

  header.className = 'queue-header-row';
  header.setAttribute('aria-hidden', 'true');
  title.className = 'queue-header-title';
  title.textContent = 'Song name';
  artist.textContent = 'Artist';
  album.textContent = 'Album';
  duration.textContent = 'Duration';
  actions.textContent = 'Actions';
  header.append(title, artist, album, duration, actions);

  return header;
}

function renderGroupCard(item, type) {
  const button = document.createElement('button');
  const copy = document.createElement('span');
  const title = document.createElement('span');
  const meta = document.createElement('span');
  const spacer = document.createElement('span');

  button.type = 'button';
  button.className = `group-card ${type}-card`;

  copy.className = 'group-copy';
  title.className = 'group-title';
  meta.className = 'group-meta';
  title.textContent = item.name;
  meta.textContent = `${item.count} ${item.count === 1 ? 'song' : 'songs'}`;

  copy.append(title, meta);
  button.append(renderCover(item.coverTrack, 'group-cover'), copy, spacer);

  if (type === 'album') {
    button.addEventListener('click', () => {
      selectedAlbumName = item.name;
      renderAlbums();
    });
  } else if (type === 'artist') {
    button.addEventListener('click', () => {
      selectedArtistName = item.name;
      renderArtists();
    });
  }

  return button;
}

function groupByTrackField(field, fallback) {
  const grouped = new Map();

  tracks.forEach((track) => {
    const name = track[field] || fallback;
    const current = grouped.get(name) || {
      name,
      count: 0,
      coverTrack: track
    };

    current.count += 1;
    grouped.set(name, current);
  });

  return Array.from(grouped.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function setActiveLibraryTab(tabName) {
  activeLibraryTab = tabName;

  document.querySelectorAll('[data-library-tab]').forEach((button) => {
    button.classList.toggle('active', button.dataset.libraryTab === tabName);
  });

  document.querySelectorAll('[data-library-panel]').forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.libraryPanel === tabName);
  });
  savePlayerState();
}

function renderSongs() {
  const contextType = searchInput.value.trim() ? 'search' : 'songs';
  const contextId = searchInput.value.trim() || null;
  trackList.replaceChildren(...tracks.map((track) => renderTrack(track, {
    onClick: () => playTrackFromContext(track, contextType, contextId, tracks)
  })));
}

function renderAlbums() {
  const albums = groupByTrackField('album', 'Unknown album');

  if (selectedAlbumName) {
    renderAlbumDetail(selectedAlbumName);
    return;
  }

  albumsList.className = 'group-list';
  albumsList.replaceChildren(
    ...albums.map((album) => renderGroupCard(album, 'album'))
  );
}

function renderAlbumDetail(albumName) {
  const albumTracks = tracks.filter((track) => formatAlbum(track) === albumName);
  const header = document.createElement('div');
  const backButton = document.createElement('button');
  const copy = document.createElement('div');
  const title = document.createElement('h3');
  const meta = document.createElement('p');
  const list = document.createElement('div');

  albumsList.className = 'detail-view';
  header.className = 'detail-header album-detail-header';
  backButton.type = 'button';
  backButton.className = 'detail-back-button album-back-button';
  backButton.textContent = '←';
  backButton.setAttribute('aria-label', 'Back to all albums');
  backButton.title = 'All albums';
  backButton.addEventListener('click', () => {
    selectedAlbumName = null;
    renderAlbums();
  });

  title.className = 'detail-title album-detail-title';
  title.textContent = albumName;
  meta.className = 'detail-meta album-detail-meta';
  meta.textContent = `${albumTracks.length} ${albumTracks.length === 1 ? 'song' : 'songs'}`;
  copy.append(title, meta);

  list.className = 'detail-track-grid album-detail-list';
  list.append(...albumTracks.map((track) => renderDetailTrackRow(track, {
    onClick: () => playTrackFromContext(track, 'album', albumName, albumTracks)
  })));

  header.append(backButton, copy);
  albumsList.replaceChildren(header, list);
}

function renderArtists() {
  const artists = groupByTrackField('artist', 'Unknown artist');

  if (selectedArtistName) {
    renderArtistDetail(selectedArtistName);
    return;
  }

  artistsList.className = 'group-list';
  artistsList.replaceChildren(
    ...artists.map((artist) => renderGroupCard(artist, 'artist'))
  );
}

function renderArtistDetail(artistName) {
  const artistTracks = tracks.filter((track) => formatArtist(track) === artistName);
  const cachedInfo = artistInfoCache[cacheKeyForArtist(artistName)];
  const header = document.createElement('div');
  const backButton = document.createElement('button');
  const copy = document.createElement('div');
  const title = document.createElement('h3');
  const meta = document.createElement('p');
  const list = document.createElement('div');

  artistsList.className = 'detail-view';
  header.className = 'detail-header artist-detail-header';
  backButton.type = 'button';
  backButton.className = 'detail-back-button artist-back-button';
  backButton.textContent = '←';
  backButton.setAttribute('aria-label', 'Back to all artists');
  backButton.title = 'All artists';
  backButton.addEventListener('click', () => {
    selectedArtistName = null;
    renderArtists();
  });

  title.className = 'detail-title artist-detail-title';
  title.textContent = artistName;
  meta.className = 'detail-meta artist-detail-meta';
  meta.textContent = cachedInfo && Number.isInteger(cachedInfo.albumCount)
    ? `${artistTracks.length} ${artistTracks.length === 1 ? 'song' : 'songs'} · ${cachedInfo.albumCount} ${cachedInfo.albumCount === 1 ? 'album' : 'albums'}`
    : `${artistTracks.length} ${artistTracks.length === 1 ? 'song' : 'songs'}`;
  copy.append(title, meta);

  list.className = 'detail-track-grid artist-detail-list';
  list.append(...artistTracks.map((track) => renderDetailTrackRow(track, {
    onClick: () => playTrackFromContext(track, 'artist', artistName, artistTracks)
  })));

  header.append(backButton, copy);
  artistsList.replaceChildren(header, list);
}

function renderFavorites() {
  if (favoriteTracks.length === 0) {
    const empty = document.createElement('div');

    empty.className = 'playlist-placeholder';
    empty.textContent = 'No favorite tracks yet';
    favoritesList.replaceChildren(renderTrackHeaderRow(), empty);
    return;
  }

  favoritesList.replaceChildren(
    renderTrackHeaderRow(),
    ...favoriteTracks.map((track) => renderTrack(track, {
      onClick: () => playTrackFromContext(track, 'favorites', null, favoriteTracks)
    }))
  );
}

function renderRecentlyAdded() {
  const items = recentAddedTracks();
  recentlyAddedList.replaceChildren(
    renderTrackHeaderRow(),
    ...items.map((track) => renderTrack(track, {
      onClick: () => playTrackFromContext(track, 'recentAdded', null, items)
    }))
  );
}

function renderRecentlyPlayed() {
  recentlyList.replaceChildren(
    renderTrackHeaderRow(),
    ...recentTracks.map((track) => renderTrack(track, {
      onClick: () => playTrackFromContext(track, 'recent', null, recentTracks)
    }))
  );
  recentlyStatus.textContent = recentTracks.length === 0
    ? 'No recently played tracks'
    : `${recentTracks.length} recently played`;
}

function renderPlaylists() {
  if (selectedPlaylistId) {
    renderPlaylistDetail(selectedPlaylistId);
    return;
  }

  const form = document.createElement('form');
  const input = document.createElement('input');
  const button = document.createElement('button');
  const list = document.createElement('div');

  form.className = 'playlist-toolbar';
  input.className = 'playlist-input';
  input.type = 'text';
  input.placeholder = 'Name';
  button.className = 'view-more-button playlist-create-button';
  button.type = 'submit';
  button.textContent = 'Create';
  form.append(input, button);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    createPlaylist(input.value);
    input.value = '';
  });

  list.className = 'playlist-list';

  if (playlists.length === 0) {
    const empty = document.createElement('div');
    const title = document.createElement('strong');
    const copy = document.createElement('span');

    empty.className = 'playlist-placeholder playlist-empty-state';
    title.textContent = 'No playlists yet';
    copy.textContent = 'Create your first playlist above.';
    empty.append(title, copy);
    list.append(empty);
  } else {
    list.append(...playlists.map((playlist) => renderPlaylistCard(playlist)));
  }

  playlistsList.className = 'playlist-view';
  playlistsList.replaceChildren(form, list);
}

function renderPlaylistCard(playlist) {
  const button = document.createElement('button');
  const copy = document.createElement('span');
  const title = document.createElement('span');
  const meta = document.createElement('span');
  const coverTrack = playlistTracks(playlist)[0];

  button.type = 'button';
  button.className = 'playlist-card';
  copy.className = 'playlist-card-copy';
  title.className = 'group-title';
  meta.className = 'group-meta';
  title.textContent = playlist.name;
  const trackCount = playlistTrackIds(playlist).length;
  meta.textContent = `${trackCount} ${trackCount === 1 ? 'song' : 'songs'}`;
  copy.append(title, meta);
  button.append(
    coverTrack ? renderCover(coverTrack, 'group-cover') : renderPlaylistPlaceholderCover(),
    copy
  );
  button.addEventListener('click', () => {
    selectedPlaylistId = playlist.id;
    savePlayerState();
    renderPlaylists();
  });

  return button;
}

function renderPlaylistPlaceholderCover() {
  const cover = document.createElement('span');

  cover.className = 'group-cover';
  cover.textContent = '♪';

  return cover;
}

function renderPlaylistDetail(playlistId) {
  const playlist = playlists.find((currentPlaylist) => currentPlaylist.id === playlistId);

  if (!playlist) {
    selectedPlaylistId = null;
    savePlayerState();
    renderPlaylists();
    return;
  }

  const playlistItems = playlistTracks(playlist);
  const header = document.createElement('div');
  const backButton = document.createElement('button');
  const copy = document.createElement('div');
  const title = document.createElement('h3');
  const meta = document.createElement('p');
  const list = document.createElement('div');

  playlistsList.className = 'detail-view playlist-detail-view';
  header.className = 'detail-header playlist-detail-header';
  backButton.type = 'button';
  backButton.className = 'detail-back-button';
  backButton.textContent = '←';
  backButton.setAttribute('aria-label', 'Back to all playlists');
  backButton.title = 'All playlists';
  backButton.addEventListener('click', () => {
    selectedPlaylistId = null;
    savePlayerState();
    renderPlaylists();
  });

  title.className = 'detail-title';
  title.textContent = playlist.name;
  meta.className = 'detail-meta';
  const trackCount = playlistTrackIds(playlist).length;
  meta.textContent = `${trackCount} ${trackCount === 1 ? 'song' : 'songs'}`;
  copy.append(title, meta);

  list.className = 'detail-track-grid playlist-detail-list';

  if (playlistItems.length === 0) {
    const empty = document.createElement('div');

    empty.className = 'playlist-placeholder';
    empty.textContent = 'This playlist is empty';
    list.append(renderDetailTrackHeaderRow(), empty);
  } else {
    list.append(
      renderDetailTrackHeaderRow(),
      ...playlistItems.map((track) => renderPlaylistTrackRow(track, playlist.id, playlistItems))
    );
  }

  header.append(backButton, copy);
  playlistsList.replaceChildren(header, list);
}

function renderPlaylistTrackRow(track, playlistId, playlistItems = []) {
  const row = renderDetailTrackRow(track, {
    playlistId,
    onClick: () => playTrackFromContext(track, 'playlist', playlistId, playlistItems)
  });
  const removeButton = document.createElement('button');

  removeButton.type = 'button';
  removeButton.className = 'queue-remove-button';
  removeButton.textContent = '×';
  removeButton.setAttribute('aria-label', `Remove ${track.title} from playlist`);
  removeButton.addEventListener('click', (event) => {
    event.stopPropagation();
    removeTrackFromPlaylist(playlistId, track.id);
  });
  row.append(removeButton);

  return row;
}

function renderQueue() {
  const queueItems = queuedTracks();
  const toolbar = document.createElement('div');
  const heading = document.createElement('h3');
  const clearButton = document.createElement('button');
  const queueSections = [];
  const activeTrack = findTrackById(activeTrackId);

  queueTitle.textContent = `Queue (${queueItems.length})`;
  queueTitle.hidden = true;
  toolbar.className = 'queue-toolbar';
  heading.className = 'queue-heading';
  heading.textContent = `Queue (${queueItems.length})`;
  clearButton.type = 'button';
  clearButton.className = 'view-more-button clear-queue-button';
  clearButton.textContent = 'Clear queue';
  clearButton.hidden = queueItems.length === 0;
  clearButton.addEventListener('click', clearQueue);
  toolbar.append(heading, clearButton);
  queueSections.push(toolbar);

  if (activeTrack) {
    const current = document.createElement('div');
    const label = document.createElement('span');
    const row = renderQueueNowPlaying(activeTrack);

    current.className = 'queue-section';
    label.className = 'queue-section-label';
    label.textContent = 'Now playing';
    current.append(label, row);
    queueSections.push(current);
  }

  if (queueItems.length === 0) {
    const empty = document.createElement('div');
    const title = document.createElement('strong');
    const copy = document.createElement('span');

    empty.className = 'queue-empty';
    title.textContent = 'Queue is empty';
    copy.textContent = 'Add songs with Play Next or Add to Queue.';
    empty.append(title, copy);
    queueSections.push(renderQueueHeaderRow(), empty);
  } else {
    const upNext = document.createElement('div');
    const label = document.createElement('span');
    const list = document.createElement('div');

    upNext.className = 'queue-section';
    label.className = 'queue-section-label';
    label.textContent = 'Up next';
    list.className = 'queue-items';
    list.append(renderQueueHeaderRow(), ...queueItems.map(renderQueueItem));
    upNext.append(label, list);
    queueSections.push(upNext);
  }

  queueList.replaceChildren(...queueSections);
}

function renderLibrary() {
  renderSongs();
  renderAlbums();
  renderArtists();
  renderFavorites();
  renderRecentlyAdded();
  renderRecentlyPlayed();
  renderPlaylists();
  renderQueue();
  syncActiveTrack();
}

function tracksUrl() {
  const params = new URLSearchParams({
    limit: '500'
  });

  return `/tracks?${params.toString()}`;
}

async function loadTracks(searchValue = '') {
  statusMessage.textContent = 'Loading tracks...';

  try {
    const response = await fetch(tracksUrl());

    if (!response.ok) {
      throw new Error(`Failed to load tracks: ${response.status}`);
    }

    const data = await response.json();
    allTracks = Array.isArray(data.tracks) ? data.tracks : [];
    applyTrackSearch(searchValue);
    refreshRecentlyPlayed();
    renderLibrary();
    updateQueueControls();
    updateTracksStatus(searchValue);
    restorePlayerFromState();
  } catch (err) {
    statusMessage.textContent = err.message;
  }
}

async function loadFavorites() {
  try {
    const response = await fetch('/tracks?favorite=true&limit=200');

    if (!response.ok) {
      throw new Error(`Failed to load favorites: ${response.status}`);
    }

    const data = await response.json();
    favoriteTracks = Array.isArray(data.tracks) ? data.tracks : [];
    renderFavorites();
  } catch (err) {
    statusMessage.textContent = err.message;
  }
}

function loadRecentlyPlayed() {
  refreshRecentlyPlayed();
}

function renderAutoScanStatus(status) {
  if (status && status.lastScanAt) {
    lastAutoScanAt = status.lastScanAt;
    saveAutoScanSettings();
  }
}

async function loadAutoScanStatus() {
  try {
    const response = await fetch('/library/scan/status');

    if (!response.ok) {
      throw new Error(`Failed to load scan status: ${response.status}`);
    }

    const data = await response.json();
    if (data.lastScanAt) {
      lastAutoScanAt = data.lastScanAt;
      saveAutoScanSettings();
    }
    renderAutoScanStatus(data);

    if (
      data.enabled &&
      data.lastScanAt &&
      data.lastScanAt !== lastSeenAutoScanAt
    ) {
      const shouldRefreshLibrary = lastSeenAutoScanAt !== null && data.lastResult && data.lastResult.inserted > 0;
      lastSeenAutoScanAt = data.lastScanAt;

      if (shouldRefreshLibrary) {
        await loadTracks(searchInput.value);
        await loadFavorites();
      }
    }
  } catch (err) {
    console.warn(`Failed to load auto scan status: ${err.message}`);
  }
}

function stopAutoScanTimer() {
  if (autoScanTimerId !== null) {
    clearInterval(autoScanTimerId);
    autoScanTimerId = null;
  }
}

function startAutoScanTimer() {
  stopAutoScanTimer();

  // Settings UI will be added in a later phase. For now auto scan runs in background mode.
  autoScanTimerId = setInterval(() => {
    runAutoScan('timer');
  }, DEFAULT_AUTO_SCAN_INTERVAL_MINUTES * 60 * 1000);
}

function restartAutoScanTimer() {
  stopAutoScanTimer();
  startAutoScanTimer();
}

async function runAutoScan(reason = 'manual') {
  if (isAutoScanning) {
    console.warn(`Library scan skipped: previous scan still running (${reason})`);
    return null;
  }

  isAutoScanning = true;

  try {
    const response = await fetch('/library/scan/now', {
      method: 'POST'
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Failed to scan library: ${response.status}`);
    }

    const result = await response.json();
    lastAutoScanAt = new Date().toISOString();
    saveAutoScanSettings();
    statusMessage.textContent = `Scan completed: ${result.inserted} added, ${result.skipped} skipped`;
    await loadTracks(searchInput.value);
    await loadFavorites();
    await loadRecentlyPlayed();
    return result;
  } catch (err) {
    statusMessage.textContent = err.message;
    console.warn(`Library scan failed (${reason}): ${err.message}`);
    return null;
  } finally {
    isAutoScanning = false;
    await loadAutoScanStatus();
  }
}

async function scanNow() {
  await runAutoScan('manual');
}

async function toggleFavorite(track) {
  const shouldFavorite = !track.is_favorite;
  const response = await fetch(`/tracks/${track.id}/favorite`, {
    method: shouldFavorite ? 'POST' : 'DELETE'
  });

  if (!response.ok) {
    statusMessage.textContent = `Failed to update favorite: ${response.status}`;
    return;
  }

  const data = await response.json();

  if (data.track) {
    updateTrackInMemory(data.track);
  }

  await loadTracks(searchInput.value);
  await loadFavorites();
  await loadRecentlyPlayed();
  statusMessage.textContent = shouldFavorite
    ? `Added to favorites: ${track.title}`
    : `Removed from favorites: ${track.title}`;
}

coverArt.addEventListener('load', () => {
  coverPlaceholder.hidden = true;
  coverArt.hidden = false;
});

coverArt.addEventListener('error', () => {
  coverArt.hidden = true;
  coverPlaceholder.hidden = false;
});

heroCoverArt.addEventListener('load', () => {
  heroCoverPlaceholder.hidden = true;
  heroCoverArt.hidden = false;
});

heroCoverArt.addEventListener('error', () => {
  heroCoverArt.hidden = true;
  heroCoverPlaceholder.hidden = false;
});

previousButton.addEventListener('click', playPreviousTrack);
playButton.addEventListener('click', togglePlayPause);
nextButton.addEventListener('click', playNextTrack);
shuffleButton.addEventListener('click', toggleShuffle);
repeatButton.addEventListener('click', cycleRepeatMode);

favoritesFilterButton.addEventListener('click', () => {
  setActiveLibraryTab('favorites');
});

document.querySelectorAll('[data-library-tab]').forEach((button) => {
  button.addEventListener('click', () => {
    setActiveLibraryTab(button.dataset.libraryTab);
  });
});

progressInput.addEventListener('input', () => {
  audioPlayer.currentTime = Number(progressInput.value);
  updateProgress();
  savePlayerState();
});

volumeInput.addEventListener('input', () => {
  audioPlayer.volume = Number(volumeInput.value);
  savePlayerState();
});

audioPlayer.addEventListener('loadedmetadata', () => {
  if (pendingResumeTime !== null) {
    const duration = Number.isFinite(audioPlayer.duration) ? audioPlayer.duration : pendingResumeTime;
    audioPlayer.currentTime = Math.min(pendingResumeTime, duration);
    pendingResumeTime = null;
    savePlayerState();
  }

  updateProgress();
});
audioPlayer.addEventListener('durationchange', updateProgress);
audioPlayer.addEventListener('timeupdate', () => {
  updateProgress();
  savePlayerStateThrottled();
});
audioPlayer.addEventListener('play', () => {
  updatePlayButton();
  savePlayerState();
});
audioPlayer.addEventListener('pause', () => {
  updatePlayButton();
  savePlayerState();
});
audioPlayer.addEventListener('volumechange', () => {
  volumeInput.value = String(audioPlayer.volume);
  savePlayerState();
});

audioPlayer.addEventListener('ended', () => {
  if (repeatMode === 'one') {
    audioPlayer.currentTime = 0;
    audioPlayer.play().catch(() => {});
    return;
  }

  playNextTrack({
    consumeQueue: true
  });
  updateQueueControls();
  updatePlayButton();
});

document.addEventListener('keydown', (event) => {
  if (document.activeElement === searchInput) {
    return;
  }

  if (event.key === ' ') {
    event.preventDefault();
    togglePlayPause();
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    playNextTrack();
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    playPreviousTrack();
  } else if (event.key.toLowerCase() === 's') {
    event.preventDefault();
    toggleShuffle();
  } else if (event.key.toLowerCase() === 'r') {
    event.preventDefault();
    cycleRepeatMode();
  }
});

document.addEventListener('click', closeActionMenus);
window.addEventListener('beforeunload', savePlayerState);

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);

  searchTimer = setTimeout(() => {
    applyTrackSearch(searchInput.value);
    renderLibrary();
    updateQueueControls();
    updateTracksStatus(searchInput.value);
  }, 300);
});

restoreSavedPreferences();
loadAutoScanSettings();
updatePlayButton();
updateProgress();
isRestoringPlayer = true;
setActiveLibraryTab(activeLibraryTab);
isRestoringPlayer = false;
loadTracks();
loadFavorites();
loadRecentlyPlayed();
loadAutoScanStatus();
startAutoScanTimer();
setInterval(loadAutoScanStatus, 30000);
