'use strict';

const PREVIEW_LIMITS = {
  songs: 20,
  albums: 8,
  artists: 8,
  favorites: 10,
  recentAdded: 20,
  recent: 20,
  queue: 20
};

const QUEUE_STORAGE_KEY = 'music-server.queue.v1';
const PLAYLISTS_STORAGE_KEY = 'music-server.playlists.v1';
const PLAYER_STATE_STORAGE_KEY = 'music-server.player-state.v1';
const ARTIST_INFO_CACHE_KEY = 'music-server.artist-info-cache.v1';
const ARTIST_INFO_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

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
const autoScanStatus = document.getElementById('auto-scan-status');
const autoScanInterval = document.getElementById('auto-scan-interval');
const autoScanLast = document.getElementById('auto-scan-last');
const scanNowButton = document.getElementById('scan-now-button');
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
const heroPlayButton = document.getElementById('hero-play-button');
const heroShuffleButton = document.getElementById('hero-shuffle-button');

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
let savedPlayerState = normalizePlayerState(readStoredObject(PLAYER_STATE_STORAGE_KEY));
let queueTrackIds = savedPlayerState.queueTrackIds.length > 0
  ? [...savedPlayerState.queueTrackIds]
  : readStoredArray(QUEUE_STORAGE_KEY);
let queueActiveIndex = -1;
let queueHistory = Array.isArray(savedPlayerState.queueHistory)
  ? [...savedPlayerState.queueHistory]
  : [];
let playbackContext = normalizePlaybackContext(savedPlayerState.playbackContext);
let playlists = normalizePlaylists(readStoredArray(PLAYLISTS_STORAGE_KEY));
let artistInfoCache = readStoredObject(ARTIST_INFO_CACHE_KEY);
let activeArtistInfoRequest = null;
let pendingResumeTime = null;
let hasRestoredPlayer = false;
let isRestoringPlayer = false;
let lastPlayerStateSaveAt = 0;
let canonicalDuration = 0;
let canonicalDurationTrackId = null;
const coverObjectUrlCache = new Map();
const trackRatings = new Map();

const expandedSections = {
  songs: false,
  albums: false,
  artists: false,
  favorites: false,
  recentAdded: false,
  recent: false,
  playlists: false,
  queue: false
};

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

function normalizePlaylists(value) {
  return value
    .filter((playlist) => playlist && typeof playlist === 'object')
    .map((playlist) => ({
      id: typeof playlist.id === 'string'
        ? playlist.id
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name: typeof playlist.name === 'string' && playlist.name.trim()
        ? playlist.name.trim()
        : 'Untitled playlist',
      trackIds: Array.isArray(playlist.trackIds)
        ? [...new Set(playlist.trackIds.filter((trackId) => Number.isInteger(trackId)))]
        : []
    }));
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
  playlists = normalizePlaylists(playlists);
  writeStoredArray(PLAYLISTS_STORAGE_KEY, playlists);
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
  } else if (savedPlayerState.playbackContext.contextType === 'playlist') {
    selectedPlaylistId = savedPlayerState.playbackContext.contextId;
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
  queueActiveIndex = savedPlayerState.queueActiveIndex >= 0 &&
    queueTrackIds[savedPlayerState.queueActiveIndex] === track.id
    ? savedPlayerState.queueActiveIndex
    : -1;
  pendingResumeTime = savedPlayerState.currentTime;
  loadTrackIntoPlayer(track);
  audioPlayer.pause();
  renderLibrary();
  syncActiveTrack();
  updateQueueControls();
  updatePlayButton();
  isRestoringPlayer = false;
}

function formatDuration(duration) {
  if (!Number.isInteger(duration)) {
    return 'Unknown duration';
  }

  const minutes = Math.floor(duration / 60);
  const seconds = String(duration % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
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
  }

  return canonicalDuration;
}

function formatArtist(track) {
  return track.artist || 'Unknown artist';
}

