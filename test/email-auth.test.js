const { afterEach, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const { createApp } = require('../src/app');
const { initializeDatabase } = require('../src/database');

let db;
let app;
let sent;

beforeEach(() => {
  db = new Database(':memory:');
  initializeDatabase(db);
  sent = [];
  app = createApp({
    db,
    jwtSecret: 'test-secret',
    emailCodeSecret: 'test-email-code-secret',
    emailSender: async (message) => sent.push(message),
    accessTokenTtl: '1h',
    refreshTokenTtl: '7d',
  });
});

afterEach(() => db.close());

const sendCode = (email, purpose = 'login') => request(app).post('/auth/email-code').send({ email, purpose });
const codeFromLastEmail = () => sent.at(-1).variables.code;

test('sends a code and creates a passwordless user on first successful verification', async () => {
  const sentResponse = await sendCode('Garden@example.com');
  assert.equal(sentResponse.status, 202);
  assert.deepEqual(sentResponse.body, { success: true });
  assert.equal(sent[0].to, 'garden@example.com');
  assert.equal(sent[0].variables.expire_minutes, '5');

  const verified = await request(app).post('/auth/email-code/verify').send({ email: 'GARDEN@example.com', code: codeFromLastEmail() });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.user.user_email, 'garden@example.com');
  assert.ok(verified.body.access_token);
  assert.ok(verified.body.refresh_token);
  assert.equal(db.prepare('SELECT password_hash FROM users WHERE email = ?').get('garden@example.com').password_hash, null);
  assert.equal(db.prepare('SELECT used_at FROM email_verification_codes').get().used_at !== null, true);
  assert.equal((await request(app).post('/auth/email-code/verify').send({ email: 'garden@example.com', code: codeFromLastEmail() })).status, 401);
});

test('code login works for existing accounts and preserves the legacy password login', async () => {
  const passwordHash = await bcrypt.hash('password123', 4);
  db.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').run('existing', 'existing@example.com', passwordHash);

  await sendCode('existing@example.com');
  const verified = await request(app).post('/auth/email-code/verify').send({ email: 'existing@example.com', code: codeFromLastEmail() });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.user.user_id, 'existing');

  const legacyLogin = await request(app).post('/user/login').send({ email: 'existing@example.com', password: 'password123' });
  assert.equal(legacyLogin.status, 200);
});

test('rejects invalid email and purpose before sending', async () => {
  assert.equal((await sendCode('invalid')).status, 400);
  assert.equal((await sendCode('person@example.com', 'unknown')).status, 400);
  assert.equal(sent.length, 0);
});

test('limits repeated email requests and does not expose delivery details', async () => {
  const first = await sendCode('person@example.com');
  assert.equal(first.status, 202);
  assert.equal((await sendCode('person@example.com')).status, 429);
  assert.equal(sent.length, 1);
});

test('caps email requests per hour and IP requests across addresses', async () => {
  for (let i = 0; i < 5; i += 1) {
    const response = await sendCode('hourly@example.com');
    assert.equal(response.status, i < 5 ? 202 : 429);
    db.prepare('UPDATE email_code_requests SET created_at = ? WHERE email = ?').run(new Date(Date.now() - 61_000).toISOString(), 'hourly@example.com');
  }
  assert.equal((await sendCode('hourly@example.com')).status, 429);
  db.prepare('UPDATE email_code_requests SET created_at = ?').run(new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString());

  for (let i = 0; i < 20; i += 1) {
    assert.equal((await sendCode(`address${i}@example.com`)).status, 202);
  }
  assert.equal((await sendCode('address20@example.com')).status, 429);
});

test('does not make a code usable when SES delivery fails', async () => {
  app = createApp({
    db,
    jwtSecret: 'test-secret',
    emailCodeSecret: 'test-email-code-secret',
    emailSender: async () => { throw new Error('provider secret must not leak'); },
  });
  const response = await sendCode('person@example.com');
  assert.equal(response.status, 502);
  assert.doesNotMatch(JSON.stringify(response.body), /provider secret/);
  assert.equal(db.prepare("SELECT delivery_status FROM email_verification_codes").get().delivery_status, 'failed');
});

test('expires codes, caps incorrect attempts and prevents code reuse', async () => {
  await sendCode('person@example.com');
  const code = codeFromLastEmail();
  const id = db.prepare('SELECT id FROM email_verification_codes').get().id;
  for (let i = 0; i < 5; i += 1) {
    assert.equal((await request(app).post('/auth/email-code/verify').send({ email: 'person@example.com', code: '000000' })).status, 401);
  }
  assert.equal((await request(app).post('/auth/email-code/verify').send({ email: 'person@example.com', code })).status, 401);

  await sendCode('expired@example.com');
  db.prepare('UPDATE email_verification_codes SET expires_at = ? WHERE email = ?').run(new Date(Date.now() - 1000).toISOString(), 'expired@example.com');
  assert.equal((await request(app).post('/auth/email-code/verify').send({ email: 'expired@example.com', code: codeFromLastEmail() })).status, 401);
  assert.ok(id);
});

test('keeps login and password-reset codes isolated and resets legacy passwords', async () => {
  const oldHash = await bcrypt.hash('oldpassword123', 4);
  db.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').run('legacy', 'legacy@example.com', oldHash);
  const oldSession = await request(app).post('/user/login').send({ email: 'legacy@example.com', password: 'oldpassword123' });
  assert.equal(oldSession.status, 200);
  await sendCode('legacy@example.com', 'login');
  const loginCode = codeFromLastEmail();
  db.prepare('UPDATE email_code_requests SET created_at = ? WHERE email = ?').run(new Date(Date.now() - 61_000).toISOString(), 'legacy@example.com');
  await sendCode('legacy@example.com', 'password_reset');
  const resetCode = codeFromLastEmail();

  assert.equal((await request(app).post('/auth/password/reset').send({ email: 'legacy@example.com', code: loginCode, newPassword: 'newpassword123' })).status, 401);
  const reset = await request(app).post('/auth/password/reset').send({ email: 'legacy@example.com', code: resetCode, newPassword: 'newpassword123' });
  assert.equal(reset.status, 200);
  assert.equal((await bcrypt.compare('newpassword123', db.prepare('SELECT password_hash FROM users WHERE id = ?').get('legacy').password_hash)), true);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM refresh_sessions WHERE user_id = ? AND revoked_at IS NULL').get('legacy').count, 0);
  assert.equal((await request(app).get('/user/refresh').set({ Authorization: `Bearer ${oldSession.body.refresh_token}` })).status, 401);
  const codeLogin = await request(app).post('/auth/email-code/verify').send({ email: 'legacy@example.com', code: loginCode });
  assert.equal(codeLogin.status, 200);
});

test('migrates password_hash to nullable without breaking user foreign keys', () => {
  const legacy = new Database(':memory:');
  legacy.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL COLLATE NOCASE UNIQUE,
      password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE collections (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      post_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, post_id)
    );
    INSERT INTO users (id, email, password_hash) VALUES ('u', 'u@example.com', 'old-hash');
    INSERT INTO collections (user_id, post_id) VALUES ('u', 'p');
  `);
  initializeDatabase(legacy);
  legacy.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').run('new', 'new@example.com', null);
  assert.equal(legacy.prepare('SELECT password_hash FROM users WHERE id = ?').get('u').password_hash, 'old-hash');
  assert.equal(legacy.prepare('SELECT COUNT(*) AS count FROM collections WHERE user_id = ?').get('u').count, 1);
  assert.deepEqual(legacy.pragma('foreign_key_check'), []);
  legacy.close();
});
