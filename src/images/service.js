const sharp = require('sharp');

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const formats = {
  jpeg: { mimeType: 'image/jpeg', extension: 'jpg' },
  png: { mimeType: 'image/png', extension: 'png' },
  webp: { mimeType: 'image/webp', extension: 'webp' },
};

class ImageError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function validateImage(file, allowedTypes = Object.values(formats).map((format) => format.mimeType)) {
  if (!file) throw new ImageError(400, 'IMAGE_REQUIRED', '请选择一张图片');
  if (file.size > MAX_IMAGE_BYTES) throw new ImageError(413, 'IMAGE_TOO_LARGE', '图片不能超过 10 MiB');
  if (!allowedTypes.includes(file.mimetype)) {
    throw new ImageError(415, 'IMAGE_TYPE_UNSUPPORTED', `仅支持 ${allowedTypes.includes('image/webp') ? 'JPEG、PNG 和 WebP' : 'JPEG、PNG'} 图片`);
  }
  let metadata;
  try {
    const decoder = sharp(file.buffer, { failOn: 'warning' });
    metadata = await decoder.metadata();
    // Metadata alone can accept a valid header followed by truncated image data.
    await decoder.stats();
  } catch {
    throw new ImageError(400, 'IMAGE_INVALID', '图片内容无效或已损坏');
  }
  const format = formats[metadata.format];
  if (!format || format.mimeType !== file.mimetype) {
    throw new ImageError(415, 'IMAGE_TYPE_UNSUPPORTED', '图片实际格式与声明类型不符');
  }
  return { ...format, width: metadata.width, height: metadata.height };
}

function createImageService(storage) {
  return {
    async upload(file) {
      const format = await validateImage(file);
      let saved;
      try {
        saved = await storage.save(file.buffer, format.extension);
      } catch {
        throw new ImageError(500, 'IMAGE_STORAGE_ERROR', '图片保存失败，请稍后重试');
      }
      return { ...saved, mimeType: format.mimeType, size: file.size, width: format.width, height: format.height };
    },
  };
}

module.exports = { createImageService, validateImage, ImageError, MAX_IMAGE_BYTES };
