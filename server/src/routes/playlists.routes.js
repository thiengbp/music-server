'use strict';

const express = require('express');
const playlistsController = require('../controllers/playlists.controller');

const router = express.Router();

router.get('/', playlistsController.listPlaylists);
router.post('/', playlistsController.createPlaylist);
router.get('/:id', playlistsController.getPlaylist);
router.put('/:id', playlistsController.updatePlaylist);
router.delete('/:id', playlistsController.deletePlaylist);
router.post('/:id/tracks', playlistsController.addTrackToPlaylist);
router.delete('/:id/tracks/:trackId', playlistsController.removeTrackFromPlaylist);

module.exports = router;
