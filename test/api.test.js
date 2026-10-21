const { afterEach, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const { createApp } = require('../src/app');
const { initializeDatabase } = require('../src/database');

let db; let app;
beforeEach(() => { db = new Database(':memory:'); initializeDatabase(db); app = createApp({ db, jwtSecret: 'test-secret', accessTokenTtl: '1h', refreshTokenTtl: '7d' }); });
afterEach(() => db.close());
const register = (email, password = 'password123', extra = {}) => request(app).post('/user/register').send({ email, password, ...extra });
const auth = (token) => ({ Authorization: `Bearer ${token}` });

test('registers email account with profile defaults and hashed password', async () => {
  const response = await register('Garden@example.com');
  assert.equal(response.status, 201);
  assert.equal(response.body.user.user_email, 'garden@example.com');
  assert.equal(response.body.user.user_name, '匿名用户');
  assert.equal(response.body.user.gender, 'private');
  assert.ok(response.body.access_token); assert.ok(response.body.refresh_token);
  assert.notEqual(db.prepare('SELECT password_hash FROM users').get().password_hash, 'password123');
});

test('migrates legacy users tables with a constrained default gender', () => {
  const legacyDb = new Database(':memory:');
  legacyDb.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL COLLATE NOCASE UNIQUE,
      password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  initializeDatabase(legacyDb);

  const columns = legacyDb.prepare('PRAGMA table_info(users)').all();
  assert.equal(columns.find((column) => column.name === 'gender').dflt_value, "'private'");
  legacyDb.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').run('legacy', 'legacy@example.com', 'hash');
  assert.equal(legacyDb.prepare('SELECT gender FROM users WHERE id = ?').get('legacy').gender, 'private');
  assert.throws(
    () => legacyDb.prepare('UPDATE users SET gender = ? WHERE id = ?').run('unknown', 'legacy'),
    /CHECK constraint failed/,
  );
  legacyDb.close();
});

test('rejects invalid and duplicate registrations and wrong login', async () => {
  assert.equal((await register('bad-email')).status, 400);
  assert.equal((await register('garden@example.com')).status, 201);
  assert.equal((await register('GARDEN@example.com')).status, 409);
  assert.equal((await request(app).post('/user/login').send({ email: 'garden@example.com', password: 'wrong-password' })).status, 401);
});

test('supports login, access validation, user info and profile update', async () => {
  await register('garden@example.com', 'password123', { user_name: '小园丁', avatar_url: 'https://example.com/a.png' });
  const login = await request(app).post('/user/login').send({ email: 'GARDEN@example.com', password: 'password123' });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.user_name, '小园丁');
  assert.equal((await request(app).get('/user/userinfo').set(auth(login.body.access_token))).body.user.user_email, 'garden@example.com');
  const updated = await request(app).put('/user/userinfo').set(auth(login.body.access_token)).send({ user_name: '新名字', gender: 'female' });
  assert.equal(updated.body.user.user_name, '新名字');
  assert.equal(updated.body.user.gender, 'female');
  assert.equal((await request(app).put('/user/userinfo').set(auth(login.body.access_token)).send({ gender: 'male' })).body.user.gender, 'male');
  assert.equal((await request(app).put('/user/userinfo').set(auth(login.body.access_token)).send({ gender: 'unknown' })).status, 400);
  assert.equal((await request(app).put('/user/userinfo').set(auth(login.body.access_token)).send({ user_name: '' })).status, 400);
  assert.equal((await request(app).put('/user/userinfo').set(auth(login.body.access_token)).send({ user_name: '这是一个超过十个字符的昵称' })).status, 400);
  assert.equal((await request(app).get('/user/userinfo').set(auth(login.body.refresh_token))).status, 401);
});

