const { Router } = require('express');
const fs = require('node:fs/promises');
const { createImageUpload, removeTemporaryImage } = require('../images/multipart');
const { ImageError } = require('../images/service');
const { IdentificationError } = require('./errors');
const { createIdentificationService } = require('./service');

function createIdentificationRouter({ requireAccess, uploadTempDirectory, client, plantRepository }) {
  const router = Router();
  const service = createIdentificationService(client, plantRepository);
  router.post('/plant-identifications', requireAccess, createImageUpload(uploadTempDirectory), async (req, res, next) => {
    const controller = new AbortController();
    const cancel = () => { if (!res.writableFinished) controller.abort(); };
    res.on('close', cancel);
    try {
      let result;
      try {
        const file = req.file ? { ...req.file, buffer: await fs.readFile(req.file.path) } : null;
        result = await service.identify(file, controller.signal);
      } finally {
        await removeTemporaryImage(req.file);
      }
      if (!controller.signal.aborted) res.json(result);
    } catch (error) {
      if (!controller.signal.aborted) next(error);
    } finally {
      res.off('close', cancel);
    }
  });
  router.use((error, req, res, next) => {
    if (!(error instanceof IdentificationError || error instanceof ImageError)) return next(error);
    res.status(error.status).json({ error: { code: error.code, message: error.message } });
  });
  return router;
}

module.exports = { createIdentificationRouter };
