'use strict';

const trackList = document.getElementById('track-list');
const statusMessage = document.getElementById('status');
const searchInput = document.getElementById('search-input');
const audioPlayer = document.getElementById('audio-player');
const previousButton = document.getElementById('previous-button');
const nextButton = document.getElementById('next-button');
const nowTitle = document.getElementById('now-title');
const nowArtist = document.getElementById('now-artist');
const coverArt = document.getElementById('cover-art');
const coverPlaceholder = document.getElementById('cover-placeholder');

let searchTimer = null;
let activeTrackId = null;
let tracks = [];
let currentTrackIndex = -1;

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
  nextButton.disabled = currentTrackIndex < 0 || currentTrackIndex >= tracks.length - 1;
}

function syncActiveTrack() {
  document.querySelectorAll('.track').forEach((item) => {
    const trackId = Number(item.dataset.trackId);
    item.classList.toggle('active', trackId === activeTrackId);
  });
}

function setCurrentTrackIndex(index) {
  currentTrackIndex = index;
  activeTrackId = tracks[index] ? tracks[index].id : null;
  syncActiveTrack();
  updateQueueControls();
}

function setActiveTrack(button, track, index) {
  activeTrackId = track.id;
  currentTrackIndex = index;
  syncActiveTrack();
  button.classList.add('active');
  updateQueueControls();
}

function setCoverImage(image, placeholder, trackId) {
  placeholder.hidden = false;
  image.hidden = true;
  image.src = `/tracks/${trackId}/cover`;
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
}

function playTrack(track, button, index) {
  setActiveTrack(button, track, index);
  nowTitle.textContent = track.title;
  nowArtist.textContent = formatArtist(track);
  setCoverImage(coverArt, coverPlaceholder, track.id);
  audioPlayer.src = `/stream/${track.id}`;
  audioPlayer.play().catch(() => {});
}

function playPreviousTrack() {
  if (currentTrackIndex > 0) {
    playTrackAt(currentTrackIndex - 1);
  }
}

function playNextTrack() {
  if (currentTrackIndex >= 0 && currentTrackIndex < tracks.length - 1) {
    playTrackAt(currentTrackIndex + 1);
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

function renderTrack(track, index) {
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
  button.append(renderCoverThumbnail(track), details);
  button.addEventListener('click', () => playTrack(track, button, index));

  return button;
}

function tracksUrl(searchValue) {
  const keyword = searchValue.trim();

  if (!keyword) {
    return '/tracks';
  }

  return `/tracks?search=${encodeURIComponent(keyword)}`;
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
    syncActiveTrack();
    updateQueueControls();
    statusMessage.textContent = tracks.length === 0
      ? 'No tracks found'
      : `${tracks.length} tracks`;
  } catch (err) {
    statusMessage.textContent = err.message;
  }
}

previousButton.addEventListener('click', playPreviousTrack);
nextButton.addEventListener('click', playNextTrack);

audioPlayer.addEventListener('ended', () => {
  if (currentTrackIndex >= 0 && currentTrackIndex < tracks.length - 1) {
    playTrackAt(currentTrackIndex + 1);
    return;
  }

  updateQueueControls();
});

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);

  searchTimer = setTimeout(() => {
    loadTracks(searchInput.value);
  }, 300);
});

loadTracks();
