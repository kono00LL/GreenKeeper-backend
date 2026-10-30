const COS = require('cos-nodejs-sdk-v5');
const { createImageStorage } = require('./storage');
const { createCosImageStorage } = require('./cos-storage');

function createConfiguredImageStorage({ env = process.env, directory }) {
  const provider = env.IMAGE_STORAGE?.trim() || 'local';
  if (provider === 'local') return createImageStorage(directory);
  if (provider !== 'cos') throw new Error('IMAGE_STORAGE must be local or cos');

  const required = (name) => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`Missing ${name} for COS image storage`);
    return value;
  };
  const bucket = required('COS_BUCKET');
  const region = required('COS_REGION');
  const SecretId = required('COS_SECRET_ID');
  const SecretKey = required('COS_SECRET_KEY');
  if (!/^[a-z0-9][a-z0-9-]*-\d+$/.test(bucket)) throw new Error('COS_BUCKET must include its APPID suffix');
  if (!/^[a-z]+-[a-z0-9-]+$/.test(region)) throw new Error('COS_REGION must be a region name such as ap-shanghai');

  const client = new COS({ SecretId, SecretKey, Protocol: 'https:', Timeout: 15000 });
  return createCosImageStorage({ client, bucket, region });
}

module.exports = { createConfiguredImageStorage };
