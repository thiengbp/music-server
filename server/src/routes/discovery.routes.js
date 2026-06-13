'use strict';

const express = require('express');
const discoveryController = require('../controllers/discovery.controller');

const router = express.Router();

router.get('/similar-artists/:name', discoveryController.getSimilarArtists);
router.get('/artist-radio/:name', discoveryController.getArtistRadio);
router.get('/album-radio', discoveryController.getAlbumRadio);
router.get('/track-radio/:trackId', discoveryController.getTrackRadio);
router.get('/auto-mix', discoveryController.getAutoMix);
router.get('/daily-mix', discoveryController.getDailyMix);
router.get('/because-you-played', discoveryController.getBecauseYouPlayed);

module.exports = router;
