const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const { initializeDatabase } = require('../src/database');
const { createApp } = require('../src/app');
let db, app;
beforeEach(() => {
  db = new Database(':memory:');
  initializeDatabase(db);
  app = createApp({ db, jwtSecret: 'test-secret' });
});
afterEach(() => db.close());
function token(id) {
  db.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').run(
    id,
    `${id}@example.com`,
    'hash',
  );
  return jwt.sign({ sub: id, type: 'access', jti: id }, 'test-secret', { expiresIn: '1h' });
}
const auth = (value) => ({ Authorization: `Bearer ${value}` });

test('backfills legacy covers once, preserves collections and ordered images', async () => {
  const id = db.prepare('SELECT id FROM posts LIMIT 1').get().id;
  const access = token('owner');
  db.prepare('INSERT INTO collections (user_id, post_id) VALUES (?, ?)').run('owner', id);
  initializeDatabase(db);
  initializeDatabase(db);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM post_images').get().n, 10);
  db.prepare(
    'INSERT INTO post_images (id, post_id, url, position, width, height) VALUES (?, ?, ?, ?, ?, ?)',
  ).run('second', id, 'https://example.com/2.jpg', 1, 800, 600);
  const { body } = await request(app).get(`/posts/${id}`).set(auth(access));
  assert.equal(body.post.images.length, 2);
  assert.equal(body.post.images[0].url, body.post.coverImage);
  assert.equal(body.post.images[0].width, null);
  assert.deepEqual(body.post.images[1], {
    id: 'second',
    url: 'https://example.com/2.jpg',
    width: 800,
    height: 600,
  });
  assert.equal(body.post.collectionCount, 1);
  assert.equal(body.post.collected, true);
  assert.equal(body.post.category, 'article');
});

