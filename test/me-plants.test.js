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
  assert.equal((await request(app).patch(`/me/plants/${plantId}`).send({ customName: '名字' })).status, 401);
  assert.equal((await request(app).delete(`/me/plants/${plantId}`)).status, 401);
});

test('lists plant instances, allows repeated adds, and removes one instance at a time', async () => {
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
  assert.equal(added.body.plant.customName, null);

  const repeated = await request(app).put(`/me/plants/${plant.id}`).set(auth(owner.access_token));
  assert.equal(repeated.status, 200);
  assert.notEqual(added.body.plant.instanceId, repeated.body.plant.instanceId);
  assert.notEqual(added.body.plant.createdAt, undefined);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM user_plants').get().count, 2);

  const ownerPlants = await request(app).get('/me/plants').set(auth(owner.access_token));
  assert.deepEqual(ownerPlants.body.items.map((item) => item.id), [plant.id, plant.id]);
  assert.notEqual(ownerPlants.body.items[0].instanceId, ownerPlants.body.items[1].instanceId);
  assert.deepEqual(ownerPlants.body.items[0].categories, added.body.plant.categories);
  assert.equal(ownerPlants.body.items[0].coverImage, null);

  const otherPlants = await request(app).get('/me/plants').set(auth(other.access_token));
  assert.deepEqual(otherPlants.body.items, []);

  const removed = await request(app).delete(`/me/plants/${ownerPlants.body.items[0].instanceId}`).set(auth(owner.access_token));
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body, { removed: true });
  const remaining = (await request(app).get('/me/plants').set(auth(owner.access_token))).body.items;
  assert.deepEqual(remaining.map((item) => item.instanceId), [ownerPlants.body.items[1].instanceId]);
  assert.equal((await request(app).delete(`/me/plants/${plant.id}`).set(auth(owner.access_token))).status, 404);
  assert.deepEqual((await request(app).delete(`/me/plants/${remaining[0].instanceId}`).set(auth(other.access_token))).body.error, {
    code: 'PLANT_INSTANCE_NOT_FOUND', message: 'Plant instance not found',
  });
  assert.deepEqual((await request(app).get('/me/plants').set(auth(owner.access_token))).body.items.map((item) => item.instanceId), [remaining[0].instanceId]);
  assert.deepEqual((await request(app).get('/me/plants').set(auth(other.access_token))).body.items, []);
});

test('rejects adding an unknown plant without creating a personal record', async () => {
  const owner = (await register('owner@example.com')).body;
  const response = await request(app).put('/me/plants/missing-plant').set(auth(owner.access_token));

  assert.equal(response.status, 404);
  assert.deepEqual(response.body.error, { code: 'PLANT_NOT_FOUND', message: 'Plant not found' });
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM user_plants').get().count, 0);
});

test('renames one owned instance, clears its name, and rejects invalid or foreign instances', async () => {
  const owner = (await register('owner-rename@example.com')).body;
  const other = (await register('other-rename@example.com')).body;
  const plant = db.prepare('SELECT id FROM plants LIMIT 1').get();
  const first = (await request(app).put(`/me/plants/${plant.id}`).set(auth(owner.access_token))).body.plant;
  const second = (await request(app).put(`/me/plants/${plant.id}`).set(auth(owner.access_token))).body.plant;

  const renamed = await request(app).patch(`/me/plants/${first.instanceId}`).set(auth(owner.access_token)).send({ customName: '  阳台铁线蕨  ' });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.plant.customName, '阳台铁线蕨');
  assert.equal(renamed.body.plant.instanceId, first.instanceId);
  assert.equal((await request(app).patch(`/me/plants/${second.instanceId}`).set(auth(owner.access_token)).send({ customName: '   ' })).body.plant.customName, null);
  assert.equal((await request(app).patch(`/me/plants/${first.instanceId}`).set(auth(owner.access_token)).send({ customName: 'x'.repeat(31) })).status, 400);
  assert.equal((await request(app).patch('/me/plants/missing-instance').set(auth(owner.access_token)).send({ customName: '名称' })).body.error.code, 'PLANT_INSTANCE_NOT_FOUND');
  assert.equal((await request(app).patch(`/me/plants/${first.instanceId}`).set(auth(other.access_token)).send({ customName: '他人实例' })).body.error.code, 'PLANT_INSTANCE_NOT_FOUND');
  const items = (await request(app).get('/me/plants').set(auth(owner.access_token))).body.items;
  assert.equal(items.find((item) => item.instanceId === first.instanceId).customName, '阳台铁线蕨');
  assert.equal(items.find((item) => item.instanceId === second.instanceId).customName, null);
});
