'use strict';

const express = require('express');
const libraryController = require('../controllers/library.controller');

const router = express.Router();

router.get('/scan/status', libraryController.getAutoScanStatus);
router.post('/scan/now', libraryController.scanConfiguredLibrary);
router.post('/scan', libraryController.scanLibrary);

module.exports = router;
