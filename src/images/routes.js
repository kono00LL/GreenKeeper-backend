const { Router } = require('express');
const { createImageUpload } = require('./multipart');
const { createImageService, ImageError } = require('./service');
const { logRequestError } = require('../diagnostics');

function createImageRouter({ requireAccess, imageStorage, uploadTempDirectory }) {
  const router = Router();
  const service = createImageService(imageStorage);
  router.post('/images', requireAccess, createImageUpload(uploadTempDirectory), async (req, res, next) => {
    try {
      const file = req.file ? { ...req.file, buffer: await require('node:fs/promises').readFile(req.file.path) } : null;
      const image = await service.upload(file);
      await require('node:fs/promises').unlink(req.file.path);
      res.status(201).json({ image });
    } catch (error) {
      if (req.file?.path) await require('node:fs/promises').unlink(req.file.path).catch(() => {});
      if (error instanceof ImageError) return next(error);
      next(error);
    }
  });

  router.use((error, req, res, next) => {
    if (!(error instanceof ImageError)) return next(error);
    logRequestError(req, error, 'image-upload-error');
    res.status(error.status).json({ error: { code: error.code, message: error.message } });
  });
  return router;
}

function createImageReadRouter(imageStorage) {
  const router = Router();
  if (!imageStorage.getReadUrl) return router;
  router.get('/uploads/:key', async (req, res, next) => {
    try {
      const url = await imageStorage.getReadUrl(req.params.key, req.method);
      if (!url) return next();
      res.set('Cache-Control', 'no-store');
      res.redirect(302, url);
    } catch (error) {
      logRequestError(req, error, 'image-read-error');
      res.status(500).json({ error: { code: 'IMAGE_STORAGE_ERROR', message: '图片读取失败，请稍后重试' } });
    }
  });
  return router;
}

module.exports = { createImageRouter, createImageReadRouter };
