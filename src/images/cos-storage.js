const { randomUUID } = require('node:crypto');

const imageTypes = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const imageKey = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(jpg|png|webp)$/;

function createCosImageStorage({ client, bucket, region }) {
  const objectParams = (key) => ({ Bucket: bucket, Region: region, Key: `uploads/${key}` });
  return {
    async save(buffer, extension) {
      if (!Object.hasOwn(imageTypes, extension)) throw new Error('Unsupported image extension');
      const key = `${randomUUID()}.${extension}`;
      await new Promise((resolve, reject) => {
        client.putObject({ ...objectParams(key), Body: buffer, ContentType: imageTypes[extension] },
          (error, result) => error ? reject(error) : resolve(result));
      });
      return { key, url: `/uploads/${key}` };
    },
    async getReadUrl(key, method = 'GET') {
      if (!imageKey.test(key) || !['GET', 'HEAD'].includes(method)) return null;
      return new Promise((resolve, reject) => {
        client.getObjectUrl({ ...objectParams(key), Method: method, Sign: true, Expires: 300, Protocol: 'https:' },
          (error, result) => error ? reject(error) : resolve(result.Url));
      });
    },
  };
}

module.exports = { createCosImageStorage };
