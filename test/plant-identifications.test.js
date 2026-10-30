const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');
const request = require('supertest');
const sharp = require('sharp');
const { createApp } = require('../src/app');
const { initializeDatabase } = require('../src/database');
const { createPlantnetClient } = require('../src/identifications/plantnet-client');

let db, directory, access, app, calls, logs, respond;
const species = (name, score, commonNames) => ({ score, species: { scientificName: name, commonNames } });
const image = (format = 'jpeg') => sharp({ create: { width: 24, height: 16, channels: 3, background: '#68dbbb' } }).toFormat(format).toBuffer();
const emptyResult = { bestMatch: null, candidates: [] };

function buildApp(options = {}) {
  return createApp({ db, jwtSecret: 'test-secret', uploadDirectory: path.join(directory, 'uploads'),
    identificationClient: createPlantnetClient({ apiKey: 'private-test-key', timeoutMs: 25000,
      fetchImpl: async (...args) => { calls.push(args); return respond(...args); },
      logger: { error: (entry) => logs.push(entry) }, ...options }),
  });
}
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'greenkeeper-identification-'));
  db = new Database(':memory:');
  initializeDatabase(db);
  db.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').run('u', 'u@example.com', 'hash');
  access = jwt.sign({ sub: 'u', type: 'access', jti: 'u' }, 'test-secret', { expiresIn: '1h' });
  calls = []; logs = [];
  respond = async () => Response.json({ results: [species('Ajuga genevensis L.', 0.91, ['筋骨草']), species('Ajuga orientalis L.', 0.04)] });
  app = buildApp();
});
afterEach(async () => { db.close(); await fs.rm(directory, { recursive: true, force: true }); });
const identify = () => request(app).post('/plant-identifications').set('Authorization', `Bearer ${access}`);
async function assertNoFiles() {
  for (const name of ['uploads', '.uploads-tmp']) {
    assert.deepEqual(await fs.readdir(path.join(directory, name)).catch((e) => { if (e.code === 'ENOENT') return []; throw e; }), []);
  }
}

test('identifies JPEG and PNG via binary multipart, normalizes names and leaves no stored files', async () => {
  for (const [format, type] of [['jpeg', 'image/jpeg'], ['png', 'image/png']]) {
    const bytes = await image(format);
    const response = await identify().attach('image', bytes, { filename: 'plant', contentType: type });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { bestMatch: 'Ajuga genevensis L.', candidates: [
      { scientificName: 'Ajuga genevensis L.', scientificNameWithoutAuthor: null, commonNames: ['筋骨草'], score: 0.91, localMatch: { status: 'unmatched', plant: null } },
      { scientificName: 'Ajuga orientalis L.', scientificNameWithoutAuthor: null, commonNames: [], score: 0.04, localMatch: { status: 'unmatched', plant: null } },
    ] });
    const [url, options] = calls.at(-1);
    assert.equal(url.origin + url.pathname, 'https://my-api.plantnet.org/v2/identify/all');
    assert.equal(url.searchParams.get('api-key'), 'private-test-key');
    assert.equal(url.searchParams.get('lang'), 'zh');
    assert.equal(url.searchParams.get('nb-results'), '3');
    assert.equal(url.searchParams.get('include-related-images'), 'false');
    assert.equal(url.searchParams.get('detailed'), 'false');
    assert.equal(options.method, 'POST');
    assert.equal(options.body.getAll('images').length, 1);
    assert.equal(options.body.has('organs'), false);
    assert.equal(options.body.get('images').type, type);
    assert.deepEqual(Buffer.from(await options.body.get('images').arrayBuffer()), bytes);
    assert.equal(options.headers?.['Content-Type'], undefined);
    assert.ok(options.signal instanceof AbortSignal);
    await assertNoFiles();
  }
});

test('enriches candidates by author-free name without promoting lower ranked local species', async () => {
  db.prepare(`INSERT INTO plants (id, name_zh, scientific_name, identity_status, publication_status)
    VALUES ('local-uuid', '铁线蕨', 'Adiantum capillus-veneris', 'verified', 'published')`).run();
  respond = async () => Response.json({ results: [
    species('Unlisted plant L.', 0.8, []),
    { score: 0.15, species: { scientificName: 'Adiantum capillus-veneris L.', scientificNameWithoutAuthor: '  ADIANTUM capillus-veneris ', commonNames: [] } },
  ] });
  const response = await identify().attach('image', await image(), 'a.jpg');
  assert.equal(response.status, 200);
  assert.equal(response.body.bestMatch, 'Unlisted plant L.');
  assert.deepEqual(response.body.candidates.map((c) => c.score), [0.8, 0.15]);
  assert.deepEqual(response.body.candidates[0].localMatch, { status: 'unmatched', plant: null });
  assert.deepEqual(response.body.candidates[1].localMatch, { status: 'matched', plant: { id: 'local-uuid', nameZh: '铁线蕨' } });
});