function formatAlbum(track) {
  return track.album || 'Unknown album';
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
  const keyword = searchValue.trim();

  if (tracks.length === 0) {
    statusMessage.textContent = keyword
      ? '0 tracks found'
      : 'No tracks found';
    return;
  }

  statusMessage.textContent = keyword
    ? `${tracks.length} tracks found`
    : `${tracks.length} tracks`;
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
  const trackIds = Array.isArray(playlist.trackIds) ? playlist.trackIds : [];

  return trackIds
    .map((trackId) => findTrackById(trackId))
    .filter(Boolean);
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

function visibleItems(key, items) {
  return expandedSections[key] ? items : items.slice(0, PREVIEW_LIMITS[key]);
}

function updateViewMoreButton(key, total) {
  const button = document.querySelector(`[data-view-more="${key}"]`);

  if (!button) {
    return;
  }

  button.hidden = total <= PREVIEW_LIMITS[key];
  button.textContent = expandedSections[key] ? 'Show less' : 'View more';
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
  return `/tracks/${trackId}/cover`;
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
  heroShuffleButton.classList.toggle('active', isShuffleEnabled);
}

function updatePlayButton() {
  const isPlaying = !audioPlayer.paused;

  playButton.textContent = isPlaying ? '❚❚' : '▶';
  playButton.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
  heroPlayButton.textContent = isPlaying ? 'Pause' : 'Play';
}

function updateProgress() {
  const duration = canonicalPlayerDuration();
  const currentTime = Number.isFinite(audioPlayer.currentTime) ? audioPlayer.currentTime : 0;
  const progressMax = duration > 0 ? duration : currentTime;

  progressInput.max = String(Math.floor(progressMax));
  progressInput.value = String(Math.min(Math.floor(currentTime), Math.floor(progressMax)));
  currentTimeLabel.textContent = formatTime(currentTime);
  durationTimeLabel.textContent = formatTime(duration);
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
  const targetPlaylist = playlists.find((playlist) => playlist.id === playlistId);
  const targetTrackIds = targetPlaylist && Array.isArray(targetPlaylist.trackIds)
    ? targetPlaylist.trackIds
    : [];

  if (!targetPlaylist) {
    statusMessage.textContent = 'Playlist not found';
    return;
  }

  if (targetTrackIds.includes(track.id)) {
    statusMessage.textContent = `Already in playlist: ${targetPlaylist.name}`;
    renderLibrary();
    return;
  }

  playlists = playlists.map((playlist) => {
    const trackIds = Array.isArray(playlist.trackIds) ? playlist.trackIds : [];

    if (playlist.id !== playlistId) {
      return playlist;
    }

    return {
      ...playlist,
      trackIds: [...trackIds, track.id]
    };
  });
  savePlaylists();
  renderLibrary();
  statusMessage.textContent = `Added to playlist: ${targetPlaylist.name}`;
}

function removeTrackFromPlaylist(playlistId, trackId) {
  playlists = playlists.map((playlist) => {
    const trackIds = Array.isArray(playlist.trackIds) ? playlist.trackIds : [];

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
}

async function recordTrackPlay(trackId) {
  try {
    await fetch(`/tracks/${trackId}/play`, {
      method: 'POST'
    });
    await loadRecentlyPlayed();
  } catch (err) {
    recentlyStatus.textContent = err.message;
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

function setCurrentQueueIndex(index, options = {}) {
  const queueItems = queuedTracks();

  queueActiveIndex = index;
  activeTrackId = queueItems[index] ? queueItems[index].id : null;
  currentTrackIndex = tracks.findIndex((track) => track.id === activeTrackId);
  if (activeTrackId && !options.skipHistory) {
    pushQueueHistory(activeTrackId, 'queue');
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
  const queueItems = queuedTracks();
  const track = queueItems[index];

  if (!track) {
    return;
  }

  setCurrentQueueIndex(index, options);
  loadTrackIntoPlayer(track);
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
    const queueIndex = historyEntry.source === 'queue'
      ? queueTrackIds.findIndex((trackId) => trackId === historyEntry.trackId)
      : -1;
    const contextIndex = contextTracks().findIndex((track) => track.id === historyEntry.trackId);

    if (queueIndex >= 0) {
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

  if (currentTrackIndex > 0) {
    playTrackAt(currentTrackIndex - 1);
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

function removeCurrentQueueItemAfterPlayback() {
  if (queueActiveIndex < 0 || queueActiveIndex >= queueTrackIds.length) {
    return;
  }

  queueTrackIds.splice(queueActiveIndex, 1);
  queueActiveIndex = -1;
  saveQueue();
}

function playNextTrack(options = {}) {
  const queueItems = queuedTracks();

  if (queueItems.length > 0) {
    if (queueActiveIndex < 0) {
      playQueueAt(0);
      return;
    }

    const nextQueueIndex = nextIndexForList(
      queueItems.length,
      queueActiveIndex,
      queueItems.map((track) => track.id)
    );

    if (nextQueueIndex >= 0) {
      if (options.consumeQueue && repeatMode !== 'one') {
        const nextTrackId = queueItems[nextQueueIndex] ? queueItems[nextQueueIndex].id : null;
        removeCurrentQueueItemAfterPlayback();
        const adjustedIndex = nextTrackId === null
          ? -1
          : queueTrackIds.findIndex((trackId) => trackId === nextTrackId);
        if (adjustedIndex >= 0) {
          playQueueAt(adjustedIndex);
          return;
        }
      }
      playQueueAt(nextQueueIndex);
      return;
    }

    if (options.consumeQueue) {
      removeCurrentQueueItemAfterPlayback();
    }
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
  document.querySelectorAll('.track-actions.open').forEach((menu) => {
    menu.classList.remove('open');
  });
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

function renderActionMenu(track) {
  const wrapper = document.createElement('span');
  const trigger = document.createElement('button');
  const menu = document.createElement('span');
  const addToQueueButton = document.createElement('button');
  const playNextButton = document.createElement('button');
  const addToPlaylist = document.createElement('button');
  const favorite = document.createElement('button');
  const ratingLabel = document.createElement('span');
  const viewAlbum = document.createElement('button');
  const viewArtist = document.createElement('button');

  wrapper.className = 'track-actions';
  trigger.type = 'button';
  trigger.className = 'action-trigger';
  trigger.textContent = '...';
  trigger.setAttribute('aria-label', `Track actions for ${track.title}`);

  menu.className = 'action-menu';

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
    wrapper.classList.toggle('open', !isOpen);
  });

  menu.addEventListener('click', (event) => {
    event.stopPropagation();
  });

  menu.append(
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
  const button = document.createElement('div');
  const details = document.createElement('span');
  const title = document.createElement('span');
  const artist = document.createElement('span');
  const album = document.createElement('span');
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
  duration.className = 'duration';

  title.textContent = track.title;
  artist.textContent = formatArtist(track);
  album.textContent = formatAlbum(track);
  duration.textContent = formatDuration(track.duration);

  details.append(title, artist, album, duration);
  button.append(
    renderCover(track, 'thumbnail'),
    details,
    renderFavoriteButton(track),
    renderActionMenu(track)
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
  duration.textContent = formatDuration(track.duration);

  details.append(title, artist, album);
  row.append(
    renderCover(track, 'detail-cover'),
    details,
    duration,
    renderFavoriteButton(track),
    renderActionMenu(track)
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
  const copy = document.createElement('span');
  const title = document.createElement('span');
  const artist = document.createElement('span');
  const icon = document.createElement('span');
  const removeButton = document.createElement('button');
  const isActive = queueActiveIndex === index && track.id === activeTrackId;

  item.className = 'queue-item';
  item.setAttribute('role', 'button');
  item.tabIndex = 0;
  item.classList.toggle('active', isActive);
  item.dataset.trackId = String(track.id);
  item.setAttribute('aria-label', `Play ${track.title}`);

  copy.className = 'queue-copy';
  title.className = 'queue-name';
  artist.className = 'queue-artist';
  icon.className = 'queue-icon';
  removeButton.type = 'button';
  removeButton.className = 'queue-remove-button';
  removeButton.textContent = '×';
  removeButton.setAttribute('aria-label', `Remove ${track.title} from queue`);

  title.textContent = track.title;
  artist.textContent = formatArtist(track);
  icon.textContent = isActive ? '▶' : '';

  removeButton.addEventListener('click', (event) => {
    event.stopPropagation();
    removeFromQueue(index);
  });

  copy.append(title, artist);
  item.append(renderCover(track, 'queue-cover'), copy, icon, removeButton);
  item.addEventListener('click', () => playQueueAt(index));
  item.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      playQueueAt(index);
    }
  });

  return item;
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
  const items = visibleItems('songs', tracks);
  const contextType = searchInput.value.trim() ? 'search' : 'songs';
  const contextId = searchInput.value.trim() || null;
  trackList.replaceChildren(...items.map((track) => renderTrack(track, {
    onClick: () => playTrackFromContext(track, contextType, contextId, tracks)
  })));
  updateViewMoreButton('songs', tracks.length);
}

function renderAlbums() {
  const albums = groupByTrackField('album', 'Unknown album');

  if (selectedAlbumName) {
    renderAlbumDetail(selectedAlbumName);
    updateViewMoreButton('albums', 0);
    return;
  }

  albumsList.className = 'group-list';
  albumsList.replaceChildren(
    ...visibleItems('albums', albums).map((album) => renderGroupCard(album, 'album'))
  );
  updateViewMoreButton('albums', albums.length);
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
  backButton.className = 'view-more-button detail-back-button album-back-button';
  backButton.textContent = 'All albums';
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
    updateViewMoreButton('artists', 0);
    return;
  }

  artistsList.className = 'group-list';
  artistsList.replaceChildren(
    ...visibleItems('artists', artists).map((artist) => renderGroupCard(artist, 'artist'))
  );
  updateViewMoreButton('artists', artists.length);
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
  backButton.className = 'view-more-button detail-back-button artist-back-button';
  backButton.textContent = 'All artists';
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
  favoritesList.replaceChildren(
    ...visibleItems('favorites', favoriteTracks).map((track) => renderTrack(track, {
      onClick: () => playTrackFromContext(track, 'favorites', null, favoriteTracks)
    }))
  );
  updateViewMoreButton('favorites', favoriteTracks.length);
}

function renderRecentlyAdded() {
  const items = recentAddedTracks();
  recentlyAddedList.replaceChildren(
    ...visibleItems('recentAdded', items).map((track) => renderTrack(track, {
      onClick: () => playTrackFromContext(track, 'recentAdded', null, items)
    }))
  );
  updateViewMoreButton('recentAdded', items.length);
}

function renderRecentlyPlayed() {
  recentlyList.replaceChildren(
    ...visibleItems('recent', recentTracks).map((track) => renderTrack(track, {
      onClick: () => playTrackFromContext(track, 'recent', null, recentTracks)
    }))
  );
  updateViewMoreButton('recent', recentTracks.length);
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
  input.placeholder = 'New playlist name';
  button.className = 'view-more-button playlist-create-button';
  button.type = 'submit';
  button.textContent = 'Create playlist';
  form.append(input, button);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    createPlaylist(input.value);
    input.value = '';
  });

  list.className = 'playlist-list';

  if (playlists.length === 0) {
    const empty = document.createElement('div');

    empty.className = 'playlist-placeholder';
    empty.textContent = 'No playlists yet';
    list.append(empty);
  } else {
    list.append(...playlists.map((playlist) => renderPlaylistCard(playlist)));
  }

  playlistsList.className = 'playlist-view';
  playlistsList.replaceChildren(form, list);
}

function renderPlaylistCard(playlist) {
  const button = document.createElement('button');
  const title = document.createElement('span');
  const meta = document.createElement('span');
  const coverTrack = playlistTracks(playlist)[0];

  button.type = 'button';
  button.className = 'playlist-card';
  title.className = 'group-title';
  meta.className = 'group-meta';
  title.textContent = playlist.name;
  const trackCount = Array.isArray(playlist.trackIds) ? playlist.trackIds.length : 0;
  meta.textContent = `${trackCount} ${trackCount === 1 ? 'song' : 'songs'}`;
  button.append(
    coverTrack ? renderCover(coverTrack, 'group-cover') : renderPlaylistPlaceholderCover(),
    title,
    meta
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
  backButton.className = 'view-more-button detail-back-button';
  backButton.textContent = 'All playlists';
  backButton.addEventListener('click', () => {
    selectedPlaylistId = null;
    savePlayerState();
    renderPlaylists();
  });

  title.className = 'detail-title';
  title.textContent = playlist.name;
  meta.className = 'detail-meta';
  const trackCount = Array.isArray(playlist.trackIds) ? playlist.trackIds.length : 0;
  meta.textContent = `${trackCount} ${trackCount === 1 ? 'song' : 'songs'}`;
  copy.append(title, meta);

  list.className = 'detail-track-grid playlist-detail-list';

  if (playlistItems.length === 0) {
    const empty = document.createElement('div');

    empty.className = 'playlist-placeholder';
    empty.textContent = 'This playlist is empty';
    list.append(empty);
  } else {
    list.append(...playlistItems.map((track) => renderPlaylistTrackRow(track, playlist.id, playlistItems)));
  }

  header.append(backButton, copy);
  playlistsList.replaceChildren(header, list);
}

function renderPlaylistTrackRow(track, playlistId, playlistItems = []) {
  const row = renderDetailTrackRow(track, {
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
  const items = visibleItems('queue', queueItems);
  const toolbar = document.createElement('div');
  const clearButton = document.createElement('button');

  queueTitle.textContent = `Queue (${queueItems.length})`;
  toolbar.className = 'queue-toolbar';
  clearButton.type = 'button';
  clearButton.className = 'view-more-button clear-queue-button';
  clearButton.textContent = 'Clear queue';
  clearButton.disabled = queueItems.length === 0;
  clearButton.addEventListener('click', clearQueue);
  toolbar.append(clearButton);

  if (queueItems.length === 0) {
    const empty = document.createElement('div');

    empty.className = 'playlist-placeholder';
    empty.textContent = 'Queue is empty';
    queueList.replaceChildren(toolbar, empty);
  } else {
    queueList.replaceChildren(toolbar, ...items.map(renderQueueItem));
  }

  updateViewMoreButton('queue', queueItems.length);
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

async function loadRecentlyPlayed() {
  try {
    const response = await fetch('/recently-played');

    if (!response.ok) {
      throw new Error(`Failed to load recently played: ${response.status}`);
    }

    const data = await response.json();
    recentTracks = Array.isArray(data.tracks) ? data.tracks : [];
    renderRecentlyPlayed();
  } catch (err) {
    recentlyStatus.textContent = err.message;
  }
}

function renderAutoScanStatus(status) {
  if (!autoScanStatus || !autoScanInterval || !autoScanLast || !scanNowButton) {
    return;
  }

  if (!status || !status.enabled) {
    autoScanStatus.textContent = 'Auto Scan: Off';
    autoScanInterval.textContent = 'Every —';
    autoScanLast.textContent = 'Last scan: —';
    scanNowButton.disabled = true;
    return;
  }

  autoScanStatus.textContent = status.isRunning ? 'Auto Scan: Scanning...' : 'Auto Scan: On';
  autoScanInterval.textContent = `Every ${status.intervalMinutes || '—'} min`;
  autoScanLast.textContent = `Last scan: ${formatDateTime(status.lastScanAt)}`;
  scanNowButton.disabled = Boolean(status.isRunning);
}

async function loadAutoScanStatus() {
  if (!autoScanStatus || !autoScanInterval || !autoScanLast || !scanNowButton) {
    return;
  }

  try {
    const response = await fetch('/library/scan/status');

    if (!response.ok) {
      throw new Error(`Failed to load scan status: ${response.status}`);
    }

    const data = await response.json();
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
    autoScanStatus.textContent = 'Auto Scan: Unknown';
    autoScanInterval.textContent = 'Every —';
    autoScanLast.textContent = 'Last scan: —';
    scanNowButton.disabled = true;
  }
}

async function scanNow() {
  if (!scanNowButton) {
    return;
  }

  scanNowButton.disabled = true;
  autoScanStatus.textContent = 'Auto Scan: Scanning...';

  try {
    const response = await fetch('/library/scan/now', {
      method: 'POST'
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Failed to scan library: ${response.status}`);
    }

    const result = await response.json();
    statusMessage.textContent = `Scan completed: ${result.inserted} added, ${result.skipped} skipped`;
    await loadTracks(searchInput.value);
    await loadFavorites();
    await loadRecentlyPlayed();
  } catch (err) {
    statusMessage.textContent = err.message;
  } finally {
    await loadAutoScanStatus();
  }
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
heroPlayButton.addEventListener('click', togglePlayPause);
nextButton.addEventListener('click', playNextTrack);
shuffleButton.addEventListener('click', toggleShuffle);
heroShuffleButton.addEventListener('click', toggleShuffle);
repeatButton.addEventListener('click', cycleRepeatMode);

if (scanNowButton) {
  scanNowButton.addEventListener('click', scanNow);
}

favoritesFilterButton.addEventListener('click', () => {
  setActiveLibraryTab('favorites');
});

document.querySelectorAll('[data-library-tab]').forEach((button) => {
  button.addEventListener('click', () => {
    setActiveLibraryTab(button.dataset.libraryTab);
  });
});

document.querySelectorAll('[data-view-more]').forEach((button) => {
  button.addEventListener('click', () => {
    const key = button.dataset.viewMore;
    expandedSections[key] = !expandedSections[key];
    if (key === 'albums') {
      selectedAlbumName = null;
    } else if (key === 'artists') {
      selectedArtistName = null;
    }
    renderLibrary();
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
updatePlayButton();
updateProgress();
isRestoringPlayer = true;
setActiveLibraryTab(activeLibraryTab);
isRestoringPlayer = false;
loadTracks();
loadFavorites();
loadRecentlyPlayed();
loadAutoScanStatus();
setInterval(loadAutoScanStatus, 30000);