test('serves stable pages, no-image posts, empty and out-of-range pages', async () => {
  db.prepare('DELETE FROM posts').run();
  const insert = db.prepare(
    'INSERT INTO posts (id, title, excerpt, content, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  for (const id of ['b', 'a', 'c']) insert.run(id, id, '摘要', '段落一\n段落二', '2026-01-01');
  const first = (await request(app).get('/posts?pageSize=2')).body;
  assert.deepEqual(
    first.items.map((p) => p.id),
    ['a', 'b'],
  );
  assert.deepEqual(first.items[0].images, []);
  assert.equal(first.items[0].collected, false);
  assert.equal(first.items[0].collectionCount, 0);
  assert.equal(first.items[0].category, 'article');
  assert.equal(first.totalPages, 2);
  assert.deepEqual(
    (await request(app).get('/posts?page=2&pageSize=2')).body.items.map((p) => p.id),
    ['c'],
  );
  assert.deepEqual((await request(app).get('/posts?page=3&pageSize=2')).body.items, []);
  for (const query of [
    'page=0',
    'page=1.5',
    'pageSize=51',
    'pageSize=0',
    'page=x',
    'page=1&page=2',
    'page=9007199254740992',
  ]) {
    assert.equal((await request(app).get(`/posts?${query}`)).status, 400, query);
  }
  db.prepare('DELETE FROM posts').run();
  assert.deepEqual((await request(app).get('/posts')).body, {
    page: 1,
    pageSize: 10,
    total: 0,
    totalPages: 0,
    items: [],
  });
});

test('separates personalized collection state, reports counts and keeps writes idempotent', async () => {
  const owner = token('owner'),
    other = token('other');
  const id = db.prepare('SELECT id FROM posts LIMIT 1').get().id;
  for (let i = 0; i < 2; i++) {
    const response = await request(app)
      .put(`/posts/${id}/collection`)
      .set(auth(owner))
      .send({ collected: true });
    assert.deepEqual(response.body, { post_id: id, collected: true, collectionCount: 1 });
  }
  for (const [access, collected] of [
    [null, false],
    [owner, true],
    [other, false],
  ]) {
    let req = request(app).get(`/posts/${id}`);
    if (access) req = req.set(auth(access));
    const post = (await req).body.post;
    assert.equal(post.collected, collected);
    assert.equal(post.collectionCount, 1);
  }
  const mine = (await request(app).get('/me/collections').set(auth(owner))).body.items[0];
  assert.equal(mine.collected, true);
  assert.equal(mine.collectionCount, 1);
  assert.ok(mine.images.length);
  await request(app).put(`/posts/${id}/collection`).set(auth(other)).send({ collected: true });
  for (let i = 0; i < 2; i++) {
    const response = await request(app)
      .put(`/posts/${id}/collection`)
      .set(auth(owner))
      .send({ collected: false });
    assert.equal(response.body.collectionCount, 1);
  }
  assert.equal(
    (await request(app).put(`/posts/${id}/collection`).send({ collected: true })).status,
    401,
  );
  assert.equal(
    (await request(app).put(`/posts/${id}/collection`).set(auth(owner)).send({ collected: 'true' }))
      .status,
    400,
  );
  assert.equal(
    (await request(app).put('/posts/missing/collection').set(auth(owner)).send({ collected: true }))
      .status,
    404,
  );
});

test('filters the authenticated collection list by category and rejects unknown categories', async () => {
  const owner = token('owner');
  const posts = db.prepare('SELECT id FROM posts ORDER BY id').all();
  const articleId = posts[0].id;
  const encyclopediaId = posts[1].id;
  db.prepare("UPDATE posts SET category = 'encyclopedia' WHERE id = ?").run(encyclopediaId);
  for (const id of [articleId, encyclopediaId]) {
    await request(app).put(`/posts/${id}/collection`).set(auth(owner)).send({ collected: true });
  }

  const all = await request(app).get('/me/collections').set(auth(owner));
  const article = await request(app)
    .get('/me/collections?category=article')
    .set(auth(owner));
  const encyclopedia = await request(app)
    .get('/me/collections?category=encyclopedia')
    .set(auth(owner));
  assert.equal(all.body.items.length, 2);
  assert.deepEqual(article.body.items.map((post) => post.id), [articleId]);
  assert.deepEqual(encyclopedia.body.items.map((post) => post.id), [encyclopediaId]);
  assert.equal(article.body.items[0].category, 'article');
  assert.equal((await request(app).get('/me/collections?category=other').set(auth(owner))).status, 400);
  assert.equal(
    (await request(app).get('/me/collections?category=other').set(auth(owner))).body.error.code,
    'VALIDATION_ERROR',
  );
});

test('rejects invalid, expired, refresh and disabled-user tokens on public routes', async () => {
  const id = db.prepare('SELECT id FROM posts LIMIT 1').get().id;
  const access = token('disabled');
  db.prepare('UPDATE users SET status = 0 WHERE id = ?').run('disabled');
  for (const value of [
    'broken',
    access,
    jwt.sign({ sub: 'missing', type: 'access', jti: 'x' }, 'test-secret', { expiresIn: -1 }),
    jwt.sign({ sub: 'missing', type: 'refresh', jti: 'x' }, 'test-secret'),
  ]) {
    for (const path of ['/posts', `/posts/${id}`])
      assert.equal((await request(app).get(path).set(auth(value))).status, 401);
  }
  assert.equal(
    (await request(app).get('/posts').set('Authorization', 'Basic invalid')).status,
    401,
  );
  assert.equal((await request(app).get('/posts/missing')).body.error.code, 'POST_NOT_FOUND');
});

test('allows configured browser origins and collection preflight requests', async () => {
  app = createApp({ db, jwtSecret: 'test-secret', corsOrigins: ['http://localhost:8081'] });
  const response = await request(app)
    .options('/posts/a/collection')
    .set('Origin', 'http://localhost:8081')
    .set('Access-Control-Request-Method', 'PUT')
    .set('Access-Control-Request-Headers', 'authorization,content-type');
  assert.equal(response.status, 204);
  assert.equal(response.headers['access-control-allow-origin'], 'http://localhost:8081');
  assert.match(response.headers['access-control-allow-methods'], /PUT/);
  assert.match(response.headers['access-control-allow-headers'], /Authorization/i);
  assert.equal(
    (await request(app).get('/posts').set('Origin', 'http://localhost:8081')).headers[
      'access-control-allow-origin'
    ],
    'http://localhost:8081',
  );
  assert.equal(
    (await request(app).options('/posts').set('Origin', 'https://other.example')).status,
    403,
  );
});

test('upgrades an actual legacy database without replacing posts or collections', () => {
  const legacy = new Database(':memory:');
  try {
    legacy.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE posts (id TEXT PRIMARY KEY, title TEXT NOT NULL, excerpt TEXT NOT NULL, content TEXT NOT NULL, cover_image TEXT, created_at TEXT NOT NULL);
      CREATE TABLE collections (user_id TEXT NOT NULL REFERENCES users(id), post_id TEXT NOT NULL REFERENCES posts(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (user_id, post_id));
      INSERT INTO users (id, email, password_hash) VALUES ('u', 'old@example.com', 'hash');
      INSERT INTO posts VALUES ('old', '原帖子', '简介', '正文', 'https://example.com/old.jpg', '2025-01-01');
      INSERT INTO collections (user_id, post_id) VALUES ('u', 'old');
    `);
    initializeDatabase(legacy);
    initializeDatabase(legacy);
    assert.equal(legacy.prepare('SELECT category FROM posts WHERE id = ?').get('old').category, 'article');
    assert.equal(legacy.prepare('SELECT COUNT(*) AS n FROM posts').get().n, 8);
    assert.equal(legacy.prepare('SELECT COUNT(*) AS n FROM collections').get().n, 1);
    assert.equal(legacy.prepare('SELECT COUNT(*) AS n FROM post_images').get().n, 8);
    assert.deepEqual(
      legacy.prepare('SELECT post_id, url, position, width, height FROM post_images WHERE post_id = ?').get('old'),
      {
        post_id: 'old',
        url: 'https://example.com/old.jpg',
        position: 0,
        width: null,
        height: null,
      },
    );
  } finally {
    legacy.close();
  }
});
