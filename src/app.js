const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createHash, randomUUID } = require('node:crypto');

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function createApp({ db, jwtSecret = process.env.JWT_SECRET || 'greenkeeper-local-development-secret', accessTokenTtl = process.env.ACCESS_TOKEN_TTL || '15m', refreshTokenTtl = process.env.REFRESH_TOKEN_TTL || '7d', defaultAvatarUrl = process.env.DEFAULT_AVATAR_URL || null }) {
  const app = express();
  app.use(express.json({ limit: '100kb' }));
  const hashToken = (token) => createHash('sha256').update(token).digest('hex');
  const selectUser = 'SELECT id AS user_id, email AS user_email, user_name, avatar_url, gender, created_at AS created_time, status, last_login_at FROM users WHERE id = ?';
  const userDto = (user) => ({ user_id: user.user_id, user_email: user.user_email, user_name: user.user_name || '匿名用户', avatar_url: user.avatar_url || null, gender: user.gender || 'private', created_time: user.created_time, status: user.status ?? 1, last_login_at: user.last_login_at || null });
  const bearer = (req) => { const match = (req.get('authorization') || '').match(/^Bearer\s+(.+)$/i); return match ? match[1] : null; };
  const issue = (userId, type, jti, expiresIn) => jwt.sign({ sub: userId, type, jti }, jwtSecret, { expiresIn });
  const tokenPair = (user) => {
    const sessionId = randomUUID();
    const accessToken = issue(user.user_id, 'access', sessionId, accessTokenTtl);
    const refreshToken = issue(user.user_id, 'refresh', sessionId, refreshTokenTtl);
    const decoded = jwt.decode(refreshToken);
    db.prepare('INSERT INTO refresh_sessions (id, user_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').run(sessionId, user.user_id, hashToken(refreshToken), new Date().toISOString(), new Date(decoded.exp * 1000).toISOString());
    return { access_token: accessToken, refresh_token: refreshToken };
  };
  const verify = (token, type) => { const payload = jwt.verify(token, jwtSecret); if (payload.type !== type || !payload.sub || !payload.jti) throw new Error('Invalid token'); return payload; };
  const requireAccess = (req, res, next) => {
    const token = bearer(req);
    if (!token) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Access token required' } });
    try {
      const payload = verify(token, 'access');
      const user = db.prepare(selectUser).get(payload.sub);
      if (!user || user.status === 0) throw new Error('Unavailable user');
      req.user = user; req.tokenPayload = payload; next();
    } catch { res.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Access token is invalid or expired' } }); }
  };
  const validateCredentials = (body, profile = false) => {
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!emailPattern.test(email) || email.length > 254) return { error: 'A valid email is required' };
    if (typeof body?.password !== 'string' || body.password.length < 8 || body.password.length > 72) return { error: 'Password must be 8 to 72 characters' };
    if (profile && body.user_name !== undefined && (typeof body.user_name !== 'string' || body.user_name.trim().length > 10)) return { error: 'user_name must be at most 10 characters' };
    if (profile && body.avatar_url !== undefined && body.avatar_url !== null && (typeof body.avatar_url !== 'string' || body.avatar_url.length > 500)) return { error: 'avatar_url must be at most 500 characters' };
    return { email, password: body.password };
  };
  const authResponse = (user) => ({ user: userDto(user), ...tokenPair(user) });

  async function register(req, res, next) {
    try {
      const input = validateCredentials(req.body, true);
      if (input.error) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: input.error } });
      if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(input.email)) return res.status(409).json({ error: { code: 'EMAIL_EXISTS', message: 'Email is already registered' } });
      const id = randomUUID();
      const name = typeof req.body.user_name === 'string' && req.body.user_name.trim() ? req.body.user_name.trim() : '匿名用户';
      const createdAt = new Date().toISOString();
      const passwordHash = await bcrypt.hash(input.password, 12);
      db.prepare('INSERT INTO users (id, email, password_hash, user_name, avatar_url, gender, status, created_at) VALUES (?, ?, ?, ?, ?, \'private\', 1, ?)').run(id, input.email, passwordHash, name, req.body.avatar_url || defaultAvatarUrl, createdAt);
      res.status(201).json(authResponse(db.prepare(selectUser).get(id)));
    } catch (error) { next(error); }
  }

  async function login(req, res, next) {
    try {
      const input = validateCredentials(req.body);
      if (input.error) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: input.error } });
      const record = db.prepare('SELECT id, email, password_hash, status FROM users WHERE email = ?').get(input.email);
      if (!record || record.status === 0 || !(await bcrypt.compare(input.password, record.password_hash))) return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' } });
      db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(new Date().toISOString(), record.id);
      res.json(authResponse(db.prepare(selectUser).get(record.id)));
    } catch (error) { next(error); }
  }

  function refresh(req, res) {
    const token = bearer(req) || req.body?.refreshToken;
    if (!token) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Refresh token required' } });
    try {
      const payload = verify(token, 'refresh');
      const session = db.prepare('SELECT * FROM refresh_sessions WHERE id = ? AND token_hash = ?').get(payload.jti, hashToken(token));
      if (!session || session.revoked_at || new Date(session.expires_at) <= new Date()) throw new Error('Revoked session');
      const user = db.prepare(selectUser).get(payload.sub);
      if (!user || user.status === 0) throw new Error('Unavailable user');
      const pair = tokenPair(user);
      const nextPayload = jwt.decode(pair.refresh_token);
      db.prepare('UPDATE refresh_sessions SET revoked_at = ?, replaced_by = ? WHERE id = ?').run(new Date().toISOString(), nextPayload.jti, session.id);
      res.json(pair);
    } catch { res.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Refresh token is invalid, expired, or revoked' } }); }
  }

  function logout(req, res) {
    const token = bearer(req) || req.body?.refreshToken;
    if (!token) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Token required' } });
    try {
      const payload = jwt.verify(token, jwtSecret);
      if (payload.type === 'refresh' && payload.jti) db.prepare('UPDATE refresh_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ? AND token_hash = ?').run(new Date().toISOString(), payload.jti, hashToken(token));
      else if (payload.type === 'access' && payload.sub) db.prepare('UPDATE refresh_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE user_id = ? AND revoked_at IS NULL').run(new Date().toISOString(), payload.sub);
      else throw new Error('Invalid token');
      res.json({ success: true });
    } catch { res.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Token is invalid or expired' } }); }
  }

  function updateUser(req, res) {
    const { user_name: name, avatar_url: avatar, gender } = req.body || {};
    if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.trim().length > 10)) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'user_name must be 1 to 10 characters' } });
    if (avatar !== undefined && avatar !== null && (typeof avatar !== 'string' || avatar.length > 500)) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'avatar_url must be at most 500 characters' } });
    if (gender !== undefined && !['male', 'female', 'private'].includes(gender)) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'gender must be male, female, or private' } });
    if (name === undefined && avatar === undefined && gender === undefined) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'At least one profile field is required' } });
    db.prepare('UPDATE users SET user_name = COALESCE(?, user_name), avatar_url = COALESCE(?, avatar_url), gender = COALESCE(?, gender) WHERE id = ?').run(name === undefined ? null : name.trim(), avatar === undefined ? null : avatar, gender === undefined ? null : gender, req.user.user_id);
    res.json({ user: userDto(db.prepare(selectUser).get(req.user.user_id)) });
  }

  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.post(['/user/register', '/auth/register'], register);
  app.post(['/user/login', '/auth/login'], login);
  app.get(['/user/refresh', '/auth/refresh'], refresh);
  app.post('/auth/refresh', refresh);
  app.get('/user/userinfo', requireAccess, (req, res) => res.json({ user: userDto(req.user) }));
  app.put('/user/userinfo', requireAccess, updateUser);
  app.post('/user/logout', logout);
  app.get('/auth/me', requireAccess, (req, res) => res.json({ user: userDto(req.user) }));

  app.get('/posts', (req, res) => {
    const page = Number(req.query.page ?? 1); const pageSize = Number(req.query.pageSize ?? 10);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'page must be positive and pageSize must be between 1 and 50' } });
    const total = db.prepare('SELECT COUNT(*) AS count FROM posts').get().count;
    const items = db.prepare('SELECT id, title, excerpt, content, cover_image AS coverImage, created_at AS createdAt FROM posts ORDER BY created_at DESC, id ASC LIMIT ? OFFSET ?').all(pageSize, (page - 1) * pageSize);
    res.json({ page, pageSize, total, totalPages: Math.ceil(total / pageSize), items });
  });
  app.get('/posts/:id', (req, res) => { const post = db.prepare('SELECT id, title, excerpt, content, cover_image AS coverImage, created_at AS createdAt FROM posts WHERE id = ?').get(req.params.id); if (!post) return res.status(404).json({ error: { code: 'POST_NOT_FOUND', message: 'Post not found' } }); res.json({ post }); });
  app.put('/posts/:id/collection', requireAccess, (req, res) => { const collected = req.body?.collected; if (typeof collected !== 'boolean') return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'collected must be a boolean' } }); if (!db.prepare('SELECT id FROM posts WHERE id = ?').get(req.params.id)) return res.status(404).json({ error: { code: 'POST_NOT_FOUND', message: 'Post not found' } }); if (collected) db.prepare('INSERT OR IGNORE INTO collections (user_id, post_id) VALUES (?, ?)').run(req.user.user_id, req.params.id); else db.prepare('DELETE FROM collections WHERE user_id = ? AND post_id = ?').run(req.user.user_id, req.params.id); res.json({ post_id: req.params.id, collected }); });
  app.get('/me/collections', requireAccess, (req, res) => res.json({ items: db.prepare('SELECT p.id, p.title, p.excerpt, p.content, p.cover_image AS coverImage, p.created_at AS createdAt, c.created_at AS collectedAt FROM collections c JOIN posts p ON p.id = c.post_id WHERE c.user_id = ? ORDER BY c.created_at DESC, p.created_at DESC').all(req.user.user_id) }));
  app.use((req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }));
  app.use((error, req, res, next) => { if (res.headersSent) return next(error); res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } }); });
  return app;
}

module.exports = { createApp };
