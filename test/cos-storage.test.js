const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCosImageStorage } = require('../src/images/cos-storage');

const options = { bucket: 'greenkeeper-1385540619', region: 'ap-shanghai' };

test('deletes a stored COS image and propagates deletion failures', async () => {
  const calls = [];
  const key = '1842baf0-49b8-4d4c-b5cd-2a7be8ad48c8.webp';
  const storage = createCosImageStorage({ ...options, client: {
    deleteObject(params, callback) { calls.push(params); callback(null, {}); },
  } });
  await storage.delete(key);
  assert.deepEqual(calls, [{ Bucket: options.bucket, Region: options.region, Key: `uploads/${key}` }]);
  const failure = createCosImageStorage({ ...options, client: {
    deleteObject(_params, callback) { callback(new Error('COS delete failed')); },
  } });
  await assert.rejects(failure.delete(key), /COS delete failed/);
});

test('uploads bytes with their actual image type to the configured COS bucket', async () => {
  const calls = [];
  const client = { putObject(params, callback) { calls.push(params); callback(null, {}); } };
  const storage = createCosImageStorage({ ...options, client });
  for (const [extension, contentType] of [['jpg', 'image/jpeg'], ['png', 'image/png'], ['webp', 'image/webp']]) {
    const bytes = Buffer.from('validated image bytes');
    const saved = await storage.save(bytes, extension);
    assert.match(saved.key, /^[a-f0-9-]{36}\.(jpg|png|webp)$/);
    assert.equal(saved.url, `/uploads/${saved.key}`);
    const call = calls.at(-1);
    assert.equal(call.Bucket, options.bucket);
    assert.equal(call.Region, options.region);
    assert.equal(call.Key, `uploads/${saved.key}`);
    assert.equal(call.ContentType, contentType);
    assert.equal(call.Body, bytes);
    assert.equal(call.ACL, undefined);
  }
});

test('generates fresh HTTPS signed reads while preserving a stable app URL', async () => {
  const calls = [];
  const client = { getObjectUrl(params, callback) { calls.push(params); callback(null, { Url: `https://example.cos.test/file?signature=${calls.length}` }); } };
  const storage = createCosImageStorage({ ...options, client });
  const key = '1842baf0-49b8-4d4c-b5cd-2a7be8ad48c8.jpg';
  assert.notEqual(await storage.getReadUrl(key), await storage.getReadUrl(key));
  assert.deepEqual(calls[0], {
    Bucket: options.bucket, Region: options.region, Key: `uploads/${key}`,
    Method: 'GET', Sign: true, Expires: 300, Protocol: 'https:',
  });
});

test('refuses to sign arbitrary bucket keys or paths outside image uploads', async () => {
  const storage = createCosImageStorage({ ...options, client: { getObjectUrl() { assert.fail('must not sign'); } } });
  for (const key of ['../backup.sqlite', 'backup.sqlite', 'folder/image.jpg', '.env', 'not-a-uuid.jpg']) {
    assert.equal(await storage.getReadUrl(key), null);
  }
});

test('signs HEAD reads as HEAD rather than GET', async () => {
  let method;
  const storage = createCosImageStorage({ ...options, client: {
    getObjectUrl(params, callback) { method = params.Method; callback(null, { Url: 'https://example.cos.test/image' }); },
  } });
  await storage.getReadUrl('1842baf0-49b8-4d4c-b5cd-2a7be8ad48c8.jpg', 'HEAD');
  assert.equal(method, 'HEAD');
});

test('propagates COS upload/signing failures and rejects unsupported extensions', async () => {
  const error = new Error('COS unavailable');
  const storage = createCosImageStorage({ ...options, client: {
    putObject(_params, callback) { callback(error); },
    getObjectUrl(_params, callback) { callback(error); },
  } });
  await assert.rejects(storage.save(Buffer.from('image'), 'jpg'), error);
  await assert.rejects(storage.getReadUrl('1842baf0-49b8-4d4c-b5cd-2a7be8ad48c8.jpg'), error);
  await assert.rejects(storage.save(Buffer.from('image'), 'html'), /extension/i);
});
