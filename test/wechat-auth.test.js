const { afterEach, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const Database = require('better-sqlite3');
const { createApp } = require('../src/app');
const { initializeDatabase } = require('../src/database');
const { createWechatClient } = require('../src/auth/wechat-client');

let db;
let app;
let exchangedCodes;

beforeEach(() => {
  db = new Database(':memory:');
  initializeDatabase(db);
  exchangedCodes = [];
  app = createApp({
    db,
    jwtSecret: 'test-secret',
    wechatAppId: 'test-app-id',
    wechatAppSecret: 'test-app-secret',
    wechatClient: {
      exchangeCode: async (code) => {
        exchangedCodes.push(code);
        if (code === 'bad-code') throw new Error('WECHAT_INVALID_CODE');
        return { openid: `openid-${code}`, unionid: 'unionid-1' };
      },
    },
  });
});

afterEach(() => db.close());

const login = (code) => request(app).post('/auth/wechat/android').send({ code });

test('exchanges the code with server credentials and only returns the WeChat identity', async () => {
  let requestedUrl;
  const client = createWechatClient({
    appId: 'server-app-id',
    appSecret: 'server-app-secret',
    fetchImpl: async (url) => {
      requestedUrl = new URL(url);
      return {
        ok: true,
        json: async () => ({ access_token: 'wechat-access', refresh_token: 'wechat-refresh', openid: 'openid-1', unionid: 'unionid-1' }),
      };
    },
  });

  const identity = await client.exchangeCode('one-time-code');

  assert.equal(requestedUrl.searchParams.get('appid'), 'server-app-id');
  assert.equal(requestedUrl.searchParams.get('secret'), 'server-app-secret');
  assert.equal(requestedUrl.searchParams.get('code'), 'one-time-code');
  assert.deepEqual(identity, { openid: 'openid-1', unionid: 'unionid-1' });
  assert.equal('access_token' in identity, false);
  assert.equal('refresh_token' in identity, false);
});

test('creates a passwordless account on first WeChat login without an email', async () => {
  const response = await login('first-code');

  assert.equal(response.status, 200);
  assert.equal(response.body.user.user_email, null);
  assert.equal(response.body.user.user_name, '微信用户');
  assert.ok(response.body.access_token);
  assert.ok(response.body.refresh_token);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM users').get().count, 1);
  assert.equal(db.prepare('SELECT openid FROM wechat_accounts').get().openid, 'openid-first-code');
});

test('returns the existing account for a repeated WeChat identity', async () => {
  const first = await login('repeat-code');
  const second = await login('repeat-code');

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(second.body.user.user_id, first.body.user.user_id);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM users').get().count, 1);
});

test('rejects missing or invalid authorization codes without creating accounts', async () => {
  assert.equal((await request(app).post('/auth/wechat/android').send({})).status, 400);
  assert.equal((await login('bad-code')).status, 401);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM users').get().count, 0);
});

test('rejects disabled accounts linked to the WeChat identity', async () => {
  const first = await login('disabled-code');
  db.prepare('UPDATE users SET status = 0 WHERE id = ?').run(first.body.user.user_id);

  assert.equal((await login('disabled-code')).status, 403);
});

test('migrates existing users to allow a null email while preserving linked rows', () => {
  const legacy = new Database(':memory:');
  legacy.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL COLLATE NOCASE UNIQUE,
      password_hash TEXT, user_name TEXT DEFAULT '匿名用户', avatar_url TEXT,
      gender TEXT NOT NULL DEFAULT 'private', status INTEGER NOT NULL DEFAULT 1,
      last_login_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE collections (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      post_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, post_id)
    );
    INSERT INTO users (id, email) VALUES ('existing', 'person@example.com');
    INSERT INTO collections (user_id, post_id) VALUES ('existing', 'post-1');
  `);

  initializeDatabase(legacy);
  legacy.prepare('INSERT INTO users (id, email) VALUES (?, ?)').run('wechat-user', null);

  assert.equal(legacy.prepare('SELECT email FROM users WHERE id = ?').get('existing').email, 'person@example.com');
  assert.equal(legacy.prepare('SELECT COUNT(*) AS count FROM collections WHERE user_id = ?').get('existing').count, 1);
  assert.deepEqual(legacy.pragma('foreign_key_check'), []);
  legacy.close();
});
