'use strict';

const trackList = document.getElementById('track-list');
const statusMessage = document.getElementById('status');
const searchInput = document.getElementById('search-input');
const favoritesFilterButton = document.getElementById('favorites-filter');
const recentlyList = document.getElementById('recently-list');
const recentlyStatus = document.getElementById('recently-status');
const queueTitle = document.getElementById('queue-title');
const queueList = document.getElementById('queue-list');
const audioPlayer = document.getElementById('audio-player');
const shuffleButton = document.getElementById('shuffle-button');
const previousButton = document.getElementById('previous-button');
const nextButton = document.getElementById('next-button');
const repeatButton = document.getElementById('repeat-button');
const nowTitle = document.getElementById('now-title');
const nowArtist = document.getElementById('now-artist');
const coverArt = document.getElementById('cover-art');
const coverPlaceholder = document.getElementById('cover-placeholder');

let searchTimer = null;
let activeTrackId = null;
let tracks = [];
let currentTrackIndex = -1;
let isShuffleEnabled = false;
let repeatMode = 'off';
let favoritesOnly = false;

function formatDuration(duration) {
  if (!Number.isInteger(duration)) {
    return 'Unknown duration';
  }

  const minutes = Math.floor(duration / 60);
  const seconds = String(duration % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function formatArtist(track) {
  return track.artist || 'Unknown artist';
}

function formatAlbum(track) {
  return track.album || 'Unknown album';
}

function updateQueueControls() {
  previousButton.disabled = currentTrackIndex <= 0;
  nextButton.disabled = currentTrackIndex < 0 ||
    (tracks.length <= 1 && repeatMode !== 'one') ||
    (!isShuffleEnabled && repeatMode === 'off' && currentTrackIndex >= tracks.length - 1);
  shuffleButton.classList.toggle('active', isShuffleEnabled);
  shuffleButton.setAttribute('aria-pressed', String(isShuffleEnabled));
  shuffleButton.setAttribute(
    'aria-label',
    isShuffleEnabled ? 'Shuffle on' : 'Shuffle off'
  );
  repeatButton.classList.toggle('active', repeatMode !== 'off');
  repeatButton.setAttribute('aria-pressed', String(repeatMode !== 'off'));
  repeatButton.setAttribute('aria-label', `Repeat ${repeatMode}`);
  repeatButton.textContent = repeatMode === 'one' ? '↺1' : '↻';
}

function syncActiveTrack() {
  document.querySelectorAll('.track').forEach((item) => {
    const trackId = Number(item.dataset.trackId);
    item.classList.toggle('active', trackId === activeTrackId);
  });

  document.querySelectorAll('.queue-item').forEach((item) => {
    const trackId = Number(item.dataset.trackId);
    item.classList.toggle('active', trackId === activeTrackId);
  });
}

function renderQueueItem(track, index) {
  const item = document.createElement('button');
  const icon = document.createElement('span');
  const title = document.createElement('span');
  const isActive = track.id === activeTrackId;

  item.type = 'button';
  item.className = 'queue-item';
  item.classList.toggle('active', isActive);
  item.dataset.trackId = String(track.id);
  item.setAttribute('aria-label', `Play ${track.title}`);

  icon.className = 'queue-icon';
  icon.textContent = isActive ? '▶' : '';

  title.className = 'queue-name';
  title.textContent = track.title;

  item.append(icon, title);
  item.addEventListener('click', () => playTrackAt(index));

  return item;
}

function renderQueue() {
  queueTitle.textContent = `Queue (${tracks.length})`;
  queueList.replaceChildren(...tracks.map(renderQueueItem));
}

function setCurrentTrackIndex(index) {
  currentTrackIndex = index;
  activeTrackId = tracks[index] ? tracks[index].id : null;
  syncActiveTrack();
  renderQueue();
  updateQueueControls();
}

function setActiveTrack(button, track, index) {
  activeTrackId = track.id;
  currentTrackIndex = index;
  syncActiveTrack();
  renderQueue();
  button.classList.add('active');
  updateQueueControls();
}

function setCoverImage(image, placeholder, trackId) {
  placeholder.hidden = false;
  image.hidden = true;
  image.src = `/tracks/${trackId}/cover`;
}

function updateTrackInMemory(updatedTrack) {
  tracks = tracks.map((track) => (
    track.id === updatedTrack.id ? updatedTrack : track
  ));
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

function playTrackAt(index) {
  const track = tracks[index];

  if (!track) {
    return;
  }

  setCurrentTrackIndex(index);
  nowTitle.textContent = track.title;
  nowArtist.textContent = formatArtist(track);
  setCoverImage(coverArt, coverPlaceholder, track.id);
  audioPlayer.src = `/stream/${track.id}`;
  audioPlayer.play().catch(() => {});
  recordTrackPlay(track.id);
}

function playTrack(track, button, index) {
  setActiveTrack(button, track, index);
  nowTitle.textContent = track.title;
  nowArtist.textContent = formatArtist(track);
  setCoverImage(coverArt, coverPlaceholder, track.id);
  audioPlayer.src = `/stream/${track.id}`;
  audioPlayer.play().catch(() => {});
  recordTrackPlay(track.id);
}

function playPreviousTrack() {
  if (currentTrackIndex > 0) {
    playTrackAt(currentTrackIndex - 1);
  }
}

function randomNextIndex() {
  if (tracks.length <= 1) {
    return currentTrackIndex;
  }

  let nextIndex = currentTrackIndex;

  while (nextIndex === currentTrackIndex) {
    nextIndex = Math.floor(Math.random() * tracks.length);
  }

  return nextIndex;
}

function nextTrackIndex() {
  if (currentTrackIndex < 0) {
    return -1;
  }

  if (repeatMode === 'one') {
    return currentTrackIndex;
  }

  if (isShuffleEnabled) {
    return randomNextIndex();
  }

  if (currentTrackIndex < tracks.length - 1) {
    return currentTrackIndex + 1;
  }

  if (repeatMode === 'all' && tracks.length > 0) {
    return 0;
  }

  return -1;
}

function playNextTrack() {
  const nextIndex = nextTrackIndex();

  if (nextIndex >= 0) {
    playTrackAt(nextIndex);
  }
}

function toggleShuffle() {
  isShuffleEnabled = !isShuffleEnabled;
  updateQueueControls();
  renderQueue();
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

coverArt.addEventListener('load', () => {
  coverPlaceholder.hidden = true;
  coverArt.hidden = false;
});

coverArt.addEventListener('error', () => {
  coverArt.hidden = true;
  coverPlaceholder.hidden = false;
});

function renderCoverThumbnail(track) {
  const wrapper = document.createElement('span');
  const image = document.createElement('img');
  const placeholder = document.createElement('span');

  wrapper.className = 'thumbnail';
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

function renderTrack(track, index, options = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'track';
  button.dataset.trackId = String(track.id);

  if (track.id === activeTrackId) {
    button.classList.add('active');
  }

  const details = document.createElement('span');
  const title = document.createElement('span');
  const artist = document.createElement('span');
  const album = document.createElement('span');
  const duration = document.createElement('span');

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
  button.append(renderCoverThumbnail(track), details, renderFavoriteButton(track));
  button.addEventListener('click', () => {
    if (options.onClick) {
      options.onClick(track, button, index);
      return;
    }

    playTrack(track, button, index);
  });

  return button;
}

function renderRecentTrack(track) {
  const index = tracks.findIndex((currentTrack) => currentTrack.id === track.id);

  return renderTrack(track, index, {
    onClick: () => {
      const index = tracks.findIndex((currentTrack) => currentTrack.id === track.id);

      if (index >= 0) {
        playTrackAt(index);
        return;
      }

      activeTrackId = track.id;
      currentTrackIndex = -1;
      syncActiveTrack();
      updateQueueControls();
      nowTitle.textContent = track.title;
      nowArtist.textContent = formatArtist(track);
      setCoverImage(coverArt, coverPlaceholder, track.id);
      audioPlayer.src = `/stream/${track.id}`;
      audioPlayer.play().catch(() => {});
      recordTrackPlay(track.id);
    }
  });
}

function tracksUrl(searchValue) {
  const keyword = searchValue.trim();
  const params = new URLSearchParams();

  if (keyword) {
    params.set('search', keyword);
  }

  if (favoritesOnly) {
    params.set('favorite', 'true');
  }

  const queryString = params.toString();
  return queryString ? `/tracks?${queryString}` : '/tracks';
}

async function loadTracks(searchValue = '') {
  statusMessage.textContent = 'Loading tracks...';

  try {
    const response = await fetch(tracksUrl(searchValue));

    if (!response.ok) {
      throw new Error(`Failed to load tracks: ${response.status}`);
    }

    const data = await response.json();
    tracks = Array.isArray(data.tracks) ? data.tracks : [];

    trackList.replaceChildren(...tracks.map(renderTrack));
    currentTrackIndex = tracks.findIndex((track) => track.id === activeTrackId);
    renderQueue();
    syncActiveTrack();
    updateQueueControls();
    statusMessage.textContent = tracks.length === 0
      ? 'No tracks found'
      : `${tracks.length} tracks`;
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
    const recentTracks = Array.isArray(data.tracks) ? data.tracks : [];

    recentlyList.replaceChildren(...recentTracks.map(renderRecentTrack));
    recentlyStatus.textContent = recentTracks.length === 0
      ? 'No recently played tracks'
      : `${recentTracks.length} recently played`;
  } catch (err) {
    recentlyStatus.textContent = err.message;
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
  await loadRecentlyPlayed();
}

previousButton.addEventListener('click', playPreviousTrack);
nextButton.addEventListener('click', playNextTrack);
shuffleButton.addEventListener('click', toggleShuffle);
repeatButton.addEventListener('click', cycleRepeatMode);
favoritesFilterButton.addEventListener('click', () => {
  favoritesOnly = !favoritesOnly;
  favoritesFilterButton.classList.toggle('active', favoritesOnly);
  favoritesFilterButton.setAttribute('aria-pressed', String(favoritesOnly));
  loadTracks(searchInput.value);
});

audioPlayer.addEventListener('ended', () => {
  const nextIndex = nextTrackIndex();

  if (nextIndex >= 0 && nextIndex !== currentTrackIndex) {
    playTrackAt(nextIndex);
    return;
  }

  if (nextIndex === currentTrackIndex && repeatMode === 'one') {
    audioPlayer.currentTime = 0;
    audioPlayer.play().catch(() => {});
    return;
  }

  updateQueueControls();
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

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);

  searchTimer = setTimeout(() => {
    loadTracks(searchInput.value);
  }, 300);
});

loadTracks();
loadRecentlyPlayed();
