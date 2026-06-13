'use strict';

const QUEUE_STORAGE_KEY = 'music-server.queue.v1';
const PLAYLISTS_STORAGE_KEY = 'music-server.playlists.v1';
const PLAYLISTS_BACKUP_STORAGE_KEY = `${PLAYLISTS_STORAGE_KEY}.backup`;
const PLAYER_STATE_STORAGE_KEY = 'music-server.player-state.v1';
const RECENT_TRACKS_STORAGE_KEY = 'music-server.recent-tracks.v1';
const LEARNED_DURATIONS_STORAGE_KEY = 'music-server.learned-durations.v1';
const AUTO_SCAN_ENABLED_STORAGE_KEY = 'musicServer.autoScan.enabled';
const AUTO_SCAN_INTERVAL_STORAGE_KEY = 'musicServer.autoScan.intervalMinutes';
const AUTO_SCAN_LAST_SCAN_STORAGE_KEY = 'musicServer.autoScan.lastScanAt';
const DISCOVERY_CACHE_STORAGE_KEY = 'music-server.discovery-cache.v1';
const discoveryTracksCache = new Map();
const ARTIST_INFO_CACHE_KEY = 'music-server.artist-info-cache.v6';
const LEGACY_ARTIST_INFO_CACHE_KEY = 'music-server.artist-info-cache.v5';
const ARTIST_INFO_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const COVER_URL_VERSION = 'v2';
const RECENT_TRACK_LIMIT = 50;
const DEFAULT_AUTO_SCAN_INTERVAL_MINUTES = 30;
const AUTO_SCAN_INTERVAL_OPTIONS = [5, 10, 15, 30, 60];
const SONG_ROW_HEIGHT = 45;
const SONG_VIRTUAL_BUFFER = 10;
const SEARCH_DEBOUNCE_MS = 200;
const COLLECTION_CACHE_TTL_MS = 60 * 1000;

const trackList = document.getElementById('track-list');
const libraryContent = document.querySelector('.library-content');
const albumsList = document.getElementById('albums-list');
const artistsList = document.getElementById('artists-list');
const favoritesList = document.getElementById('favorites-list');
const collectionsList = document.getElementById('collections-list');
const recentlyAddedList = document.getElementById('recently-added-list');
const recentlyList = document.getElementById('recently-list');
const playlistsList = document.getElementById('playlists-list');
const mixesList = document.getElementById('mixes-list');
const queueList = document.getElementById('queue-list');
const statusMessage = document.getElementById('status');
const toastContainer = document.getElementById('toast-container');
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
const heroArtistPhotoBackground = document.getElementById('hero-artist-photo-background');
const settingsButton = document.getElementById('settings-button');
const settingsOverlay = document.getElementById('settings-overlay');
const settingsCloseButton = document.getElementById('settings-close-button');
const autoScanToggle = document.getElementById('auto-scan-toggle');
const autoScanIntervalSelect = document.getElementById('auto-scan-interval');
const autoScanModeLabel = document.getElementById('auto-scan-mode');
const autoScanIntervalLabel = document.getElementById('auto-scan-interval-label');
const autoScanStatusLabel = document.getElementById('auto-scan-status');
const autoScanLastLabel = document.getElementById('auto-scan-last');
const scanNowButton = document.getElementById('scan-now-button');

let searchTimer = null;
let activeTrackId = null;
let allTracks = [];
let tracks = [];
let favoriteTracks = [];
let smartCollections = [];
let selectedCollectionId = null;
let selectedCollection = null;
let collectionsCache = null;
let collectionsCacheUpdatedAt = 0;
let collectionDetailCache = new Map();
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
let autoScanEnabled = true;
let autoScanIntervalMinutes = DEFAULT_AUTO_SCAN_INTERVAL_MINUTES;
let autoScanStatus = 'Idle';
let queueSyncTimer = null;
let isQueueSyncing = false;
let hasLoadedPersistentLibraryState = false;
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
let artistInfoCache = new Map(Object.entries(readStoredObject(ARTIST_INFO_CACHE_KEY)));
localStorage.removeItem(LEGACY_ARTIST_INFO_CACHE_KEY);
let activeArtistInfoRequest = null;
let artistPhotoRequestId = 0;
let pendingResumeTime = null;
let hasRestoredPlayer = false;
let isRestoringPlayer = false;
let lastPlayerStateSaveAt = 0;
let canonicalDuration = 0;
let canonicalDurationTrackId = null;
let songsVirtualFrame = null;
let songsVirtualRange = {
  start: -1,
  end: -1,
  total: -1
};
let lastSearchInputValue = '';
let lastSearchResultIds = '';
let libraryDataVersion = 0;
const albumDetailCache = new Map();
const artistDetailViewCache = new Map();
const similarArtistsCache = new Map();
let currentArtistDetailRefs = null;
const coverObjectUrlCache = new Map();
const coverObserver = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) {
        return;
      }

      coverObserver.unobserve(entry.target);
      const image = entry.target.querySelector('img');
      const placeholder = entry.target.querySelector('[data-cover-placeholder]');
      const trackId = Number(entry.target.dataset.coverTrackId);

      if (image && placeholder && Number.isInteger(trackId)) {
        setCoverImage(image, placeholder, trackId);
      }
    });
  }, {
    root: null,
    rootMargin: '360px 0px',
    threshold: 0.01
  })
  : null;
const trackDurationCache = new Map(
  Object.entries(readStoredObject(LEARNED_DURATIONS_STORAGE_KEY))
    .map(([trackId, duration]) => [Number(trackId), positiveFiniteNumber(Number(duration))])
    .filter(([trackId, duration]) => Number.isInteger(trackId) && duration)
);
const trackRatings = new Map();

function showToast(message) {
  if (!toastContainer || !message) {
    return;
  }

  const toast = document.createElement('div');

  toast.className = 'toast';
  toast.textContent = message;
  toastContainer.append(toast);

  setTimeout(() => {
    toast.remove();
  }, 3200);
}

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
  const enabledValue = localStorage.getItem(AUTO_SCAN_ENABLED_STORAGE_KEY);
  const intervalValue = Number(localStorage.getItem(AUTO_SCAN_INTERVAL_STORAGE_KEY));

  localStorage.removeItem('musicServer.library.path');
  localStorage.removeItem('musicServer.autoScan.libraryPath');

  if (enabledValue === null) {
    autoScanEnabled = true;
  } else if (enabledValue === 'true') {
    autoScanEnabled = true;
  } else if (enabledValue === 'false') {
    autoScanEnabled = false;
  } else {
    autoScanEnabled = true;
  }

  autoScanIntervalMinutes = AUTO_SCAN_INTERVAL_OPTIONS.includes(intervalValue)
    ? intervalValue
    : DEFAULT_AUTO_SCAN_INTERVAL_MINUTES;
  lastAutoScanAt = localStorage.getItem(AUTO_SCAN_LAST_SCAN_STORAGE_KEY);
}

function saveAutoScanSettings() {
  localStorage.setItem(AUTO_SCAN_ENABLED_STORAGE_KEY, String(autoScanEnabled));
  localStorage.setItem(AUTO_SCAN_INTERVAL_STORAGE_KEY, String(autoScanIntervalMinutes));

  if (lastAutoScanAt) {
    localStorage.setItem(AUTO_SCAN_LAST_SCAN_STORAGE_KEY, lastAutoScanAt);
  }
}