test('falls back conservatively to full name only and tolerates invalid optional author-free fields', async () => {
  db.prepare(`INSERT INTO plants (id, name_zh, scientific_name, identity_status, publication_status)
    VALUES ('local', '铁线蕨', 'Adiantum capillus-veneris', 'verified', 'published')`).run();
  for (const field of [undefined, null, '', ' ', 123]) {
    respond = async () => Response.json({ results: [{ score: 0.9, species: {
      scientificName: 'Adiantum capillus-veneris L.', scientificNameWithoutAuthor: field,
    } }] });
    const result = (await identify().attach('image', await image(), 'a.jpg')).body;
    assert.equal(result.candidates[0].scientificNameWithoutAuthor, null);
    assert.deepEqual(result.candidates[0].localMatch, { status: 'unmatched', plant: null });
  }
  respond = async () => Response.json({ results: [species('Adiantum capillus-veneris', 0.9)] });
  assert.equal((await identify().attach('image', await image(), 'a.jpg')).body.candidates[0].localMatch.status, 'matched');
});

test('returns not_ready and ambiguous without exposing unpublished plant IDs or internal review data', async () => {
  db.prepare(`INSERT INTO plants (id, name_zh, scientific_name, identity_status, publication_status)
    VALUES ('hidden', '资料整理中', 'Ajuga genevensis L.', 'pending', 'draft')`).run();
  let response = await identify().attach('image', await image(), 'a.jpg');
  assert.deepEqual(response.body.candidates[0].localMatch, { status: 'not_ready', plant: null });
  db.prepare(`INSERT INTO plants (id, name_zh, scientific_name, identity_status, publication_status)
    VALUES ('other', '重复资料', ' AJUGA GENEVENSIS L. ', 'verified', 'published')`).run();
  response = await identify().attach('image', await image(), 'a.jpg');
  assert.deepEqual(response.body.candidates[0].localMatch, { status: 'ambiguous', plant: null });
  assert.equal(JSON.stringify(response.body).includes('hidden'), false);
});

test('rejects missing, invalid and refresh credentials before accepting a file', async () => {
  for (const token of [null, 'invalid', jwt.sign({ sub: 'u', type: 'refresh', jti: 'u' }, 'test-secret')]) {
    let req = request(app).post('/plant-identifications');
    if (token) req = req.set('Authorization', `Bearer ${token}`);
    assert.equal((await req.attach('image', await image(), 'a.jpg')).status, 401);
  }
  assert.equal(calls.length, 0);
  await assertNoFiles();
});

test('rejects missing, multiple and wrong fields, malformed multipart, corrupt and unsupported images before upstream', async () => {
  const jpeg = await image();
  const cases = [
    [identify().send({}), 400],
    [identify().attach('wrong', jpeg, 'a.jpg'), 400],
    [identify().attach('image', jpeg, 'a.jpg').attach('image', jpeg, 'b.jpg'), 400],
    [identify().field('note', 'unexpected').attach('image', jpeg, 'a.jpg'), 400],
    [identify().set('Content-Type', 'multipart/form-data; boundary=broken').send('--broken\r\n'), 400],
    [identify().attach('image', Buffer.from('broken'), 'a.jpg'), 400],
    [identify().attach('image', jpeg.subarray(0, jpeg.length - 30), 'a.jpg'), 400],
    [identify().attach('image', await image('png'), { filename: 'a.jpg', contentType: 'image/jpeg' }), 415],
    [identify().attach('image', await image('webp'), { filename: 'a.webp', contentType: 'image/webp' }), 415],
  ];
  for (const [req, status] of cases) { assert.equal((await req).status, status); await assertNoFiles(); }
  assert.equal(calls.length, 0);
});

test('accepts exactly 10 MiB and rejects a larger file without calling upstream', async () => {
  const bytes = Buffer.alloc(10 * 1024 * 1024); (await image()).copy(bytes);
  assert.equal((await identify().attach('image', bytes, 'a.jpg')).status, 200);
  assert.equal((await identify().attach('image', Buffer.concat([bytes, Buffer.from([0])]), 'b.jpg')).status, 413);
  assert.equal(calls.length, 1);
  await assertNoFiles();
});

test('returns empty candidates for upstream 404 and empty results', async () => {
  for (const reply of [new Response(null, { status: 404 }), Response.json({ results: [] })]) {
    respond = async () => reply;
    assert.deepEqual((await identify().attach('image', await image(), 'a.jpg')).body, emptyResult);
    await assertNoFiles();
  }
});

