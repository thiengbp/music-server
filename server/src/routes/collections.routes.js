'use strict';

const express = require('express');
const collectionsController = require('../controllers/collections.controller');

const router = express.Router();

router.get('/', collectionsController.listCollections);
router.get('/:id', collectionsController.getCollection);

module.exports = router;