test('rotates refresh tokens and rejects the old token', async () => {
  const tokens = (await register('garden@example.com')).body;
  const refreshed = await request(app).get('/user/refresh').set(auth(tokens.refresh_token));
  assert.equal(refreshed.status, 200);
  assert.ok(refreshed.body.access_token); assert.ok(refreshed.body.refresh_token);
  assert.notEqual(refreshed.body.refresh_token, tokens.refresh_token);
  assert.equal((await request(app).get('/user/refresh').set(auth(tokens.refresh_token))).status, 401);
  assert.equal((await request(app).get('/user/refresh').set(auth(refreshed.body.refresh_token))).status, 200);
});

test('rejects malformed and expired tokens, and logout revokes sessions', async () => {
  const user = (await register('garden@example.com')).body.user;
  const expired = jwt.sign({ sub: user.user_id, type: 'refresh', jti: 'expired' }, 'test-secret', { expiresIn: -1 });
  assert.equal((await request(app).get('/user/refresh').set(auth('invalid'))).status, 401);
  assert.equal((await request(app).get('/user/refresh').set(auth(expired))).status, 401);
  const tokens = (await request(app).post('/user/login').send({ email: 'garden@example.com', password: 'password123' })).body;
  assert.equal((await request(app).post('/user/logout').set(auth(tokens.refresh_token))).body.success, true);
  assert.equal((await request(app).get('/user/refresh').set(auth(tokens.refresh_token))).status, 401);
});

test('keeps post browsing and collection behavior', async () => {
  const owner = (await register('owner@example.com')).body;
  const other = (await register('other@example.com')).body;
  const list = await request(app).get('/posts?page=1&pageSize=2');
  assert.equal(list.status, 200); assert.equal(list.body.items.length, 2); assert.ok(list.body.total >= 2);
  const postId = list.body.items[0].id;
  assert.equal((await request(app).get(`/posts/${postId}`)).status, 200);
  assert.equal((await request(app).put(`/posts/${postId}/collection`).set(auth(owner.access_token)).send({ collected: true })).body.collected, true);
  await request(app).put(`/posts/${postId}/collection`).set(auth(owner.access_token)).send({ collected: true });
  assert.equal((await request(app).get('/me/collections').set(auth(owner.access_token))).body.items.length, 1);
  assert.equal((await request(app).get('/me/collections').set(auth(other.access_token))).body.items.length, 0);
  assert.equal((await request(app).put(`/posts/${postId}/collection`).set(auth(owner.access_token)).send({ collected: false })).body.collected, false);
});

test('seeds seven additional articles with increasing content lengths idempotently', () => {
  const titles = [
    '给新手的阳台种植起步清单',
    '用一周观察法判断植物是否缺水',
    '从叶片变化认识室内光照',
    '给香草植物搭配透气的盆土',
    '换季时如何调整植物的养护节奏',
    '用扦插繁殖一盆新的绿植',
    '把阳台规划成四季都有收获的小花园',
  ];

  const seeded = db.prepare('SELECT title, content FROM posts WHERE title IN (?, ?, ?, ?, ?, ?, ?)').all(...titles);
  assert.equal(seeded.length, 7);
  assert.deepEqual(
    db.prepare('SELECT title FROM posts ORDER BY created_at DESC, id ASC LIMIT 7').all().map((post) => post.title),
    titles,
  );
  const lengths = titles.map((title) => {
    const post = seeded.find((item) => item.title === title);
    assert.ok(post, `missing seeded article: ${title}`);
    return Array.from(post.content).length;
  });
  const expectedRanges = [[80, 180], [180, 330], [330, 480], [480, 630], [630, 780], [780, 930], [900, 1100]];
  lengths.forEach((length, index) => {
    assert.ok(length >= expectedRanges[index][0] && length <= expectedRanges[index][1], `article ${index + 1}: ${length} characters`);
  });
  assert.ok(lengths.every((length, index) => index === 0 || length > lengths[index - 1]), lengths.join(', '));

  const countBefore = db.prepare('SELECT COUNT(*) AS count FROM posts').get().count;
  initializeDatabase(db);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM posts').get().count, countBefore);
});

test('reports service health', async () => { const response = await request(app).get('/health'); assert.equal(response.status, 200); assert.equal(response.body.status, 'ok'); });