function formatAutoScanTime(value) {
  if (!value) {
    return '—';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function updateAutoScanStatus(status) {
  autoScanStatus = status;
  renderSettingsPanel();
}

function renderSettingsPanel() {
  if (!autoScanToggle || !autoScanIntervalSelect) {
    return;
  }

  autoScanToggle.checked = autoScanEnabled;
  autoScanIntervalSelect.value = String(autoScanIntervalMinutes);
  autoScanIntervalSelect.disabled = !autoScanEnabled;

  if (autoScanModeLabel) {
    autoScanModeLabel.textContent = autoScanEnabled ? 'On' : 'Off';
  }

  if (autoScanIntervalLabel) {
    autoScanIntervalLabel.textContent = `${autoScanIntervalMinutes} min`;
  }

  if (autoScanStatusLabel) {
    autoScanStatusLabel.textContent = autoScanStatus;
  }

  if (autoScanLastLabel) {
    autoScanLastLabel.textContent = formatAutoScanTime(lastAutoScanAt);
  }

  if (scanNowButton) {
    scanNowButton.disabled = isAutoScanning;
    scanNowButton.textContent = isAutoScanning ? 'Scanning...' : 'Run scan now';
  }
}

function openSettings() {
  if (!settingsOverlay) {
    return;
  }

  renderSettingsPanel();
  settingsOverlay.hidden = false;
  settingsCloseButton?.focus();
}

function closeSettings() {
  if (!settingsOverlay) {
    return;
  }

  settingsOverlay.hidden = true;
  settingsButton?.focus();
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
    id: playlist.id !== undefined && playlist.id !== null
      ? String(playlist.id)
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: typeof playlist.name === 'string' && playlist.name.trim()
      ? playlist.name.trim()
      : 'Untitled playlist',
    trackIds: normalizeTrackIds([...storedTrackIds, ...storedTracks]),
    trackCount: Number.isInteger(playlist.trackCount) ? playlist.trackCount : undefined,
    cover_track_id: Number.isInteger(playlist.cover_track_id) ? playlist.cover_track_id : null,
    cover: typeof playlist.cover === 'string' ? playlist.cover : null,
    created_at: playlist.created_at || null,
    updated_at: playlist.updated_at || null
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
    'collections',
    'recentAdded',
    'recent',
    'playlists',
    'mixes',
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
    selectedPlaylistId: value.selectedPlaylistId !== undefined && value.selectedPlaylistId !== null
      ? String(value.selectedPlaylistId)
      : null,
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
  invalidateCollectionCache();
  scheduleQueueSync();
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
  invalidateCollectionCache();
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const data = response.status === 204 ? null : await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data && data.error ? data.error : `Request failed: ${response.status}`;
    const err = new Error(message);
    err.status = response.status;
    err.data = data;
    throw err;
  }

  return data;
}

function normalizeApiPlaylist(playlist) {
  const trackIds = Array.isArray(playlist.tracks)
    ? playlist.tracks.map((track) => trackIdFromValue(track))
    : playlist.trackIds || [];

  return normalizePlaylist({
    ...playlist,
    id: playlist.id,
    trackIds,
    tracks: Array.isArray(playlist.tracks) ? playlist.tracks : undefined,
    trackCount: Number.isInteger(playlist.trackCount) ? playlist.trackCount : trackIds.length
  }, {
    preserveLegacyTracks: true
  });
}

function queueSyncPayload() {
  return {
    trackIds: queueTrackIds,
    currentTrackId: activeTrackId,
    repeatMode,
    shuffleEnabled: isShuffleEnabled
  };
}

async function persistQueueToApi() {
  if (isQueueSyncing) {
    return;
  }

  isQueueSyncing = true;

  try {
    await requestJson('/queue', {
      method: 'PUT',
      body: JSON.stringify(queueSyncPayload())
    });
  } catch (err) {
    showToast(`Queue sync failed: ${err.message}`);
  } finally {
    isQueueSyncing = false;
  }
}

function scheduleQueueSync() {
  if (!hasLoadedPersistentLibraryState) {
    return;
  }

  clearTimeout(queueSyncTimer);
  queueSyncTimer = setTimeout(() => {
    persistQueueToApi();
  }, 250);
}

async function loadQueueFromApi() {
  try {
    const data = await requestJson('/queue');
    const queue = data.queue || {};
    const items = Array.isArray(queue.items) ? queue.items : [];

    queueTrackIds = normalizeTrackIds(items.map((item) => item.track));
    if (['off', 'all', 'one'].includes(queue.repeatMode)) {
      repeatMode = queue.repeatMode;
    }
    if (typeof queue.shuffleEnabled === 'boolean') {
      isShuffleEnabled = queue.shuffleEnabled;
    }
    writeStoredArray(QUEUE_STORAGE_KEY, queueTrackIds);
  } catch (err) {
    showToast(`Queue restore failed: ${err.message}`);
  }
}

async function migrateLocalPlaylistsToApi(localPlaylists) {
  for (const localPlaylist of localPlaylists) {
    const trackIds = playlistTrackIds(localPlaylist);
    const created = await requestJson('/playlists', {
      method: 'POST',
      body: JSON.stringify({ name: localPlaylist.name })
    });
    const playlistId = created.playlist && created.playlist.id;

    if (!playlistId) {
      continue;
    }

    for (const trackId of trackIds) {
      await requestJson(`/playlists/${playlistId}/tracks`, {
        method: 'POST',
        body: JSON.stringify({ trackId })
      }).catch(() => {});
    }
  }
}

async function loadPlaylistsFromApi() {
  const localPlaylists = normalizePlaylists(readStoredArray(PLAYLISTS_STORAGE_KEY));

  try {
    let data = await requestJson('/playlists');
    let apiPlaylists = Array.isArray(data.playlists) ? data.playlists.map(normalizeApiPlaylist) : [];

    if (apiPlaylists.length === 0 && localPlaylists.length > 0) {
      await migrateLocalPlaylistsToApi(localPlaylists);
      data = await requestJson('/playlists');
      apiPlaylists = Array.isArray(data.playlists) ? data.playlists.map(normalizeApiPlaylist) : [];
    }

    playlists = apiPlaylists;
    writeStoredArray(PLAYLISTS_STORAGE_KEY, playlists);

    if (selectedPlaylistId && !playlists.some((playlist) => playlist.id === selectedPlaylistId)) {
      selectedPlaylistId = null;
    }
  } catch (err) {
    showToast(`Playlist restore failed: ${err.message}`);
    playlists = localPlaylists;
  }
}

async function loadPlaylistDetailFromApi(playlistId) {
  const data = await requestJson(`/playlists/${encodeURIComponent(playlistId)}`);
  const playlist = normalizeApiPlaylist(data.playlist || {});

  playlists = [
    playlist,
    ...playlists.filter((currentPlaylist) => currentPlaylist.id !== playlist.id)
  ];
  writeStoredArray(PLAYLISTS_STORAGE_KEY, playlists);

  return playlist;
}

async function loadPersistentLibraryState() {
  await loadPlaylistsFromApi();
  await loadQueueFromApi();
  hasLoadedPersistentLibraryState = true;
}

function saveRecentlyPlayed() {
  recentTrackIds = normalizeTrackIds(recentTrackIds, RECENT_TRACK_LIMIT);
  writeStoredArray(RECENT_TRACKS_STORAGE_KEY, recentTrackIds);
}

function pruneMissingTrackReferences() {
  const validTrackIds = new Set(allTracks.map((track) => track.id));
  const keepValidTrackIds = (trackIds) => normalizeTrackIds(trackIds).filter((trackId) => validTrackIds.has(trackId));

  queueTrackIds = keepValidTrackIds(queueTrackIds);
  queueHistory = queueHistory.filter((entry) => validTrackIds.has(entry.trackId));
  recentTrackIds = keepValidTrackIds(recentTrackIds).slice(0, RECENT_TRACK_LIMIT);
  playbackContext = {
    ...playbackContext,
    orderedTrackIds: keepValidTrackIds(playbackContext.orderedTrackIds)
  };
  playlists = playlists.map((playlist) => ({
    ...playlist,
    trackIds: keepValidTrackIds(playlistTrackIds(playlist)),
    tracks: Array.isArray(playlist.tracks)
      ? playlist.tracks.filter((track) => validTrackIds.has(trackIdFromValue(track)))
      : undefined
  }));

  if (queueActiveIndex >= queueTrackIds.length) {
    queueActiveIndex = -1;
  }

  writeStoredArray(QUEUE_STORAGE_KEY, queueTrackIds);
  writeStoredArray(RECENT_TRACKS_STORAGE_KEY, recentTrackIds);
  writeStoredArray(PLAYLISTS_STORAGE_KEY, playlists);

  const storedPlayerState = readStoredObject(PLAYER_STATE_STORAGE_KEY);
  writeStoredObject(PLAYER_STATE_STORAGE_KEY, {
    ...storedPlayerState,
    queueTrackIds,
    queueHistory,
    playbackContext
  });
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

function formatTrackCount(count) {
  return `${count} ${count === 1 ? 'song' : 'songs'}`;
}

function formatPlaylistTotalDuration(playlistItems) {
  const totalSeconds = playlistItems.reduce((total, track) => {
    const duration = getTrackDisplayDuration(track);

    return duration ? total + duration : total;
  }, 0);

  if (totalSeconds <= 0) {
    return null;
  }

  if (totalSeconds < 3600) {
    const minutes = Math.max(1, Math.round(totalSeconds / 60));
    return `${minutes} min`;
  }

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.round((totalSeconds % 3600) / 60);

  return minutes > 0 ? `${hours} hr ${minutes} min` : `${hours} hr`;
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

function trackIdSignature(trackItems) {
  return trackItems.map((track) => track.id).join(',');
}

function invalidateLibraryViewCaches() {
  libraryDataVersion += 1;
  albumDetailCache.clear();
  artistDetailViewCache.clear();
  similarArtistsCache.clear();
  currentArtistDetailRefs = null;
  songsVirtualRange = {
    start: -1,
    end: -1,
    total: -1
  };
}

function invalidateCollectionCache() {
  collectionsCache = null;
  collectionsCacheUpdatedAt = 0;
  collectionDetailCache = new Map();
  selectedCollection = null;
}

function applyTrackSearch(searchValue = '', options = {}) {
  const keyword = searchValue.trim();
  const normalizedKeyword = normalizeSearchText(keyword);
  const nextTracks = keyword
    ? allTracks.filter((track) => trackMatchesSearch(track, keyword))
    : [...allTracks];
  const nextSignature = trackIdSignature(nextTracks);

  if (
    !options.force &&
    normalizedKeyword === lastSearchInputValue &&
    nextSignature === lastSearchResultIds
  ) {
    return false;
  }

  tracks = nextTracks;
  lastSearchInputValue = normalizedKeyword;
  lastSearchResultIds = nextSignature;
  currentTrackIndex = contextTracks().findIndex((track) => track.id === activeTrackId);
  songsVirtualRange = {
    start: -1,
    end: -1,
    total: -1
  };
  return true;
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

function libraryHealthCollection() {
  const stats = getLibraryStats();

  return {
    id: 'library-health-local',
    title: 'Library Health',
    description: [
      `Tracks ${stats.tracks}`,
      `Albums ${stats.albums}`,
      `Artists ${stats.artists}`,
      `Favorites ${favoriteTracks.length}`,
      `Playlists ${playlists.length}`,
      `Queue ${queueTrackIds.length}`
    ].join(' · '),
    count: stats.tracks
  };
}

function isUnknownArtistName(artistName) {
  return !artistName;
}

function emptyArtistInfo(artistName = 'No artist selected') {
  return {
    artistName,
    bio: null,
    image: null,
    imageSource: null,
    source: null,
    tags: [],
    genres: [],
    country: null,
    area: null,
    disambiguation: null,
    artistType: null,
    listeners: null,
    playcount: null,
    albumCount: null,
    trackCount: null,
    albums: [],
    topTracks: [],
    popularTracks: [],
    popularTracksSource: 'local',
    externalIds: {},
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
  return artistName.normalize('NFC').trim().toLocaleLowerCase('vi');
}

function accentInsensitiveArtistKey(artistName) {
  return cacheKeyForArtist(artistName)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function isFreshArtistInfo(info) {
  if (
    !info ||
    typeof info.source !== 'string' ||
    !info.source.split('+').includes('local') ||
    !Number.isInteger(info.trackCount) ||
    !Number.isInteger(info.albumCount) ||
    !info.updatedAt
  ) {
    return false;
  }

  const updatedAt = Date.parse(info.updatedAt);
  return Number.isFinite(updatedAt) && Date.now() - updatedAt < ARTIST_INFO_CACHE_TTL_MS;
}

function saveArtistInfoToCache(info) {
  if (!info || isUnknownArtistName(info.artistName)) {
    return;
  }

  artistInfoCache.set(cacheKeyForArtist(info.artistName), info);
  writeStoredObject(ARTIST_INFO_CACHE_KEY, Object.fromEntries(artistInfoCache));
}

function clearArtistInfoCache() {
  artistInfoCache = new Map();
  localStorage.removeItem(ARTIST_INFO_CACHE_KEY);
}

function refreshActiveArtistInfo() {
  const activeTrack = findTrackById(activeTrackId);

  if (activeTrack) {
    loadArtistInfoForTrack(activeTrack);
  }
}

function localArtistInfoFallback(artistName) {
  const exactKey = cacheKeyForArtist(artistName);
  let artistTracks = allTracks.filter((track) => cacheKeyForArtist(formatArtist(track)) === exactKey);

  if (artistTracks.length === 0) {
    const fallbackKey = accentInsensitiveArtistKey(artistName);
    artistTracks = allTracks.filter(
      (track) => accentInsensitiveArtistKey(formatArtist(track)) === fallbackKey
    );
  }
  const albumCounts = new Map();
  const genres = new Set();

  artistTracks.forEach((track) => {
    const albumName = formatAlbum(track);

    albumCounts.set(albumName, (albumCounts.get(albumName) || 0) + 1);
    if (track.genre) {
      genres.add(track.genre);
    }
    if (Array.isArray(track.genres)) {
      track.genres.filter(Boolean).forEach((genre) => genres.add(genre));
    }
  });

  return {
    ...emptyArtistInfo(artistName),
    source: 'local',
    genres: [...genres].slice(0, 3),
    tags: [...genres].slice(0, 3),
    albumCount: albumCounts.size,
    trackCount: artistTracks.length,
    albums: [...albumCounts].map(([title, trackCount]) => ({
      title,
      trackCount
    })),
    topTracks: artistTracks.slice(0, 5).map((track) => ({
      id: track.id,
      title: track.title,
      album: formatAlbum(track),
      duration: track.duration
    })),
    externalIds: {},
    updatedAt: new Date().toISOString()
  };
}

function normalizeArtistInfoPayload(payload, artistName) {
  const genres = [...new Set([
    ...(Array.isArray(payload.genres) ? payload.genres : []),
    ...(Array.isArray(payload.tags) ? payload.tags : [])
  ].filter(Boolean))];

  return {
    artistName: payload.name || payload.artist || artistName,
    bio: payload.bio || payload.description || payload.summary || null,
    image: payload.image || null,
    imageSource: payload.imageSource || null,
    source: payload.source || 'local',
    tags: genres,
    genres,
    country: payload.country || null,
    area: payload.area || payload.originArea || null,
    disambiguation: payload.disambiguation || null,
    artistType: payload.artistType || payload.type || null,
    listeners: payload.listeners,
    playcount: payload.playcount,
    albumCount: Number.isInteger(payload.albumCount) ? payload.albumCount : null,
    trackCount: Number.isInteger(payload.trackCount) ? payload.trackCount : null,
    albums: Array.isArray(payload.albums) ? payload.albums : [],
    topTracks: Array.isArray(payload.topTracks) ? payload.topTracks : [],
    popularTracks: Array.isArray(payload.popularTracks) ? payload.popularTracks : [],
    popularTracksSource: payload.popularTracksSource || 'local',
    externalIds: payload.externalIds && typeof payload.externalIds === 'object'
      ? payload.externalIds
      : {},
    loading: false,
    error: null,
    updatedAt: payload.updatedAt || new Date().toISOString()
  };
}

function renderSourceBadges(info) {
  const sourceLabels = {
    local: 'Local',
    musicbrainz: 'MusicBrainz',
    lastfm: 'Last.fm',
    wikidata: 'Wikidata'
  };
  const sources = [];

  if (info.source) {
    info.source.split('+').forEach((source) => {
      const label = sourceLabels[source] || source;

      if (!sources.includes(label)) {
        sources.push(label);
      }
    });
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

function sourceBadgeElements(info) {
  const sourceLabels = {
    local: 'Local',
    musicbrainz: 'MusicBrainz',
    lastfm: 'Last.fm',
    wikidata: 'Wikidata'
  };
  const sources = [];

  if (info && info.source) {
    info.source.split('+').forEach((source) => {
      const label = sourceLabels[source] || source;

      if (!sources.includes(label)) {
        sources.push(label);
      }
    });
  }

  return (sources.length > 0 ? sources : ['Local']).map((source) => {
    const badge = document.createElement('span');
    badge.className = 'artist-source-pill';
    badge.textContent = source;
    return badge;
  });
}

function normalizeArtistDescription(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const description = value
    .replace(/\band works at\b/gi, ' • ')
    .replace(/\bVietnamidol\b/gi, 'Vietnam Idol')
    .replace(/\s*•\s*/g, ' • ')
    .replace(/\s+/g, ' ')
    .trim();

  return description || null;
}

function formatCompactNumber(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value))
    ? Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
    : null;
}

function formatCountryName(country) {
  const countryNames = {
    AU: 'Australia',
    CA: 'Canada',
    CL: 'Chile',
    CN: 'China',
    DE: 'Germany',
    FR: 'France',
    GB: 'United Kingdom',
    JP: 'Japan',
    KR: 'South Korea',
    UK: 'United Kingdom',
    US: 'United States',
    VN: 'Vietnam'
  };

  if (!country) {
    return 'N/A';
  }

  return countryNames[String(country).toUpperCase()] || country;
}

function renderHeroArtistInfo(info) {
  const artistInfo = info || emptyArtistInfo();
  const visibleTags = artistInfo.tags && artistInfo.tags.length > 0
    ? artistInfo.tags.slice(0, 3)
    : [];
  const metadataItems = [];
  const hasMusicBrainzSource = typeof artistInfo.source === 'string'
    && artistInfo.source.split('+').includes('musicbrainz');
  const metadataDescription = normalizeArtistDescription(artistInfo.bio)
    || normalizeArtistDescription(artistInfo.disambiguation)
    || (artistInfo.area ? `Area: ${artistInfo.area}` : null)
    || (hasMusicBrainzSource && artistInfo.artistType ? artistInfo.artistType : null);
  const listenerCount = formatCompactNumber(artistInfo.listeners);
  const playCount = formatCompactNumber(artistInfo.playcount);
  const popularTracks = artistInfo.popularTracks?.length > 0
    ? artistInfo.popularTracks
    : artistInfo.topTracks;

  if (artistInfo.area) {
    metadataItems.push(`Area · ${artistInfo.area}`);
  }

  metadataItems.push(...visibleTags);
  if (listenerCount) {
    metadataItems.push(`Listeners · ${listenerCount}`);
  }
  if (playCount) {
    metadataItems.push(`Playcount · ${playCount}`);
  }

  heroArtistInfoTitle.textContent = artistInfo.artistName;
  const photoRequestId = ++artistPhotoRequestId;

  heroArtistAvatar.hidden = false;
  heroArtistAvatar.textContent = artistInitials(artistInfo.artistName);
  heroArtistPhotoBackground.hidden = true;
  heroArtistPhotoBackground.removeAttribute('src');

  if (artistInfo.image) {
    heroArtistPhotoBackground.onload = () => {
      if (photoRequestId !== artistPhotoRequestId) {
        return;
      }

      heroArtistPhotoBackground.hidden = false;
      heroArtistAvatar.hidden = true;
    };
    heroArtistPhotoBackground.onerror = () => {
      if (photoRequestId !== artistPhotoRequestId) {
        return;
      }

      heroArtistPhotoBackground.hidden = true;
      heroArtistAvatar.hidden = false;
    };
    heroArtistPhotoBackground.src = artistInfo.image;
  }
  heroArtistInfoBio.textContent = artistInfo.loading
    ? 'Loading artist info...'
    : metadataDescription || 'Additional artist information is unavailable.';
  heroArtistTrackCount.textContent = Number.isInteger(artistInfo.trackCount)
    ? String(artistInfo.trackCount)
    : '—';
  heroArtistAlbumCount.textContent = Number.isInteger(artistInfo.albumCount)
    ? String(artistInfo.albumCount)
    : '—';
  heroArtistListeners.textContent = formatCountryName(artistInfo.country);
  heroArtistTags.textContent = artistInfo.error
    ? artistInfo.error
    : metadataItems.length > 0
      ? metadataItems.join(' · ')
      : '—';
  heroArtistTopTracks.replaceChildren();

  if (popularTracks && popularTracks.length > 0) {
    const label = document.createElement('span');

    label.className = 'artist-top-tracks-title';
    label.textContent = artistInfo.popularTracksSource === 'lastfm'
      ? 'Popular Tracks'
      : 'Top Tracks';
    heroArtistTopTracks.append(label);
    popularTracks.slice(0, 3).forEach((track) => {
      const item = document.createElement('span');

      item.className = 'artist-top-track';
      item.textContent = track.title;
      heroArtistTopTracks.append(item);
    });
  }

  renderSourceBadges(artistInfo);
}

async function getArtistInfo(artistName) {
  if (!artistName || isUnknownArtistName(artistName)) {
    return emptyArtistInfo();
  }

  const cacheKey = cacheKeyForArtist(artistName);
  const cachedInfo = artistInfoCache.get(cacheKey);

  if (isFreshArtistInfo(cachedInfo)) {
    return cachedInfo;
  }

  const response = await fetch(`/artists/${encodeURIComponent(artistName)}/info`);

  if (!response.ok) {
    throw new Error(`Failed to load artist info: ${response.status}`);
  }

  const payload = await response.json();
  const artistInfo = normalizeArtistInfoPayload(payload, artistName);

  saveArtistInfoToCache(artistInfo);
  return artistInfo;
}

async function loadArtistInfoForTrack(track) {
  if (!track) {
    activeArtistInfoRequest = null;
    renderHeroArtistInfo(emptyArtistInfo());
    return;
  }

  const artistName = formatArtist(track);

  if (isUnknownArtistName(artistName)) {
    activeArtistInfoRequest = null;
    renderHeroArtistInfo(emptyArtistInfo());
    return;
  }

  const cacheKey = cacheKeyForArtist(artistName);
  const cachedInfo = artistInfoCache.get(cacheKey);

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
    const artistInfo = await getArtistInfo(artistName);

    if (activeArtistInfoRequest !== artistName) {
      return;
    }

    renderHeroArtistInfo(artistInfo);
  } catch (err) {
    if (activeArtistInfoRequest !== artistName) {
      return;
    }

    renderHeroArtistInfo(localArtistInfoFallback(artistName));
  }
}

function findTrackById(trackId) {
  return allTracks.find((track) => track.id === trackId) ||
    tracks.find((track) => track.id === trackId) ||
    favoriteTracks.find((track) => track.id === trackId) ||
    recentTracks.find((track) => track.id === trackId) ||
    discoveryTracksCache.get(trackId) ||
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
  wrapper.dataset.coverTrackId = String(track.id);
  placeholder.textContent = '♪';
  placeholder.dataset.coverPlaceholder = 'true';
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

  wrapper.append(image, placeholder);
  if (coverObserver) {
    coverObserver.observe(wrapper);
  } else {
    setCoverImage(image, placeholder, track.id);
  }

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

async function addToQueue(track) {
  if (queueTrackIds[queueTrackIds.length - 1] === track.id) {
    showToast(`Already at end of queue: ${track.title}`);
    renderQueue();
    return;
  }

  queueTrackIds.push(track.id);
  saveQueue();
  renderQueue();
  showToast(`Added to queue: ${track.title}`);
}

async function playNext(track) {
  const insertIndex = queueActiveIndex >= 0 ? queueActiveIndex + 1 : 0;
  queueTrackIds.splice(insertIndex, 0, track.id);
  saveQueue();
  renderQueue();
  showToast(`Will play next: ${track.title}`);
}

function addTracksToQueue(trackItems, message = 'Added to queue') {
  const trackIds = normalizeTrackIds(trackItems);

  if (trackIds.length === 0) {
    return;
  }

  queueTrackIds.push(...trackIds);
  saveQueue();
  renderQueue();
  showToast(`${message}: ${trackIds.length} ${trackIds.length === 1 ? 'song' : 'songs'}`);
}

async function removeFromQueue(index) {
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

function moveQueueItem(index, direction) {
  const nextIndex = index + direction;

  if (nextIndex < 0 || nextIndex >= queueTrackIds.length) {
    return;
  }

  [queueTrackIds[index], queueTrackIds[nextIndex]] = [queueTrackIds[nextIndex], queueTrackIds[index]];
  saveQueue();
  renderQueue();
  updateQueueControls();
}

async function clearQueue() {
  queueTrackIds = [];
  queueActiveIndex = -1;
  writeStoredArray(QUEUE_STORAGE_KEY, queueTrackIds);
  savePlayerState();
  renderQueue();
  updateQueueControls();

  try {
    await requestJson('/queue', { method: 'DELETE' });
  } catch (err) {
    showToast(`Clear queue sync failed: ${err.message}`);
  }
}

async function createPlaylist(name) {
  const trimmedName = name.trim();

  if (!trimmedName) {
    return;
  }

  try {
    const data = await requestJson('/playlists', {
      method: 'POST',
      body: JSON.stringify({ name: trimmedName })
    });
    playlists = [normalizeApiPlaylist(data.playlist), ...playlists];
    savePlaylists();
    renderLibrary();
    showToast(`Created playlist: ${trimmedName}`);
  } catch (err) {
    showToast(`Create playlist failed: ${err.message}`);
  }
}

async function addTrackToPlaylist(track, playlistId) {
  const hydratedTrack = hydrateTrack(track);
  const targetPlaylist = playlists.find((playlist) => playlist.id === playlistId);
  const targetTrackIds = targetPlaylist ? playlistTrackIds(targetPlaylist) : [];

  if (!targetPlaylist) {
    showToast('Playlist not found');
    return;
  }

  if (targetTrackIds.includes(hydratedTrack.id)) {
    showToast(`Already in playlist: ${targetPlaylist.name}`);
    renderLibrary();
    return;
  }

  try {
    const data = await requestJson(`/playlists/${encodeURIComponent(playlistId)}/tracks`, {
      method: 'POST',
      body: JSON.stringify({ trackId: hydratedTrack.id })
    });
    const updatedPlaylist = normalizeApiPlaylist(data.playlist);

    playlists = playlists.map((playlist) => (
      playlist.id === playlistId ? updatedPlaylist : playlist
    ));
    savePlaylists();
    renderLibrary();
    showToast(`Added to playlist: ${targetPlaylist.name}`);
  } catch (err) {
    showToast(`Add to playlist failed: ${err.message}`);
  }
}

async function removeTrackFromPlaylist(playlistId, trackId) {
  const playlist = playlists.find((currentPlaylist) => currentPlaylist.id === playlistId);
  const track = findTrackById(trackId);

  try {
    const data = await requestJson(`/playlists/${encodeURIComponent(playlistId)}/tracks/${trackId}`, {
      method: 'DELETE'
    });
    const updatedPlaylist = normalizeApiPlaylist(data.playlist);

    playlists = playlists.map((playlist) => (
      playlist.id === playlistId ? updatedPlaylist : playlist
    ));
    savePlaylists();
    renderLibrary();
    showToast(playlist && track
      ? `Removed from playlist: ${playlist.name}`
      : 'Removed from playlist');
  } catch (err) {
    showToast(`Remove from playlist failed: ${err.message}`);
  }
}

async function renamePlaylist(playlistId) {
  const playlist = playlists.find((currentPlaylist) => currentPlaylist.id === playlistId);

  if (!playlist) {
    showToast('Playlist not found');
    return;
  }

  const nextName = window.prompt('Rename playlist', playlist.name);

  if (nextName === null) {
    return;
  }

  const trimmedName = nextName.trim();

  if (!trimmedName) {
    showToast('Playlist name cannot be empty');
    return;
  }

  try {
    const data = await requestJson(`/playlists/${encodeURIComponent(playlistId)}`, {
      method: 'PUT',
      body: JSON.stringify({ name: trimmedName })
    });
    const updatedPlaylist = normalizeApiPlaylist(data.playlist);

    playlists = playlists.map((currentPlaylist) => (
      currentPlaylist.id === playlistId ? updatedPlaylist : currentPlaylist
    ));
    savePlaylists();
    renderLibrary();
    showToast(`Renamed playlist: ${trimmedName}`);
  } catch (err) {
    showToast(`Rename playlist failed: ${err.message}`);
  }
}

async function deletePlaylist(playlistId) {
  const playlist = playlists.find((currentPlaylist) => currentPlaylist.id === playlistId);

  if (!playlist) {
    showToast('Playlist not found');
    return;
  }

  if (!window.confirm(`Delete playlist "${playlist.name}"?`)) {
    return;
  }

  try {
    await requestJson(`/playlists/${encodeURIComponent(playlistId)}`, {
      method: 'DELETE'
    });
    playlists = playlists.filter((currentPlaylist) => currentPlaylist.id !== playlistId);
    if (selectedPlaylistId === playlistId) {
      selectedPlaylistId = null;
    }
    savePlaylists();
    savePlayerState();
    renderLibrary();
    showToast(`Deleted playlist: ${playlist.name}`);
  } catch (err) {
    showToast(`Delete playlist failed: ${err.message}`);
  }
}

async function movePlaylistTrack(playlistId, index, direction) {
  const playlist = playlists.find((currentPlaylist) => currentPlaylist.id === playlistId);
  const trackIds = playlist ? playlistTrackIds(playlist) : [];
  const nextIndex = index + direction;

  if (!playlist || nextIndex < 0 || nextIndex >= trackIds.length) {
    return;
  }

  [trackIds[index], trackIds[nextIndex]] = [trackIds[nextIndex], trackIds[index]];

  try {
    const data = await requestJson(`/playlists/${encodeURIComponent(playlistId)}/tracks`, {
      method: 'PUT',
      body: JSON.stringify({ trackIds })
    });
    const updatedPlaylist = normalizeApiPlaylist(data.playlist);

    playlists = playlists.map((currentPlaylist) => (
      currentPlaylist.id === playlistId ? updatedPlaylist : currentPlaylist
    ));
    savePlaylists();
    renderLibrary();
  } catch (err) {
    showToast(`Reorder playlist failed: ${err.message}`);
  }
}

async function recordTrackPlay(trackId) {
  recentTrackIds = [
    trackId,
    ...recentTrackIds.filter((currentTrackId) => currentTrackId !== trackId)
  ].slice(0, RECENT_TRACK_LIMIT);
  saveRecentlyPlayed();
  refreshRecentlyPlayed();

  try {
    const response = await fetch(`/tracks/${trackId}/play`, {
      method: 'POST'
    });

    if (response.ok) {
      const data = await response.json().catch(() => ({}));

      if (data.track) {
        updateTrackInMemory(data.track);
      }
      invalidateCollectionCache();
      await loadCollections();
    }
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

  const historyEntry = popPreviousHistoryEntry();

  if (historyEntry) {
    const track = findTrackById(historyEntry.trackId);
    if (track) {
      playTrackFromList(track);
      return;
    }
  }

  audioPlayer.currentTime = 0;
  updateProgress();
  savePlayerState();
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
  scheduleQueueSync();
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
  scheduleQueueSync();
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
      showToast(`Copied: ${track.title}`);
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
    showToast(`Copied: ${track.title}`);
  } catch (err) {
    showToast('Copy is unavailable');
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
  const trackRadioButton = document.createElement('button');
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

  trackRadioButton.type = 'button';
  trackRadioButton.textContent = 'Track Radio';
  trackRadioButton.addEventListener('click', async (event) => {
    event.stopPropagation();
    closeActionMenus();
    await playDiscoveryEndpoint(
      `/discovery/track-radio/${track.id}?limit=50`,
      `Track Radio: ${track.title}`
    );
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
    trackRadioButton,
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
  const num = document.createElement('span');
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

  num.className = 'track-num';
  num.textContent = options.index != null ? String(options.index) : '';
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
  artist.classList.add('meta-link');
  album.classList.add('meta-link');
  artist.setAttribute('role', 'button');
  album.setAttribute('role', 'button');
  artist.tabIndex = 0;
  album.tabIndex = 0;
  artist.addEventListener('click', (event) => {
    event.stopPropagation();
    viewTrackArtist(track);
  });
  album.addEventListener('click', (event) => {
    event.stopPropagation();
    viewTrackAlbum(track);
  });
  artist.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      viewTrackArtist(track);
    }
  });
  album.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      viewTrackAlbum(track);
    }
  });
  button.append(
    num,
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

function renderRowControlButton(label, ariaLabel, onClick, options = {}) {
  const button = document.createElement('button');

  button.type = 'button';
  button.className = 'queue-remove-button row-control-button';
  button.textContent = label;
  button.disabled = Boolean(options.disabled);
  button.setAttribute('aria-label', ariaLabel);
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick();
  });

  return button;
}

function renderDetailTrackRow(track, options = {}) {
  track = hydrateTrack(track);

  const row = document.createElement('div');
  const num = document.createElement('span');
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

  num.className = 'detail-track-num';
  num.textContent = options.index != null ? String(options.index) : '';
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
  artist.classList.add('meta-link');
  album.classList.add('meta-link');
  artist.setAttribute('role', 'button');
  album.setAttribute('role', 'button');
  artist.tabIndex = 0;
  album.tabIndex = 0;
  artist.addEventListener('click', (event) => {
    event.stopPropagation();
    viewTrackArtist(track);
  });
  album.addEventListener('click', (event) => {
    event.stopPropagation();
    viewTrackAlbum(track);
  });
  row.append(
    num,
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
  const num = document.createElement('span');
  const title = document.createElement('span');
  const artist = document.createElement('span');
  const album = document.createElement('span');
  const duration = document.createElement('span');
  const actions = document.createElement('span');
  const isActive = queueActiveIndex === index && track.id === activeTrackId;

  item.className = 'queue-item';
  item.setAttribute('role', 'button');
  item.tabIndex = 0;
  item.classList.toggle('active', isActive);
  item.dataset.trackId = String(track.id);
  item.setAttribute('aria-label', `Play ${track.title}`);

  num.className = 'queue-num';
  num.textContent = String(index + 1);
  title.className = 'queue-name';
  artist.className = 'queue-artist';
  album.className = 'queue-album';
  duration.className = 'queue-duration';
  actions.className = 'row-action-group';

  title.textContent = track.title;
  artist.textContent = formatArtist(track);
  album.textContent = formatAlbum(track);
  duration.textContent = formatTrackDuration(track);

  actions.append(
    renderRowControlButton('↑', `Move ${track.title} up`, () => moveQueueItem(index, -1), {
      disabled: index === 0
    }),
    renderRowControlButton('↓', `Move ${track.title} down`, () => moveQueueItem(index, 1), {
      disabled: index === queueTrackIds.length - 1
    }),
    renderRowControlButton('×', `Remove ${track.title} from queue`, () => removeFromQueue(index))
  );
  artist.classList.add('meta-link');
  album.classList.add('meta-link');
  artist.addEventListener('click', (event) => {
    event.stopPropagation();
    viewTrackArtist(track);
  });
  album.addEventListener('click', (event) => {
    event.stopPropagation();
    viewTrackAlbum(track);
  });

  item.append(num, renderCover(track, 'queue-cover'), title, artist, album, duration, actions);
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
  const num = document.createElement('span');
  const title = document.createElement('span');
  const artist = document.createElement('span');
  const album = document.createElement('span');
  const duration = document.createElement('span');
  const spacer = document.createElement('span');

  item.className = 'queue-item queue-now-playing active';
  num.className = 'queue-num';
  num.textContent = '▶';
  title.className = 'queue-name';
  artist.className = 'queue-artist';
  album.className = 'queue-album';
  duration.className = 'queue-duration';
  spacer.className = 'queue-action-spacer';

  title.textContent = track.title;
  artist.textContent = formatArtist(track);
  album.textContent = formatAlbum(track);
  duration.textContent = formatTrackDuration(track);

  item.append(num, renderCover(track, 'queue-cover'), title, artist, album, duration, spacer);

  return item;
}

function renderQueueHistoryItem(track, index) {
  const item = document.createElement('div');
  const num = document.createElement('span');
  const title = document.createElement('span');
  const artist = document.createElement('span');
  const album = document.createElement('span');
  const duration = document.createElement('span');
  const spacer = document.createElement('span');

  item.className = 'queue-item queue-history-item';
  item.style.opacity = '0.55';
  item.setAttribute('role', 'button');
  item.tabIndex = 0;
  item.dataset.trackId = String(track.id);

  num.className = 'queue-num';
  num.textContent = '↩';
  title.className = 'queue-name';
  artist.className = 'queue-artist';
  album.className = 'queue-album';
  duration.className = 'queue-duration';
  spacer.className = 'queue-action-spacer';

  title.textContent = track.title;
  artist.textContent = formatArtist(track);
  album.textContent = formatAlbum(track);
  duration.textContent = formatTrackDuration(track);

  artist.classList.add('meta-link');
  album.classList.add('meta-link');
  artist.addEventListener('click', (event) => {
    event.stopPropagation();
    viewTrackArtist(track);
  });
  album.addEventListener('click', (event) => {
    event.stopPropagation();
    viewTrackAlbum(track);
  });

  item.append(num, renderCover(track, 'queue-cover'), title, artist, album, duration, spacer);
  item.addEventListener('click', () => {
    playTrackFromList(track);
  });
  item.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      playTrackFromList(track);
    }
  });

  return item;
}

function renderTrackHeaderRow() {
  const header = document.createElement('div');
  const num = document.createElement('span');
  const title = document.createElement('span');
  const artist = document.createElement('span');
  const album = document.createElement('span');
  const genre = document.createElement('span');
  const year = document.createElement('span');

  header.className = 'songs-header-row track-header-row';
  header.setAttribute('aria-hidden', 'true');
  num.textContent = '#';
  title.className = 'songs-header-title';
  title.textContent = 'Title';
  artist.textContent = 'Artist';
  album.textContent = 'Album';
  genre.textContent = 'Genre';
  year.textContent = 'Year';
  header.append(num, title, artist, album, genre, year);

  return header;
}

function renderDetailTrackHeaderRow() {
  const header = document.createElement('div');
  const num = document.createElement('span');
  const title = document.createElement('span');
  const artist = document.createElement('span');
  const album = document.createElement('span');
  const duration = document.createElement('span');
  const actions = document.createElement('span');

  header.className = 'detail-track-header-row';
  header.setAttribute('aria-hidden', 'true');
  num.textContent = '#';
  title.className = 'detail-track-header-title';
  duration.className = 'detail-track-header-duration';
  actions.className = 'detail-track-header-actions';
  title.textContent = 'Title';
  artist.textContent = 'Artist';
  album.textContent = 'Album';
  duration.textContent = 'Duration';
  actions.textContent = 'Actions';
  header.append(num, title, artist, album, duration, actions);

  return header;
}

function renderQueueHeaderRow() {
  const header = document.createElement('div');
  const num = document.createElement('span');
  const title = document.createElement('span');
  const artist = document.createElement('span');
  const album = document.createElement('span');
  const duration = document.createElement('span');
  const actions = document.createElement('span');

  header.className = 'queue-header-row';
  header.setAttribute('aria-hidden', 'true');
  num.textContent = '#';
  title.className = 'queue-header-title';
  title.textContent = 'Title';
  artist.textContent = 'Artist';
  album.textContent = 'Album';
  duration.textContent = 'Duration';
  actions.textContent = 'Actions';
  header.append(num, title, artist, album, duration, actions);

  return header;
}

function renderEmptyState(titleText, copyText) {
  const empty = document.createElement('div');
  const title = document.createElement('strong');

  empty.className = 'empty-state';
  title.textContent = titleText;
  empty.append(title);

  if (copyText) {
    const copy = document.createElement('span');

    copy.textContent = copyText;
    empty.append(copy);
  }

  return empty;
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
  return groupByTracks(tracks, field, fallback);
}

function groupByTracks(trackItems, field, fallback) {
  const grouped = new Map();

  trackItems.forEach((track) => {
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
  if (tabName === 'songs') {
    scheduleSongsVirtualRender();
  }
  renderActiveLibraryPanel();
  savePlayerState();
}

function renderSongs() {
  const header = renderTrackHeaderRow();

  if (tracks.length === 0) {
    trackList.replaceChildren(
      header,
      renderEmptyState(
        searchInput.value.trim() ? 'No songs found' : 'No songs yet',
        searchInput.value.trim() ? 'Try another search.' : 'Scan your music library to add tracks.'
      )
    );
    return;
  }

  const viewport = document.createElement('div');
  const inner = document.createElement('div');

  viewport.className = 'songs-virtual-viewport';
  viewport.style.height = `${tracks.length * SONG_ROW_HEIGHT}px`;
  inner.className = 'songs-virtual-inner';
  viewport.append(inner);
  trackList.replaceChildren(header, viewport);
  updateSongsVirtualRows(true);
}

function scheduleSongsVirtualRender() {
  if (songsVirtualFrame !== null) {
    return;
  }

  songsVirtualFrame = requestAnimationFrame(() => {
    songsVirtualFrame = null;
    updateSongsVirtualRows();
  });
}

function updateSongsVirtualRows(force = false) {
  if (activeLibraryTab !== 'songs' || tracks.length === 0 || !libraryContent) {
    return;
  }

  const viewport = trackList.querySelector('.songs-virtual-viewport');
  const inner = trackList.querySelector('.songs-virtual-inner');
  const header = trackList.querySelector('.songs-header-row');

  if (!viewport || !inner || !header) {
    return;
  }

  const visibleTop = Math.max(0, libraryContent.scrollTop - trackList.offsetTop - header.offsetHeight);
  const visibleBottom = visibleTop + libraryContent.clientHeight;
  const visibleRowCount = Math.ceil(libraryContent.clientHeight / SONG_ROW_HEIGHT) + (SONG_VIRTUAL_BUFFER * 2);
  const maxStart = Math.max(0, tracks.length - visibleRowCount);
  const start = Math.min(
    maxStart,
    Math.max(0, Math.floor(visibleTop / SONG_ROW_HEIGHT) - SONG_VIRTUAL_BUFFER)
  );
  const end = Math.min(
    tracks.length,
    Math.ceil(visibleBottom / SONG_ROW_HEIGHT) + SONG_VIRTUAL_BUFFER
  );

  if (
    !force &&
    songsVirtualRange.start === start &&
    songsVirtualRange.end === end &&
    songsVirtualRange.total === tracks.length
  ) {
    return;
  }

  const contextType = searchInput.value.trim() ? 'search' : 'songs';
  const contextId = searchInput.value.trim() || null;
  const visibleTracks = tracks.slice(start, end);

  songsVirtualRange = {
    start,
    end,
    total: tracks.length
  };
  inner.style.transform = `translateY(${start * SONG_ROW_HEIGHT}px)`;
  inner.replaceChildren(
    ...visibleTracks.map((track, i) => renderTrack(track, {
      onClick: () => playTrackFromContext(track, contextType, contextId, tracks),
      index: start + i + 1
    }))
  );
  syncActiveTrack();
}

function renderCollections() {
  if (selectedCollectionId && selectedCollection) {
    renderCollectionDetail(selectedCollection);
    return;
  }

  const cards = document.createElement('div');

  cards.className = 'playlist-list collections-grid';

  if (smartCollections.length === 0) {
    collectionsList.className = 'playlist-view';
    collectionsList.replaceChildren(renderEmptyState('No smart collections yet', 'Play tracks to build listening intelligence.'));
    return;
  }

  cards.append(...smartCollections.map((collection) => {
    const card = document.createElement('button');
    const copy = document.createElement('span');
    const title = document.createElement('span');
    const meta = document.createElement('span');
    const cover = document.createElement('span');

    card.type = 'button';
    card.className = 'playlist-card collection-card';
    cover.className = 'group-cover collection-cover';
    cover.textContent = '◆';
    copy.className = 'playlist-card-copy';
    title.className = 'group-title';
    meta.className = 'group-meta';
    title.textContent = collection.title;
    meta.textContent = collection.description || formatTrackCount(collection.count || 0);
    copy.append(title, meta);
    card.append(cover, copy);
    card.addEventListener('click', () => openCollection(collection.id));

    return card;
  }));

  collectionsList.className = 'playlist-view';
  collectionsList.replaceChildren(cards);
}

async function openCollection(collectionId) {
  if (collectionId === 'library-health-local') {
    selectedCollectionId = collectionId;
    selectedCollection = {
      ...libraryHealthCollection(),
      tracks: recentAddedTracks().slice(0, 20)
    };
    setActiveLibraryTab('collections');
    renderCollections();
    return;
  }

  if (collectionDetailCache.has(collectionId)) {
    selectedCollectionId = collectionId;
    selectedCollection = collectionDetailCache.get(collectionId);
    setActiveLibraryTab('collections');
    renderCollections();
    return;
  }

  try {
    const data = await requestJson(`/collections/${encodeURIComponent(collectionId)}`);

    selectedCollectionId = collectionId;
    selectedCollection = data.collection || null;
    if (selectedCollection) {
      collectionDetailCache.set(collectionId, selectedCollection);
    }
    setActiveLibraryTab('collections');
    renderCollections();
  } catch (err) {
    showToast(`Collection failed: ${err.message}`);
  }
}

function renderCollectionDetail(collection) {
  const collectionTracks = Array.isArray(collection.tracks) ? collection.tracks : [];
  const header = document.createElement('div');
  const backButton = document.createElement('button');
  const copy = document.createElement('div');
  const title = document.createElement('h3');
  const meta = document.createElement('p');
  const list = document.createElement('div');

  collectionsList.className = 'detail-view collection-detail-view';
  header.className = 'detail-header collection-detail-header';
  backButton.type = 'button';
  backButton.className = 'detail-back-button';
  backButton.textContent = '←';
  backButton.setAttribute('aria-label', 'Back to smart collections');
  backButton.title = 'Smart Collections';
  backButton.addEventListener('click', () => {
    selectedCollectionId = null;
    selectedCollection = null;
    renderCollections();
  });
  title.className = 'detail-title';
  title.textContent = collection.title;
  meta.className = 'detail-meta';
  meta.textContent = formatTrackCount(collectionTracks.length);
  copy.append(title, meta);

  list.className = 'track-grid-4 collection-track-list';
  list.append(
    renderTrackHeaderRow(),
    ...(collectionTracks.length > 0
      ? collectionTracks.map((track, i) => renderTrack(track, {
        onClick: () => playTrackFromContext(track, `collection:${collection.id}`, collection.id, collectionTracks),
        index: i + 1
      }))
      : [renderEmptyState('No tracks yet')])
  );

  header.append(backButton, copy);
  collectionsList.replaceChildren(header, list);
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
  const albumCacheKey = `${libraryDataVersion}:${lastSearchResultIds}:${albumName}`;
  let albumDetail = albumDetailCache.get(albumCacheKey);

  if (!albumDetail) {
    const albumTracks = tracks.filter((track) => formatAlbum(track) === albumName);
    albumDetail = {
      tracks: albumTracks,
      coverTrack: albumTracks[0] || null,
      artist: albumTracks[0] ? formatArtist(albumTracks[0]) : 'Unknown artist',
      totalDuration: formatPlaylistTotalDuration(albumTracks)
    };
    albumDetailCache.set(albumCacheKey, albumDetail);
  }

  const albumTracks = albumDetail.tracks;
  const header = document.createElement('div');
  const backButton = document.createElement('button');
  const cover = document.createElement('div');
  const copy = document.createElement('div');
  const title = document.createElement('h3');
  const meta = document.createElement('p');
  const actions = document.createElement('div');
  const playButton = document.createElement('button');
  const queueButton = document.createElement('button');
  const radioButton = document.createElement('button');
  const list = document.createElement('div');
  const coverTrack = albumDetail.coverTrack;
  const albumArtist = albumDetail.artist;
  const totalDuration = albumDetail.totalDuration;

  albumsList.className = 'detail-view';
  header.className = 'detail-header detail-hero album-detail-header';
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
  meta.textContent = [
    albumArtist,
    formatTrackCount(albumTracks.length),
    totalDuration
  ].filter(Boolean).join(' · ');
  cover.className = 'detail-hero-cover';
  cover.append(coverTrack ? renderCover(coverTrack, 'group-cover') : renderPlaylistPlaceholderCover());
  actions.className = 'detail-actions';
  playButton.type = 'button';
  playButton.className = 'view-more-button';
  playButton.textContent = 'Play album';
  playButton.disabled = albumTracks.length === 0;
  playButton.addEventListener('click', () => {
    if (albumTracks.length > 0) {
      playTrackFromContext(albumTracks[0], 'album', albumName, albumTracks);
    }
  });
  queueButton.type = 'button';
  queueButton.className = 'view-more-button';
  queueButton.textContent = 'Add album to queue';
  queueButton.disabled = albumTracks.length === 0;
  queueButton.addEventListener('click', () => addTracksToQueue(albumTracks, 'Added album to queue'));
  radioButton.type = 'button';
  radioButton.className = 'view-more-button';
  radioButton.textContent = 'Album Radio';
  radioButton.disabled = albumTracks.length === 0;
  radioButton.addEventListener('click', () => playDiscoveryEndpoint(
    `/discovery/album-radio?album=${encodeURIComponent(albumName)}&artist=${encodeURIComponent(albumArtist)}&limit=50`,
    `Album Radio: ${albumName}`,
    radioButton
  ));
  actions.append(playButton, queueButton, radioButton);
  copy.append(title, meta, actions);

  list.className = 'detail-track-grid album-detail-list';
  list.append(
    renderDetailTrackHeaderRow(),
    ...albumTracks.map((track, i) => renderDetailTrackRow(track, {
      onClick: () => playTrackFromContext(track, 'album', albumName, albumTracks),
      index: i + 1
    }))
  );

  header.append(backButton, cover, copy);
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
  const artistCacheKey = `${libraryDataVersion}:${lastSearchResultIds}:${artistName}`;
  let artistDetail = artistDetailViewCache.get(artistCacheKey);

  if (!artistDetail) {
    const artistTracks = tracks.filter((track) => formatArtist(track) === artistName);
    artistDetail = {
      tracks: artistTracks,
      albums: groupByTracks(artistTracks, 'album', 'Unknown album')
    };
    artistDetailViewCache.set(artistCacheKey, artistDetail);
  }

  const artistTracks = artistDetail.tracks;
  const cachedInfo = artistInfoCache.get(cacheKeyForArtist(artistName)) || localArtistInfoFallback(artistName);
  const artistAlbums = artistDetail.albums;
  const popularTracks = cachedInfo.popularTracks?.length > 0
    ? cachedInfo.popularTracks
    : cachedInfo.topTracks;
  const header = document.createElement('div');
  const backButton = document.createElement('button');
  const avatar = document.createElement('div');
  const avatarImage = document.createElement('img');
  const copy = document.createElement('div');
  const title = document.createElement('h3');
  const meta = document.createElement('p');
  const bio = document.createElement('p');
  const sources = document.createElement('div');
  const stats = document.createElement('div');
  const albums = document.createElement('div');
  const popular = document.createElement('div');
  const actions = document.createElement('div');
  const radioButton = document.createElement('button');
  const list = document.createElement('div');
  const similarSection = document.createElement('div');

  artistsList.className = 'detail-view';
  header.className = 'detail-header detail-hero artist-detail-header';
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
  meta.textContent = [
    formatTrackCount(artistTracks.length),
    `${artistAlbums.length} ${artistAlbums.length === 1 ? 'album' : 'albums'}`,
    cachedInfo.listeners ? `Listeners ${formatCompactNumber(cachedInfo.listeners)}` : null,
    cachedInfo.playcount ? `Playcount ${formatCompactNumber(cachedInfo.playcount)}` : null
  ].filter(Boolean).join(' · ');
  avatar.className = 'artist-detail-avatar';
  avatar.textContent = artistInitials(artistName);
  if (cachedInfo.image) {
    avatarImage.alt = '';
    avatarImage.src = cachedInfo.image;
    avatarImage.addEventListener('load', () => {
      avatar.textContent = '';
      avatar.append(avatarImage);
    }, { once: true });
    avatarImage.addEventListener('error', () => {
      avatar.textContent = artistInitials(artistName);
    }, { once: true });
  }
  bio.className = 'artist-detail-bio';
  bio.textContent = normalizeArtistDescription(cachedInfo.bio)
    || normalizeArtistDescription(cachedInfo.disambiguation)
    || (cachedInfo.area ? `Area: ${cachedInfo.area}` : 'Additional artist information is unavailable.');
  sources.className = 'artist-detail-sources';
  sources.append(...sourceBadgeElements(cachedInfo));
  stats.className = 'artist-detail-stats';
  stats.textContent = `Tracks ${artistTracks.length} · Albums ${artistAlbums.length} · Country ${formatCountryName(cachedInfo.country)}`;
  albums.className = 'artist-detail-mini-section';
  albums.textContent = `Albums: ${artistAlbums.slice(0, 4).map((album) => album.name).join(' · ') || 'N/A'}`;
  popular.className = 'artist-detail-mini-section';
  popular.textContent = `Popular Tracks: ${(popularTracks || []).slice(0, 3).map((track) => track.title).join(' · ') || 'N/A'}`;
  actions.className = 'detail-actions';
  radioButton.type = 'button';
  radioButton.className = 'artist-radio-btn';
  radioButton.title = 'Play a radio mix seeded from this artist';
  const arbIcon = document.createElement('span');
  arbIcon.className = 'arb-icon';
  arbIcon.textContent = '▶';
  const arbLabel = document.createElement('span');
  arbLabel.textContent = 'Artist Radio';
  radioButton.replaceChildren(arbIcon, arbLabel);
  radioButton.addEventListener('click', () => playArtistRadio(artistName, radioButton));
  actions.append(radioButton);

  copy.append(title, meta, bio, sources, stats, albums, popular, actions);

  list.className = 'detail-track-grid artist-detail-list';
  list.append(
    renderDetailTrackHeaderRow(),
    ...artistTracks.map((track, i) => renderDetailTrackRow(track, {
      onClick: () => playTrackFromContext(track, 'artist', artistName, artistTracks),
      index: i + 1
    }))
  );

  similarSection.className = 'discovery-similar-section';
  if (!similarArtistsCache.has(artistName)) {
    const loadingMsg = document.createElement('p');
    loadingMsg.className = 'discovery-similar-loading';
    loadingMsg.textContent = 'Loading similar artists…';
    similarSection.append(loadingMsg);
  }

  // Store refs for surgical patching when artist info loads asynchronously
  currentArtistDetailRefs = {
    artistName,
    artistTracks,
    artistAlbums,
    avatar,
    avatarImage,
    meta,
    bio,
    sources,
    stats,
    popular
  };

  header.append(backButton, avatar, copy);
  artistsList.replaceChildren(header, list, similarSection);

  loadSimilarArtistsInto(artistName, similarSection);

  if (!isFreshArtistInfo(artistInfoCache.get(cacheKeyForArtist(artistName)))) {
    getArtistInfo(artistName)
      .then(() => {
        if (selectedArtistName === artistName) {
          patchArtistDetailInfo(artistName);
        }
      })
      .catch(() => {});
  }
}

function patchArtistDetailInfo(artistName) {
  const refs = currentArtistDetailRefs;

  if (!refs || refs.artistName !== artistName) {
    return;
  }

  const cachedInfo = artistInfoCache.get(cacheKeyForArtist(artistName)) || localArtistInfoFallback(artistName);
  const popularTracks = cachedInfo.popularTracks?.length > 0
    ? cachedInfo.popularTracks
    : cachedInfo.topTracks;

  refs.meta.textContent = [
    formatTrackCount(refs.artistTracks.length),
    `${refs.artistAlbums.length} ${refs.artistAlbums.length === 1 ? 'album' : 'albums'}`,
    cachedInfo.listeners ? `Listeners ${formatCompactNumber(cachedInfo.listeners)}` : null,
    cachedInfo.playcount ? `Playcount ${formatCompactNumber(cachedInfo.playcount)}` : null
  ].filter(Boolean).join(' · ');

  refs.bio.textContent = normalizeArtistDescription(cachedInfo.bio)
    || normalizeArtistDescription(cachedInfo.disambiguation)
    || (cachedInfo.area ? `Area: ${cachedInfo.area}` : 'Additional artist information is unavailable.');

  refs.sources.replaceChildren(...sourceBadgeElements(cachedInfo));

  refs.stats.textContent = `Tracks ${refs.artistTracks.length} · Albums ${refs.artistAlbums.length} · Country ${formatCountryName(cachedInfo.country)}`;

  refs.popular.textContent = `Popular Tracks: ${(popularTracks || []).slice(0, 3).map((t) => t.title).join(' · ') || 'N/A'}`;

  if (cachedInfo.image && !refs.avatar.querySelector('img')) {
    refs.avatarImage.alt = '';
    refs.avatarImage.src = cachedInfo.image;
    refs.avatarImage.addEventListener('load', () => {
      refs.avatar.textContent = '';
      refs.avatar.append(refs.avatarImage);
    }, { once: true });
  }
}

function renderFavorites() {
  if (favoriteTracks.length === 0) {
    favoritesList.replaceChildren(
      renderTrackHeaderRow(),
      renderEmptyState('No favorites yet')
    );
    return;
  }

  favoritesList.replaceChildren(
    renderTrackHeaderRow(),
    ...favoriteTracks.map((track, i) => renderTrack(track, {
      onClick: () => playTrackFromContext(track, 'favorites', null, favoriteTracks),
      index: i + 1
    }))
  );
}

function renderRecentlyAdded() {
  const items = recentAddedTracks();
  recentlyAddedList.replaceChildren(
    renderTrackHeaderRow(),
    ...(items.length > 0
      ? items.map((track, i) => renderTrack(track, {
        onClick: () => playTrackFromContext(track, 'recentAdded', null, items),
        index: i + 1
      }))
      : [renderEmptyState('No recently added tracks')])
  );
}

function renderRecentlyPlayed() {
  recentlyList.replaceChildren(
    renderTrackHeaderRow(),
    ...(recentTracks.length > 0
      ? recentTracks.map((track, i) => renderTrack(track, {
        onClick: () => playTrackFromContext(track, 'recent', null, recentTracks),
        index: i + 1
      }))
      : [renderEmptyState('No recently played tracks')])
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
    list.append(renderEmptyState('No playlists yet', 'Create your first playlist above.'));
  } else {
    list.append(...playlists.map((playlist) => renderPlaylistCard(playlist)));
  }

  playlistsList.className = 'playlist-view';
  playlistsList.replaceChildren(form, list);
}

function renderPlaylistCard(playlist) {
  const card = document.createElement('div');
  const copy = document.createElement('span');
  const title = document.createElement('span');
  const meta = document.createElement('span');
  const actions = document.createElement('span');
  const coverTrack = playlistTracks(playlist)[0];

  card.className = 'playlist-card';
  card.setAttribute('role', 'button');
  card.tabIndex = 0;
  copy.className = 'playlist-card-copy';
  actions.className = 'playlist-card-actions';
  title.className = 'group-title';
  meta.className = 'group-meta';
  title.textContent = playlist.name;
  const trackCount = Number.isInteger(playlist.trackCount)
    ? playlist.trackCount
    : playlistTrackIds(playlist).length;
  meta.textContent = `${trackCount} ${trackCount === 1 ? 'song' : 'songs'}`;
  copy.append(title, meta);
  actions.append(
    renderRowControlButton('Rename', `Rename ${playlist.name}`, () => renamePlaylist(playlist.id)),
    renderRowControlButton('Delete', `Delete ${playlist.name}`, () => deletePlaylist(playlist.id))
  );
  card.append(
    coverTrack
      ? renderCover(coverTrack, 'group-cover')
      : renderPlaylistCover(playlist),
    copy,
    actions
  );
  card.addEventListener('click', async () => {
    selectedPlaylistId = playlist.id;
    savePlayerState();
    try {
      await loadPlaylistDetailFromApi(playlist.id);
    } catch (err) {
      showToast(`Playlist detail failed: ${err.message}`);
    }
    renderPlaylists();
  });
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      card.click();
    }
  });

  return card;
}

function renderPlaylistCover(playlist) {
  if (playlist.cover_track_id) {
    return renderCover({
      id: playlist.cover_track_id,
      title: playlist.name
    }, 'group-cover');
  }

  return renderPlaylistPlaceholderCover();
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
  const trackCount = Number.isInteger(playlist.trackCount)
    ? playlist.trackCount
    : playlistTrackIds(playlist).length;
  const totalDuration = formatPlaylistTotalDuration(playlistItems);
  meta.textContent = [
    `${trackCount} ${trackCount === 1 ? 'song' : 'songs'}`,
    totalDuration
  ].filter(Boolean).join(' · ');
  copy.append(title, meta);

  list.className = 'detail-track-grid playlist-detail-list';

  if (playlistItems.length === 0) {
    list.append(
      renderDetailTrackHeaderRow(),
      renderEmptyState('No tracks yet', 'Add songs from the action menu')
    );
  } else {
    list.append(
      renderDetailTrackHeaderRow(),
      ...playlistItems.map((track, index) => renderPlaylistTrackRow(track, playlist.id, playlistItems, index))
    );
  }

  header.append(backButton, copy);
  playlistsList.replaceChildren(header, list);
}

function renderPlaylistTrackRow(track, playlistId, playlistItems = [], index = 0) {
  const row = renderDetailTrackRow(track, {
    playlistId,
    onClick: () => playTrackFromContext(track, 'playlist', playlistId, playlistItems),
    index: index + 1
  });
  const actions = document.createElement('span');

  actions.className = 'row-action-group';
  actions.append(
    renderRowControlButton('↑', `Move ${track.title} up`, () => movePlaylistTrack(playlistId, index, -1), {
      disabled: index === 0
    }),
    renderRowControlButton('↓', `Move ${track.title} down`, () => movePlaylistTrack(playlistId, index, 1), {
      disabled: index === playlistItems.length - 1
    }),
    renderRowControlButton('×', `Remove ${track.title} from playlist`, () => removeTrackFromPlaylist(playlistId, track.id))
  );
  row.append(actions);

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

  // Lịch sử phát (loại trừ bài hiện tại là phần tử cuối trong queueHistory)
  const historyEntries = queueHistory.slice(0, -1);
  const historyTracks = historyEntries
    .map((entry) => findTrackById(entry.trackId))
    .filter(Boolean)
    .slice(-5); // Lấy tối đa 5 bài gần nhất

  if (historyTracks.length > 0) {
    const historySection = document.createElement('div');
    const label = document.createElement('span');
    const list = document.createElement('div');

    historySection.className = 'queue-section queue-history-section';
    label.className = 'queue-section-label';
    label.textContent = 'Recently played';
    list.className = 'queue-items queue-history-items';
    list.append(renderQueueHeaderRow(), ...historyTracks.map((t, idx) => renderQueueHistoryItem(t, idx)));
    historySection.append(label, list);
    queueSections.push(historySection);
  }

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
    queueSections.push(
      renderQueueHeaderRow(),
      renderEmptyState('Queue is empty', 'Add songs with Play Next or Add to Queue.')
    );
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

function renderMixes() {
  const mixes = [
    {
      title: 'Auto Mix',
      description: 'Favorites, most played, and recently played.',
      endpoint: '/discovery/auto-mix?limit=50'
    },
    {
      title: 'Daily Mix',
      description: 'A fresh mix based on your recent listening.',
      endpoint: '/discovery/daily-mix?limit=50'
    },
    {
      title: 'Because You Played',
      description: 'Continue from your latest listening session.',
      endpoint: '/discovery/because-you-played?limit=50'
    }
  ];
  const intro = document.createElement('div');
  const title = document.createElement('h3');
  const description = document.createElement('p');
  const grid = document.createElement('div');

  intro.className = 'mixes-intro';
  title.className = 'detail-title';
  title.textContent = 'Made for your library';
  description.className = 'detail-meta';
  description.textContent = 'Local-first mixes built from favorites and listening history.';
  intro.append(title, description);
  grid.className = 'mixes-grid';

  mixes.forEach((mix) => {
    const card = document.createElement('article');
    const cardTitle = document.createElement('h4');
    const cardDescription = document.createElement('p');
    const playButton = document.createElement('button');

    card.className = 'mix-card';
    cardTitle.textContent = mix.title;
    cardDescription.textContent = mix.description;
    playButton.type = 'button';
    playButton.className = 'view-more-button';
    playButton.textContent = 'Play mix';
    playButton.addEventListener('click', () => (
      playDiscoveryEndpoint(mix.endpoint, mix.title, playButton)
    ));
    card.append(cardTitle, cardDescription, playButton);
    grid.append(card);
  });

  mixesList.replaceChildren(intro, grid);
}

function renderActiveLibraryPanel() {
  if (activeLibraryTab === 'songs') {
    renderSongs();
  } else if (activeLibraryTab === 'collections') {
    renderCollections();
  } else if (activeLibraryTab === 'albums') {
    renderAlbums();
  } else if (activeLibraryTab === 'artists') {
    renderArtists();
  } else if (activeLibraryTab === 'favorites') {
    renderFavorites();
  } else if (activeLibraryTab === 'recentAdded') {
    renderRecentlyAdded();
  } else if (activeLibraryTab === 'recent') {
    renderRecentlyPlayed();
  } else if (activeLibraryTab === 'playlists') {
    renderPlaylists();
  } else if (activeLibraryTab === 'mixes') {
    renderMixes();
  } else if (activeLibraryTab === 'queue') {
    renderQueue();
  }
}

function renderLibrary() {
  renderActiveLibraryPanel();
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
    invalidateLibraryViewCaches();
    invalidateCollectionCache();
    if (!hasLoadedPersistentLibraryState) {
      await loadPersistentLibraryState();
      if (selectedPlaylistId) {
        await loadPlaylistDetailFromApi(selectedPlaylistId).catch(() => {});
      }
    }
    pruneMissingTrackReferences();
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

async function loadCollections() {
  if (collectionsCache && Date.now() - collectionsCacheUpdatedAt < COLLECTION_CACHE_TTL_MS) {
    smartCollections = collectionsCache;
    renderCollections();
    return;
  }

  try {
    const data = await requestJson('/collections');

    smartCollections = [
      ...(Array.isArray(data.collections) ? data.collections : [])
        .filter((collection) => collection.id !== 'library-health-local'),
      libraryHealthCollection()
    ];
    collectionsCache = smartCollections;
    collectionsCacheUpdatedAt = Date.now();
    renderCollections();
  } catch (err) {
    smartCollections = [libraryHealthCollection()];
    showToast(`Collections failed: ${err.message}`);
    renderCollections();
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

  renderSettingsPanel();
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
        clearArtistInfoCache();
    await loadTracks(searchInput.value);
    await loadFavorites();
    await loadCollections();
    refreshActiveArtistInfo();
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

  if (!autoScanEnabled) {
    renderSettingsPanel();
    return;
  }

  autoScanTimerId = setInterval(() => {
    runAutoScan('timer');
  }, autoScanIntervalMinutes * 60 * 1000);
  renderSettingsPanel();
}

function restartAutoScanTimer() {
  stopAutoScanTimer();

  if (autoScanEnabled) {
    startAutoScanTimer();
  } else {
    renderSettingsPanel();
  }
}

async function requestLibraryScan() {
  const response = await fetch('/library/scan/now', {
    method: 'POST'
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const responseBody = errorData.message
      ? `${errorData.error || 'Failed to scan library'}: ${errorData.message}`
      : errorData.error || 'No response body';
    throw new Error(
      `/library/scan/now failed (${response.status}): ${responseBody}`
    );
  }

  return response.json();
}

async function runAutoScan(reason = 'manual') {
  if (reason === 'timer' && !autoScanEnabled) {
    return null;
  }

  if (isAutoScanning) {
    console.warn(`Library scan skipped: previous scan still running (${reason})`);
    return null;
  }

  isAutoScanning = true;
  updateAutoScanStatus('Scanning');

  try {
    const result = await requestLibraryScan();
    lastAutoScanAt = new Date().toISOString();
    saveAutoScanSettings();
    statusMessage.textContent = `Scan completed: ${result.inserted} added, ${result.skipped} skipped, ${result.removed || 0} removed`;
    clearArtistInfoCache();
    invalidateCollectionCache();
    await loadTracks(searchInput.value);
    await loadFavorites();
    await loadRecentlyPlayed();
    refreshActiveArtistInfo();
    updateAutoScanStatus('Idle');
    return result;
  } catch (err) {
    statusMessage.textContent = err.message;
    updateAutoScanStatus('Error');
    console.warn(`Library scan failed (${reason}): ${err.message}`);
    return null;
  } finally {
    isAutoScanning = false;
    renderSettingsPanel();
    await loadAutoScanStatus();
  }
}

async function scanNow() {
  await runAutoScan('manual');
}

function bindSettingsControls() {
  settingsButton?.addEventListener('click', openSettings);
  settingsCloseButton?.addEventListener('click', closeSettings);

  settingsOverlay?.addEventListener('click', (event) => {
    if (event.target === settingsOverlay) {
      closeSettings();
    }
  });

  autoScanToggle?.addEventListener('change', () => {
    autoScanEnabled = autoScanToggle.checked;
    autoScanStatus = 'Idle';
    saveAutoScanSettings();
    restartAutoScanTimer();
    renderSettingsPanel();
  });

  autoScanIntervalSelect?.addEventListener('change', () => {
    const nextInterval = Number(autoScanIntervalSelect.value);

    if (!AUTO_SCAN_INTERVAL_OPTIONS.includes(nextInterval)) {
      autoScanIntervalSelect.value = String(autoScanIntervalMinutes);
      return;
    }

    autoScanIntervalMinutes = nextInterval;
    saveAutoScanSettings();
    restartAutoScanTimer();
    renderSettingsPanel();
  });

  scanNowButton?.addEventListener('click', () => {
    scanNow();
  });
}

async function toggleFavorite(track) {
  const shouldFavorite = !track.is_favorite;
  const response = await fetch(`/tracks/${track.id}/favorite`, {
    method: shouldFavorite ? 'POST' : 'DELETE'
  });

  if (!response.ok) {
    showToast(`Failed to update favorite: ${response.status}`);
    return;
  }

  const data = await response.json();

  if (data.track) {
    updateTrackInMemory(data.track);
  }

  await loadTracks(searchInput.value);
  await loadFavorites();
  invalidateCollectionCache();
  await loadCollections();
  await loadRecentlyPlayed();
  showToast(shouldFavorite
    ? `Added to favorites: ${track.title}`
    : `Removed from favorites: ${track.title}`);
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
  if (event.key === 'Escape' && settingsOverlay && !settingsOverlay.hidden) {
    event.preventDefault();
    closeSettings();
    return;
  }

  if (event.target instanceof Element && event.target.closest('.settings-panel')) {
    return;
  }

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
libraryContent?.addEventListener('scroll', () => {
  if (activeLibraryTab === 'songs') {
    scheduleSongsVirtualRender();
  }
}, {
  passive: true
});

searchInput.addEventListener('input', () => {
  const nextSearchValue = searchInput.value;

  clearTimeout(searchTimer);

  searchTimer = setTimeout(() => {
    const didChange = applyTrackSearch(nextSearchValue);

    if (!didChange) {
      return;
    }

    if (activeLibraryTab === 'songs' && libraryContent) {
      libraryContent.scrollTop = 0;
    }
    renderLibrary();
    updateQueueControls();
    updateTracksStatus(nextSearchValue);
  }, SEARCH_DEBOUNCE_MS);
});

restoreSavedPreferences();
loadAutoScanSettings();
saveAutoScanSettings();
bindSettingsControls();
renderSettingsPanel();
updatePlayButton();
updateProgress();
isRestoringPlayer = true;
setActiveLibraryTab(activeLibraryTab);
isRestoringPlayer = false;
restoreDiscoveryTracksCache();
loadTracks();
loadFavorites();
loadCollections();
loadRecentlyPlayed();
loadAutoScanStatus();
startAutoScanTimer();
setInterval(loadAutoScanStatus, 30000);

// ---------------------------------------------------------------------------
// v3.2 Discovery Engine
// ---------------------------------------------------------------------------

function saveDiscoveryTracksCache() {
  localStorage.setItem(DISCOVERY_CACHE_STORAGE_KEY, JSON.stringify(Array.from(discoveryTracksCache.entries())));
}

function restoreDiscoveryTracksCache() {
  try {
    const stored = localStorage.getItem(DISCOVERY_CACHE_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        for (const [id, track] of parsed) {
          discoveryTracksCache.set(Number(id), track);
        }
      }
    }
  } catch (err) {
    console.error('Failed to restore discovery tracks cache:', err);
  }
}

async function playDiscoveryEndpoint(endpoint, label, buttonEl = null) {
  if (buttonEl) {
    buttonEl.classList.add('is-loading');
    buttonEl.disabled = true;
  }

  try {
    const data = await requestJson(endpoint);
    const mixTracks = (data.tracks || [])
      .map((t) => {
        let track = findTrackById(t.id);
        if (!track) {
          discoveryTracksCache.set(t.id, t);
          saveDiscoveryTracksCache();
          track = t;
        }
        return track;
      })
      .filter(Boolean);

    if (!mixTracks.length) {
      showToast(`${label} has no matching tracks`);
      return;
    }

    const [firstTrack, ...upNextTracks] = mixTracks;

    queueTrackIds = upNextTracks.map((track) => track.id);
    queueActiveIndex = -1;
    queueHistory = [];
    setPlaybackContext(data.type || 'discovery', label, [firstTrack], firstTrack.id);
    saveQueue();
    playTrackAt(0);
    renderQueue();
    showToast(`${label} · ${mixTracks.length} tracks`);
  } catch (err) {
    console.error(`${label} failed:`, err);
    showToast(`${label} unavailable`);
  } finally {
    if (buttonEl) {
      buttonEl.classList.remove('is-loading');
      buttonEl.disabled = false;
    }
  }
}

async function playArtistRadio(artistName, buttonEl) {
  return playDiscoveryEndpoint(
    `/discovery/artist-radio/${encodeURIComponent(artistName)}?limit=50`,
    `Artist Radio: ${artistName}`,
    buttonEl
  );
}

function renderSimilarArtistsChips(artists, container) {
  if (!artists.length) {
    if (container.isConnected) {
      container.remove();
    }
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'discovery-similar-grid';

  artists.forEach((a) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'discovery-similar-chip';
    const nameSpan = document.createElement('span');
    nameSpan.textContent = a.name;
    const countSpan = document.createElement('span');
    countSpan.className = 'chip-count';
    countSpan.textContent = `${a.trackCount} track${a.trackCount !== 1 ? 's' : ''}`;
    chip.append(nameSpan, countSpan);
    chip.addEventListener('click', () => {
      selectedArtistName = a.name;
      renderArtists();
    });
    grid.append(chip);
  });

  container.replaceChildren(
    Object.assign(document.createElement('h4'), { textContent: 'Similar Artists' }),
    grid
  );
}

async function loadSimilarArtistsInto(artistName, container) {
  // Cache hit — render immediately, no loading state, no fetch
  if (similarArtistsCache.has(artistName)) {
    renderSimilarArtistsChips(similarArtistsCache.get(artistName), container);
    return;
  }

  try {
    const response = await fetch(`/discovery/similar-artists/${encodeURIComponent(artistName)}?limit=10`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const artists = data.artists || [];

    similarArtistsCache.set(artistName, artists);

    // Guard: container may have been replaced if user navigated away during fetch
    if (!container.isConnected) {
      return;
    }

    renderSimilarArtistsChips(artists, container);
  } catch (err) {
    console.error('Similar artists fetch failed:', err);
    if (container.isConnected) {
      container.remove();
    }
  }
}
