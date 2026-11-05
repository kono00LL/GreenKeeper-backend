const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const sharp = require('sharp');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const { createApp } = require('../src/app');
const { initializeDatabase } = require('../src/database');

const MAX = 10 * 1024 * 1024;
let db, app, directory, uploadDirectory, access;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'greenkeeper-images-'));
  uploadDirectory = path.join(directory, 'uploads');
  db = new Database(':memory:');
  initializeDatabase(db);
  db.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').run('u', 'u@example.com', 'hash');
  access = jwt.sign({ sub: 'u', type: 'access', jti: 'u' }, 'test-secret', { expiresIn: '1h' });
  app = createApp({ db, jwtSecret: 'test-secret', uploadDirectory });
});
afterEach(async () => { db.close(); await fs.rm(directory, { recursive: true, force: true }); });

const image = (format = 'jpeg') => sharp({ create: { width: 24, height: 16, channels: 3, background: '#68dbbb' } }).toFormat(format).toBuffer();
const upload = () => request(app).post('/images').set('Authorization', `Bearer ${access}`);
async function files() { return fs.readdir(uploadDirectory).catch((error) => { if (error.code === 'ENOENT') return []; throw error; }); }
async function temporaryFiles() { return fs.readdir(path.join(directory, '.uploads-tmp')).catch((error) => { if (error.code === 'ENOENT') return []; throw error; }); }

test('accepts JPEG, PNG and WebP and serves the exact saved bytes under a generated filename', async () => {
  for (const [format, mime] of [['jpeg', 'image/jpeg'], ['png', 'image/png'], ['webp', 'image/webp']]) {
    const bytes = await image(format);
    const response = await upload().attach('image', bytes, { filename: '../../original.jpg', contentType: mime });
    assert.equal(response.status, 201);
    const saved = response.body.image;
    assert.match(saved.key, /^[a-f0-9-]+\.(jpg|png|webp)$/);
    assert.deepEqual(saved, { key: saved.key, url: `/uploads/${saved.key}`, mimeType: mime, size: bytes.length, width: 24, height: 16 });
    assert.deepEqual(await fs.readFile(path.join(uploadDirectory, saved.key)), bytes);
    assert.deepEqual(await temporaryFiles(), []);
    const download = await request(app).get(saved.url);
    assert.equal(download.status, 200);
    assert.equal(download.headers['content-type'], mime);
    assert.deepEqual(download.body, bytes);
  }
});

test('rejects unauthenticated and invalid credentials before writing any file', async () => {
  for (const token of [null, 'invalid', jwt.sign({ sub: 'u', type: 'refresh', jti: 'u' }, 'test-secret')]) {
    let req = request(app).post('/images');
    if (token) req = req.set('Authorization', `Bearer ${token}`);
    assert.equal((await req.attach('image', await image(), 'a.jpg')).status, 401);
  }
  assert.deepEqual(await files(), []);
  assert.deepEqual(await temporaryFiles(), []);
});

test('rejects missing files, wrong fields, multiple files and malformed multipart without leftovers', async () => {
  assert.equal((await upload().send({ image: 'not-a-file' })).status, 400);
  assert.equal((await upload().field('note', 'no file')).status, 400);
  assert.equal((await upload().attach('wrong', await image(), 'a.jpg')).status, 400);
  assert.equal((await upload().attach('image', await image(), 'a.jpg').attach('image', await image(), 'b.jpg')).status, 400);
  assert.equal((await upload().set('Content-Type', 'multipart/form-data; boundary=broken').send('--broken\r\n')).status, 400);
  assert.deepEqual(await files(), []);
  assert.deepEqual(await temporaryFiles(), []);
});

test('rejects unsupported, disguised, mismatched and truncated image content', async () => {
  const jpeg = await image();
  for (const [bytes, mime, status] of [
    [Buffer.from('<svg/>'), 'image/svg+xml', 415],
    [Buffer.from('not a jpeg'), 'image/jpeg', 400],
    [await image('png'), 'image/jpeg', 415],
    [jpeg.subarray(0, jpeg.length - 30), 'image/jpeg', 400],
  ]) {
    const response = await upload().attach('image', bytes, { filename: 'fake.jpg', contentType: mime });
    assert.equal(response.status, status);
    assert.ok(response.body.error.code);
  }
  assert.deepEqual(await files(), []);
  assert.deepEqual(await temporaryFiles(), []);
});

test('accepts exactly 10 MiB and rejects anything larger', async () => {
  const jpeg = await image();
  const bytes = Buffer.alloc(MAX); jpeg.copy(bytes);
  assert.equal((await upload().attach('image', bytes, 'a.jpg')).status, 201);
  const response = await upload().attach('image', Buffer.concat([bytes, Buffer.from([0])]), 'b.jpg');
  assert.equal(response.status, 413);
  assert.equal(response.body.error.code, 'IMAGE_TOO_LARGE');
  assert.equal((await files()).length, 1);
  assert.deepEqual(await temporaryFiles(), []);
});

test('reports storage failures using the shared error format', async () => {
  await fs.writeFile(uploadDirectory, 'not a directory');
  const response = await upload().attach('image', await image(), 'a.jpg');
  assert.equal(response.status, 500);
  assert.equal(response.body.error.code, 'IMAGE_STORAGE_ERROR');
});

