const { Router } = require('express');
const { createPlantRepository } = require('./repository');

function createPlantRouter({ db }) {
  const router = Router();
  const repository = createPlantRepository(db);

  router.get('/categories', (req, res) => {
    res.json({ categories: repository.categories() });
  });

  router.get('/', (req, res) => {
    const category = req.query.category;
    if (category !== undefined && (typeof category !== 'string' || !category || !repository.hasCategory(category))) {
      return res.status(400).json({ error: { code: 'INVALID_CATEGORY', message: 'Unknown plant category' } });
    }
    res.json({ items: repository.list(category) });
  });

  router.get('/:id', (req, res) => {
    const plant = repository.detail(req.params.id);
    if (!plant) return res.status(404).json({ error: { code: 'PLANT_NOT_FOUND', message: 'Plant not found' } });
    res.json({ plant });
  });

  return router;
}

module.exports = { createPlantRouter };
