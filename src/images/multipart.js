const multer = require('multer');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');
const { ImageError, MAX_IMAGE_BYTES } = require('./service');

async function removeTemporaryImage(file) {
  if (!file?.path) return;
  try { await fs.unlink(file.path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

function createImageUpload(uploadTempDirectory) {
  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, callback) => {
        fs.mkdir(uploadTempDirectory, { recursive: true }).then(() => callback(null, uploadTempDirectory), callback);
      },
      filename: (_req, _file, callback) => callback(null, `${randomUUID()}.incoming`),
    }),
    limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 0, parts: 2 },
  }).single('image');

  return (req, res, next) => {
    upload(req, res, (error) => {
      if (!error) return next();
      void removeTemporaryImage(req.file).then(() => {
        if (['ENOTDIR', 'EACCES', 'ENOSPC'].includes(error.code)) {
          return next(new ImageError(500, 'IMAGE_STORAGE_ERROR', '图片暂存失败，请稍后重试'));
        }
        if (error.code === 'LIMIT_FILE_SIZE') {
          return next(new ImageError(413, 'IMAGE_TOO_LARGE', '图片不能超过 10 MiB'));
        }
        next(new ImageError(400, 'IMAGE_REQUEST_INVALID', '请使用 multipart/form-data 上传单张图片，字段为 image'));
      }, next);
    });
  };
}

module.exports = { createImageUpload, removeTemporaryImage };
