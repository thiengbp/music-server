'use strict';

const express = require('express');
const libraryController = require('../controllers/library.controller');

const router = express.Router();

router.post('/scan', libraryController.scanLibrary);

module.exports = router;
