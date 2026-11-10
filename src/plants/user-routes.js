const { Router } = require('express');
const { createPlantRepository } = require('./repository');

function createUserPlantsRouter({ db, requireAccess }) {
  const router = Router();
  const repository = createPlantRepository(db);

  router.get('/me/plants', requireAccess, (req, res) => {
    res.json({ items: repository.userPlants(req.user.user_id) });
  });

  router.put('/me/plants/:plantId', requireAccess, (req, res) => {
    const plant = repository.addUserPlant(req.user.user_id, req.params.plantId);
    if (!plant) return res.status(404).json({ error: { code: 'PLANT_NOT_FOUND', message: 'Plant not found' } });
    res.json({ plant });
  });

  router.delete('/me/plants/:plantId', requireAccess, (req, res) => {
    const result = repository.removeUserPlant(req.user.user_id, req.params.plantId);
    if (!result) return res.status(404).json({ error: { code: 'PLANT_NOT_FOUND', message: 'Plant not found' } });
    res.json(result);
  });

  return router;
}

module.exports = { createUserPlantsRouter };
