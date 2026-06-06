'use strict';

const collectionsService = require('../services/collections.service');

async function listCollections(req, res) {
  try {
    const collections = await collectionsService.listCollections();

    return res.json({ collections });
  } catch (err) {
    return res.status(500).json({
      error: 'Failed to load collections',
      message: err.message
    });
  }
}

async function getCollection(req, res) {
  try {
    const collection = await collectionsService.getCollection(req.params.id);

    if (!collection) {
      return res.status(404).json({ error: 'Collection not found' });
    }

    return res.json({ collection });
  } catch (err) {
    return res.status(500).json({
      error: 'Failed to load collection',
      message: err.message
    });
  }
}

module.exports = {
  listCollections,
  getCollection
};
