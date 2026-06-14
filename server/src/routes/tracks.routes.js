'use strict';

const express = require('express');
const tracksController = require('../controllers/tracks.controller');

const router = express.Router();

router.get('/', tracksController.listTracks);
router.post('/', tracksController.createTrack);
router.post('/:id/favorite', tracksController.favoriteTrack);
router.delete('/:id/favorite', tracksController.unfavoriteTrack);
router.post('/:id/play', tracksController.recordTrackPlay);
router.get('/:id', tracksController.getTrackById);
router.patch('/:id/metadata', tracksController.updateTrackMetadata);

module.exports = router;
