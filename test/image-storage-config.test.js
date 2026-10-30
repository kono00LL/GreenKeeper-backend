const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createConfiguredImageStorage } = require('../src/images/config');

const env = {
  IMAGE_STORAGE: 'cos', COS_BUCKET: 'greenkeeper-1385540619', COS_REGION: 'ap-shanghai',
  COS_SECRET_ID: 'test-id', COS_SECRET_KEY: 'test-secret',
};

test('defaults to local storage without COS credentials', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'greenkeeper-storage-config-'));
  try {
    const storage = createConfiguredImageStorage({ env: {}, directory });
    const bytes = Buffer.from('image');
    const saved = await storage.save(bytes, 'jpg');
    assert.deepEqual(await fs.readFile(path.join(directory, saved.key)), bytes);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('fails at startup for unknown providers, missing COS settings or malformed region/bucket', () => {
  assert.throws(() => createConfiguredImageStorage({ env: { IMAGE_STORAGE: 'typo' } }), /IMAGE_STORAGE/);
  for (const name of ['COS_BUCKET', 'COS_REGION', 'COS_SECRET_ID', 'COS_SECRET_KEY']) {
    assert.throws(() => createConfiguredImageStorage({ env: { ...env, [name]: ' ' } }), new RegExp(name));
  }
  assert.throws(() => createConfiguredImageStorage({ env: { ...env, COS_REGION: 'https://cos.ap-shanghai.myqcloud.com' } }), /COS_REGION/);
  assert.throws(() => createConfiguredImageStorage({ env: { ...env, COS_BUCKET: 'greenkeeper' } }), /COS_BUCKET/);
});

test('COS mode signs private-bucket reads with the real SDK without network access', async () => {
  const storage = createConfiguredImageStorage({ env });
  const key = '1842baf0-49b8-4d4c-b5cd-2a7be8ad48c8.jpg';
  const url = new URL(await storage.getReadUrl(key));
  assert.equal(url.protocol, 'https:');
  assert.equal(url.hostname, 'greenkeeper-1385540619.cos.ap-shanghai.myqcloud.com');
  assert.equal(url.pathname, `/uploads/${key}`);
  assert.ok(url.searchParams.get('q-signature'));
  const [start, end] = url.searchParams.get('q-sign-time').split(';').map(Number);
  assert.equal(end - start, 300);
});
