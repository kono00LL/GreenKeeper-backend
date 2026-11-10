const { afterEach, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const Database = require('better-sqlite3');
const { createApp } = require('../src/app');
const { initializeDatabase } = require('../src/database');
const { seedStarterPlants } = require('../src/plants/seed-starter');

let db;
let app;

beforeEach(() => {
  db = new Database(':memory:');
  initializeDatabase(db);
  seedStarterPlants(db);
  app = createApp({ db, jwtSecret: 'test-secret', accessTokenTtl: '1h', refreshTokenTtl: '7d' });
});

afterEach(() => db.close());

const register = (email) => request(app).post('/user/register').send({ email, password: 'password123' });
const auth = (token) => ({ Authorization: `Bearer ${token}` });

test('requires an access token for every personal plant endpoint', async () => {
  const plantId = db.prepare('SELECT id FROM plants LIMIT 1').get().id;

  assert.equal((await request(app).get('/me/plants')).status, 401);
  assert.equal((await request(app).put(`/me/plants/${plantId}`)).status, 401);
  assert.equal((await request(app).delete(`/me/plants/${plantId}`)).status, 401);
});

test('lists only the current user plants and supports idempotent add and remove', async () => {
  const owner = (await register('owner@example.com')).body;
  const other = (await register('other@example.com')).body;
  const plant = db.prepare('SELECT id, name_zh FROM plants ORDER BY name_zh LIMIT 1').get();

  const empty = await request(app).get('/me/plants').set(auth(owner.access_token));
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body.items, []);

  const added = await request(app).put(`/me/plants/${plant.id}`).set(auth(owner.access_token));
  assert.equal(added.status, 200);
  assert.equal(added.body.plant.id, plant.id);
  assert.equal(added.body.plant.nameZh, plant.name_zh);

  const repeated = await request(app).put(`/me/plants/${plant.id}`).set(auth(owner.access_token));
  assert.equal(repeated.status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM user_plants').get().count, 1);

  const ownerPlants = await request(app).get('/me/plants').set(auth(owner.access_token));
  assert.deepEqual(ownerPlants.body.items.map((item) => item.id), [plant.id]);
  assert.deepEqual(ownerPlants.body.items[0].categories, added.body.plant.categories);
  assert.equal(ownerPlants.body.items[0].coverImage, null);

  const otherPlants = await request(app).get('/me/plants').set(auth(other.access_token));
  assert.deepEqual(otherPlants.body.items, []);

  const removed = await request(app).delete(`/me/plants/${plant.id}`).set(auth(owner.access_token));
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body, { removed: true });
  assert.deepEqual((await request(app).get('/me/plants').set(auth(owner.access_token))).body.items, []);
  assert.deepEqual((await request(app).get('/me/plants').set(auth(other.access_token))).body.items, []);
});

test('rejects adding an unknown plant without creating a personal record', async () => {
  const owner = (await register('owner@example.com')).body;
  const response = await request(app).put('/me/plants/missing-plant').set(auth(owner.access_token));

  assert.equal(response.status, 404);
  assert.deepEqual(response.body.error, { code: 'PLANT_NOT_FOUND', message: 'Plant not found' });
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM user_plants').get().count, 0);
});
