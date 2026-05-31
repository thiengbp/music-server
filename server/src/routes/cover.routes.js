'use strict';

const express = require('express');
const coverController = require('../controllers/cover.controller');

const router = express.Router();

router.get('/:id/cover', coverController.getTrackCover);

module.exports = router;
