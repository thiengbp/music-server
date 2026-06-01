'use strict';

const express = require('express');
const artistsController = require('../controllers/artists.controller');

const router = express.Router();

router.get('/:name/info', artistsController.getArtistInfo);

module.exports = router;
