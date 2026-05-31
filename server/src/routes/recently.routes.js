'use strict';

const express = require('express');
const recentlyController = require('../controllers/recently.controller');

const router = express.Router();

router.get('/', recentlyController.listRecentlyPlayed);

module.exports = router;
