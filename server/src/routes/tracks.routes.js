'use strict';

const express = require('express');
const tracksController = require('../controllers/tracks.controller');

const router = express.Router();

router.get('/', tracksController.listTracks);
router.get('/:id', tracksController.getTrackById);

module.exports = router;
