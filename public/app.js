'use strict';

const trackList = document.getElementById('track-list');
const statusMessage = document.getElementById('status');
const audioPlayer = document.getElementById('audio-player');
const nowPlaying = document.getElementById('now-playing');

function formatDuration(duration) {
  if (!Number.isInteger(duration)) {
    return '';
  }

  const minutes = Math.floor(duration / 60);
  const seconds = String(duration % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function formatMeta(track) {
  const parts = [track.artist, track.album].filter(Boolean);
  return parts.length > 0 ? parts.join(' - ') : 'Unknown artist';
}

function setActiveTrack(button) {
  document.querySelectorAll('.track.active').forEach((item) => {
    item.classList.remove('active');
  });

  button.classList.add('active');
}

function playTrack(track, button) {
  setActiveTrack(button);
  nowPlaying.textContent = `${track.title} - ${formatMeta(track)}`;
  audioPlayer.src = `/stream/${track.id}`;
  audioPlayer.play().catch(() => {});
}

function renderTrack(track) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'track';

  const details = document.createElement('span');
  const title = document.createElement('span');
  const meta = document.createElement('span');
  const duration = document.createElement('span');

  title.className = 'title';
  title.textContent = track.title;

  meta.className = 'meta';
  meta.textContent = formatMeta(track);

  duration.className = 'duration';
  duration.textContent = formatDuration(track.duration);

  details.append(title, meta);
  button.append(details, duration);
  button.addEventListener('click', () => playTrack(track, button));

  return button;
}

async function loadTracks() {
  try {
    const response = await fetch('/tracks');

    if (!response.ok) {
      throw new Error(`Failed to load tracks: ${response.status}`);
    }

    const data = await response.json();
    const tracks = Array.isArray(data.tracks) ? data.tracks : [];

    trackList.replaceChildren(...tracks.map(renderTrack));
    statusMessage.textContent = tracks.length === 0
      ? 'No tracks found'
      : `${tracks.length} tracks`;
  } catch (err) {
    statusMessage.textContent = err.message;
  }
}

loadTracks();
