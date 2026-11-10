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

  router.patch('/me/plants/:instanceId', requireAccess, (req, res) => {
    const value = req.body?.customName;
    if (typeof value !== 'string') {
      return res.status(400).json({ error: { code: 'INVALID_CUSTOM_NAME', message: 'Custom name must be a string' } });
    }
    const customName = value.trim();
    if ([...customName].length > 30) {
      return res.status(400).json({ error: { code: 'INVALID_CUSTOM_NAME', message: 'Custom name must be at most 30 characters' } });
    }
    const plant = repository.renameUserPlant(req.user.user_id, req.params.instanceId, customName || null);
    if (!plant) return res.status(404).json({ error: { code: 'PLANT_INSTANCE_NOT_FOUND', message: 'Plant instance not found' } });
    res.json({ plant });
  });

  router.delete('/me/plants/:instanceId', requireAccess, (req, res) => {
    const result = repository.removeUserPlant(req.user.user_id, req.params.instanceId);
    if (!result) return res.status(404).json({ error: { code: 'PLANT_INSTANCE_NOT_FOUND', message: 'Plant instance not found' } });
    res.json(result);
  });

  return router;
}

module.exports = { createUserPlantsRouter };
