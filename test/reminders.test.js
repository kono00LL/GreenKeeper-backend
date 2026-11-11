const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const request = require('supertest');
const { initializeDatabase } = require('../src/database');
const { createApp } = require('../src/app');
const { seedStarterPlants } = require('../src/plants/seed-starter');
const { addDays, todayInZone, resolveSchedule } = require('../src/reminders/schedule');

let db, app, token, otherToken, instanceId, secondInstanceId;
const payload = () => ({ instanceId, careType: 'watering', interval: 2, unit: 'days', time: '09:00', timeZone: 'Asia/Taipei', lastCareChoice: 'yesterday' });
const auth = (value = token) => ({ Authorization: `Bearer ${value}` });
beforeEach(async () => {
  db = new Database(':memory:');
  initializeDatabase(db);
  seedStarterPlants(db);
  app = createApp({ db, jwtSecret: 'test-reminders' });
  token = (await request(app).post('/user/register').send({ email: 'reminders@example.com', password: 'password123' })).body.access_token;
  otherToken = (await request(app).post('/user/register').send({ email: 'other@example.com', password: 'password123' })).body.access_token;
  const plantId = db.prepare('SELECT id FROM plants LIMIT 1').get().id;
  instanceId = (await request(app).put(`/me/plants/${plantId}`).set(auth())).body.plant.instanceId;
  secondInstanceId = (await request(app).put(`/me/plants/${plantId}`).set(auth())).body.plant.instanceId;
});
afterEach(() => db.close());

test('calendar arithmetic preserves dates across months, years, leap years and time zones', () => {
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2024-02-28', 7), '2024-03-06');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(todayInZone('Asia/Taipei', new Date('2026-11-10T17:00:00Z')), '2026-11-11');
  assert.deepEqual(resolveSchedule({ ...payload(), unit: 'weeks', interval: 2, lastCareChoice: 'unknown' }, '2026-11-11'), { lastCareChoice: 'unknown', lastCareDate: null, anchorDate: '2026-11-11', nextDueDate: '2026-11-25' });
  assert.equal(resolveSchedule({ ...payload(), lastCareChoice: 'two_weeks_ago' }, '2026-11-11').nextDueDate, '2026-10-30');
});

test('authenticates every reminder operation and permits browser PATCH and DELETE', async () => {
  for (const [method, path] of [['get', '/me/reminders'], ['post', '/me/reminders'], ['patch', '/me/reminders/missing'], ['post', '/me/reminders/missing/complete'], ['delete', '/me/reminders/missing']]) {
    assert.equal((await request(app)[method](path).send(payload())).status, 401);
  }
  const preflight = await request(app).options('/me/reminders/x').set('Origin', 'http://localhost:8081').set('Access-Control-Request-Method', 'PATCH');
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers['access-control-allow-methods'], /PATCH/);
  assert.match(preflight.headers['access-control-allow-methods'], /DELETE/);
});

test('creates isolated instance plans, edits without moving the anchor, completes one and deletes', async () => {
  assert.deepEqual((await request(app).get('/me/reminders').set(auth())).body.items, []);
  const created = await request(app).post('/me/reminders').set(auth()).send(payload());
  assert.equal(created.status, 201);
  const first = created.body.reminder;
  assert.equal(first.instanceId, instanceId);
  const second = (await request(app).post('/me/reminders').set(auth()).send({ ...payload(), instanceId: secondInstanceId, interval: 7 })).body.reminder;
  assert.equal((await request(app).post('/me/reminders').set(auth()).send(payload())).status, 409);
  assert.equal((await request(app).post('/me/reminders').set(auth()).send({ ...payload(), careType: 'fertilizing' })).status, 201);
  const edited = (await request(app).patch(`/me/reminders/${first.id}`).set(auth()).send({ interval: 3, time: '10:30' })).body.reminder;
  assert.equal(edited.anchorDate, first.anchorDate);
  assert.equal(edited.nextDueDate, addDays(first.anchorDate, 3));
  await request(app).patch(`/me/plants/${instanceId}`).set(auth()).send({ customName: '阳台这盆' });
  const list = (await request(app).get('/me/reminders').set(auth())).body.items;
  assert.equal(list.find((item) => item.id === first.id).displayName, '阳台这盆');
  const completed = (await request(app).post(`/me/reminders/${first.id}/complete`).set(auth())).body.reminder;
  assert.equal(completed.lastCareDate, todayInZone('Asia/Taipei'));
  assert.equal(completed.nextDueDate, addDays(completed.lastCareDate, 3));
  assert.equal((await request(app).get('/me/reminders').set(auth())).body.items.find((item) => item.id === second.id).nextDueDate, second.nextDueDate);
  assert.deepEqual((await request(app).get('/me/reminders').set(auth(otherToken))).body.items, []);
  for (const method of ['patch', 'delete']) assert.equal((await request(app)[method](`/me/reminders/${first.id}`).set(auth(otherToken)).send({ time: '10:00' })).status, 404);
  assert.equal((await request(app).post(`/me/reminders/${first.id}/complete`).set(auth(otherToken))).status, 404);
  assert.equal((await request(app).patch('/me/reminders/missing').set(auth()).send({ time: '10:00' })).status, 404);
  assert.equal((await request(app).delete(`/me/reminders/${second.id}`).set(auth())).status, 200);
  await request(app).delete(`/me/plants/${instanceId}`).set(auth());
  assert.deepEqual((await request(app).get('/me/reminders').set(auth())).body.items, []);
});

test('validates schedule fields and instance ownership without storing invalid plans', async () => {
  for (const fields of [{ instanceId: 'missing' }, { careType: 'other' }, { interval: 0 }, { interval: 1.5 }, { interval: 366 }, { unit: 'weeks', interval: 53 }, { unit: 'months' }, { time: '25:00' }, { timeZone: 'Bad/Zone' }, { lastCareChoice: 'invalid' }, { lastCareDate: '2026-02-30' }, { lastCareDate: '2999-01-01' }]) {
    const result = await request(app).post('/me/reminders').set(auth()).send({ ...payload(), ...fields });
    assert.ok([400, 404].includes(result.status), JSON.stringify(fields));
  }
  assert.equal((await request(app).post('/me/reminders').set(auth(otherToken)).send(payload())).status, 404);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM plant_reminders').get().n, 0);
  initializeDatabase(db);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});
