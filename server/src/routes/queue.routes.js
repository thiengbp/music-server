'use strict';

const express = require('express');
const queueController = require('../controllers/queue.controller');

const router = express.Router();

router.get('/', queueController.getQueue);
router.put('/', queueController.replaceQueue);
router.post('/items', queueController.addQueueItem);
router.delete('/items/:id', queueController.removeQueueItem);
router.delete('/', queueController.clearQueue);

module.exports = router;