test('logs an image storage cause in development without exposing it in the response', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousDebug = process.env.DEBUG;
  delete process.env.NODE_ENV;
  delete process.env.DEBUG;
  const error = console.error;
  const records = [];
  console.error = (...args) => records.push(args);
  try {
    app = createApp({ db, jwtSecret: 'test-secret', uploadDirectory,
      imageStorage: { async save() { throw new Error('api-key=private-api-key'); }, async getReadUrl() { return null; } },
    });
    const response = await upload().set('X-Request-ID', 'frontend-upload-123').attach('image', await image(), 'plant.jpg');
    assert.equal(response.status, 500);
    assert.equal(response.body.error.code, 'IMAGE_STORAGE_ERROR');
    assert.equal(response.headers['x-request-id'], 'frontend-upload-123');
    assert.doesNotMatch(response.text, /storage write failed/);
    assert.ok(records.some((args) => JSON.stringify(args).includes('[redacted]')));
    assert.doesNotMatch(JSON.stringify(records), /private-api-key/);
    assert.ok(records.some((args) => JSON.stringify(args).includes('frontend-upload-123')));
  } finally {
    console.error = error;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousDebug === undefined) delete process.env.DEBUG;
    else process.env.DEBUG = previousDebug;
  }
});

test('allows upload preflight for configured Web origins', async () => {
  const response = await request(app).options('/images').set('Origin', 'http://localhost:8081').set('Access-Control-Request-Method', 'POST').set('Access-Control-Request-Headers', 'authorization,content-type');
  assert.equal(response.status, 204);
  assert.match(response.headers['access-control-allow-methods'], /POST/);
  assert.match(response.headers['access-control-allow-headers'], /X-Request-ID/i);
  assert.match(response.headers['access-control-expose-headers'], /X-Request-ID/i);
});

test('uploads to COS and redirects private image reads to freshly signed HTTPS URLs', async () => {
  const calls = [];
  app = createApp({ db, jwtSecret: 'test-secret', uploadDirectory,
    imageStorage: {
      async save(buffer, extension) {
        const key = `1842baf0-49b8-4d4c-b5cd-2a7be8ad48c8.${extension}`;
        calls.push({ buffer, extension, key });
        return { key, url: `/uploads/${key}` };
      },
      async getReadUrl(key) { calls.push({ key }); return `https://greenkeeper-1385540619.cos.ap-shanghai.myqcloud.com/uploads/${key}?sign=temporary`; },
    } });

  const bytes = await image();
  const response = await upload().attach('image', bytes, { filename: 'plant.jpg', contentType: 'image/jpeg' });
  assert.equal(response.status, 201);
  assert.equal(response.body.image.url, '/uploads/1842baf0-49b8-4d4c-b5cd-2a7be8ad48c8.jpg');
  assert.deepEqual(calls[0], {
    buffer: bytes, extension: 'jpg', key: '1842baf0-49b8-4d4c-b5cd-2a7be8ad48c8.jpg',
  });

  const redirect = await request(app).get(response.body.image.url);
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers['cache-control'], 'no-store');
  assert.equal(redirect.headers.location, `https://greenkeeper-1385540619.cos.ap-shanghai.myqcloud.com/uploads/${response.body.image.key}?sign=temporary`);
  assert.equal(calls[1].key, response.body.image.key);
  assert.deepEqual(await files(), []);
  assert.deepEqual(await temporaryFiles(), []);
});

test('serves old local images before trying COS', async () => {
  const key = '1842baf0-49b8-4d4c-b5cd-2a7be8ad48c8.jpg';
  await fs.mkdir(uploadDirectory, { recursive: true });
  const bytes = await image();
  await fs.writeFile(path.join(uploadDirectory, key), bytes);
  let signs = 0;
  app = createApp({ db, jwtSecret: 'test-secret', uploadDirectory,
    imageStorage: {
      async save() { throw new Error('unused'); },
      async getReadUrl() { signs += 1; throw new Error('unused'); },
    } });

  const response = await request(app).get(`/uploads/${key}`);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, bytes);
  assert.equal(signs, 0);
});

test('COS failures clean temporary files, expose no secrets and never fall back to local saves', async () => {
  app = createApp({ db, jwtSecret: 'test-secret', uploadDirectory,
    imageStorage: {
      async save() { throw new Error('private COS credentials'); },
      async getReadUrl() { throw new Error('private COS credentials'); },
    } });
  const response = await upload().attach('image', await image(), 'plant.jpg');
  assert.equal(response.status, 500);
  assert.equal(response.body.error.code, 'IMAGE_STORAGE_ERROR');
  assert.doesNotMatch(response.text, /private COS credentials/);
  assert.deepEqual(await files(), []);
  assert.deepEqual(await temporaryFiles(), []);
  const read = await request(app).get('/uploads/1842baf0-49b8-4d4c-b5cd-2a7be8ad48c8.jpg');
  assert.equal(read.status, 500);
  assert.equal(read.body.error.code, 'IMAGE_STORAGE_ERROR');
  assert.doesNotMatch(read.text, /private COS credentials/);
});
