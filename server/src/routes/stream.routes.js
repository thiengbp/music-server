'use strict';

const express = require('express');
const streamController = require('../controllers/stream.controller');

const router = express.Router();

router.head('/:id', streamController.streamTrackHead);
router.get('/:id', streamController.streamTrack);

module.exports = router;