test('preserves candidate order and returns at most three candidates', async () => {
  respond = async () => Response.json({ results: [0.8, 0.1, 0.05, 0.01].map((score, i) => species(`Plant ${i}`, score, [])) });
  const response = await identify().attach('image', await image(), 'a.jpg');
  assert.deepEqual(response.body.candidates.map((c) => c.score), [0.8, 0.1, 0.05]);
});

test('missing key disables only identification and never calls upstream', async () => {
  app = buildApp({ apiKey: '' });
  const response = await identify().attach('image', await image(), 'a.jpg');
  assert.equal(response.status, 503);
  assert.equal(response.body.error.code, 'IDENTIFICATION_NOT_CONFIGURED');
  assert.equal((await request(app).get('/health')).status, 200);
  assert.equal(calls.length, 0);
  await assertNoFiles();
});

test('maps upstream failures without leaking keys, bodies or retrying', async () => {
  for (const [upstream, status, code] of [
    [401, 503, 'IDENTIFICATION_CONFIGURATION_ERROR'], [403, 503, 'IDENTIFICATION_CONFIGURATION_ERROR'],
    [429, 429, 'IDENTIFICATION_LIMIT_REACHED'], [400, 502, 'IDENTIFICATION_UNAVAILABLE'],
    [500, 502, 'IDENTIFICATION_UNAVAILABLE'],
  ]) {
    calls.length = 0;
    respond = async () => new Response('sensitive private-test-key', { status: upstream });
    const response = await identify().attach('image', await image(), 'a.jpg');
    assert.equal(response.status, status);
    assert.equal(response.body.error.code, code);
    assert.equal(calls.length, 1);
    assert.equal(JSON.stringify(response.body).includes('private-test-key'), false);
    await assertNoFiles();
  }
  assert.equal(logs.length, 5);
  assert.equal(logs[0].upstreamStatus, 401);
  assert.equal(typeof logs[0].durationMs, 'number');
  assert.equal(JSON.stringify(logs).includes('private-test-key'), false);
});

test('maps malformed JSON and invalid result shapes to 502', async () => {
  for (const reply of [new Response('not json'), Response.json({}), Response.json({ results: [species('Plant', 2)] }),
    Response.json({ results: [species('', 0.4)] }), Response.json({ results: [species('Plant', 0.4, 'invalid')] })]) {
    respond = async () => reply;
    assert.equal((await identify().attach('image', await image(), 'a.jpg')).status, 502);
    await assertNoFiles();
  }
});

test('maps network errors to 502 and logs no raw error data', async () => {
  respond = async () => { throw new Error('private-test-key in URL'); };
  assert.equal((await identify().attach('image', await image(), 'a.jpg')).status, 502);
  assert.equal(calls.length, 1);
  assert.equal(JSON.stringify(logs).includes('private-test-key'), false);
  await assertNoFiles();
});

test('aborts an upstream timeout and clears temporary files', async () => {
  app = buildApp({ timeoutMs: 15 });
  respond = async (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  const response = await identify().attach('image', await image(), 'a.jpg');
  assert.equal(response.status, 504);
  assert.equal(response.body.error.code, 'IDENTIFICATION_TIMEOUT');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].signal.aborted, true);
  await assertNoFiles();
});

test('allows Web preflight for identification', async () => {
  assert.equal((await request(app).options('/plant-identifications').set('Origin', 'http://localhost:8081')
    .set('Access-Control-Request-Method', 'POST').set('Access-Control-Request-Headers', 'authorization,content-type')).status, 204);
});

test('disconnecting the client cancels upstream and removes temporary files', { timeout: 4000 }, async () => {
  let started;
  const upstreamStarted = new Promise((resolve) => { started = resolve; });
  let canceled;
  const upstreamCanceled = new Promise((resolve) => { canceled = resolve; });
  respond = async (_url, { signal }) => new Promise((_resolve, reject) => {
    started();
    signal.addEventListener('abort', () => { canceled(); reject(signal.reason); }, { once: true });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const controller = new AbortController();
    const form = new FormData();
    form.append('image', new Blob([await image()], { type: 'image/jpeg' }), 'plant.jpg');
    const pending = fetch(`http://127.0.0.1:${server.address().port}/plant-identifications`, {
      method: 'POST', body: form, headers: { Authorization: `Bearer ${access}` }, signal: controller.signal,
    });
    await upstreamStarted;
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
    await upstreamCanceled;
    // Cleanup follows cancellation asynchronously, before the handler completes.
    for (let attempt = 0; attempt < 50; attempt++) {
      const files = await fs.readdir(path.join(directory, '.uploads-tmp'));
      if (files.length === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await assertNoFiles();
    assert.equal(calls.length, 1);
    assert.equal(logs.length, 0);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
