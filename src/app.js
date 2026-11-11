const { createPlantnetClient } = require('./identifications/plantnet-client');
const { createIdentificationRouter } = require('./identifications/routes');
const { createPostRouter } = require('./posts/routes');
const { createPlantRouter } = require('./plants/routes');
const { createPlantRepository } = require('./plants/repository');
const { createUserPlantsRouter } = require('./plants/user-routes');
const { createRemindersRouter } = require('./reminders/routes');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createHash, randomUUID } = require('node:crypto');
const path = require('node:path');
const { createImageRouter, createImageReadRouter } = require('./images/routes');
const { createImageStorage } = require('./images/storage');
const { createDeepSeekClient } = require('./ai/deepseek-client');
const { createAiRouter } = require('./ai/routes');
const { createRequestId, requestPath, errorDetails } = require('./diagnostics');
const { createEmailAuthRouter } = require('./auth/routes');
const { createEmailAuthService } = require('./auth/email-code-service');
const { createTencentSesEmailSender } = require('./auth/tencent-ses');
const { createWechatClient } = require('./auth/wechat-client');
const { createWechatAuthService } = require('./auth/wechat-auth-service');
const { createWechatAuthRouter } = require('./auth/wechat-routes');

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function createApp({ db, identificationClient = createPlantnetClient({ apiKey: process.env.PLANTNET_API_KEY || '' }), aiClient = createDeepSeekClient(), emailSender = createTencentSesEmailSender(), emailCodeSecret = process.env.EMAIL_CODE_SECRET, wechatAppId = process.env.WECHAT_APP_ID, wechatAppSecret = process.env.WECHAT_APP_SECRET, wechatClient = createWechatClient({ appId: wechatAppId, appSecret: wechatAppSecret }), uploadDirectory = path.join(process.env.DATA_DIRECTORY || path.join(__dirname, '..', 'data'), 'uploads'), uploadTempDirectory = path.join(path.dirname(uploadDirectory), '.uploads-tmp'), imageStorage = createImageStorage(uploadDirectory), jwtSecret = process.env.JWT_SECRET || 'greenkeeper-local-development-secret', accessTokenTtl = process.env.ACCESS_TOKEN_TTL || '15m', refreshTokenTtl = process.env.REFRESH_TOKEN_TTL || '7d', defaultAvatarUrl = process.env.DEFAULT_AVATAR_URL || null, corsOrigins = (process.env.CORS_ORIGINS || 'http://localhost:8081,http://127.0.0.1:8081').split(',').map(origin => origin.trim()).filter(Boolean) }) {
  const app = express();
  const development = process.env.NODE_ENV !== 'production';
  const requestLogging = development || process.env.DEBUG === '1';
  app.use((req, res, next) => {
    const startedAt = Date.now();
    req.requestId = createRequestId(req.get('X-Request-ID'));
    res.set('X-Request-ID', req.requestId);
    const sendJson = res.json.bind(res);
    res.json = (body) => {
      if (body?.error?.code) res.locals.errorCode = body.error.code;
      return sendJson(body);
    };
    res.on('finish', () => {
      if (!requestLogging) return;
      const entry = {
        event: 'http-request',
        requestId: req.requestId,
        method: req.method,
        path: requestPath(req),
        status: res.statusCode,
        errorCode: res.locals.errorCode || null,
        durationMs: Date.now() - startedAt,
      };
      (res.statusCode >= 400 ? console.error : console.log)(JSON.stringify(entry));
    });
    next();
  });
  app.use((req, res, next) => {
    const origin = req.get('origin');
    res.vary('Origin');
    if (origin && corsOrigins.includes(origin)) {
      res.set('Access-Control-Allow-Origin', origin);
      res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Request-ID');
      res.set('Access-Control-Expose-Headers', 'X-Request-ID');
      if (req.method === 'OPTIONS') return res.sendStatus(204);
    } else if (origin && req.method === 'OPTIONS') {
      return res.status(403).json({ error: { code: 'CORS_ORIGIN_DENIED', message: 'Origin is not allowed' } });
    }
    next();
  });
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
      if (!record || record.status === 0 || !record.password_hash || !(await bcrypt.compare(input.password, record.password_hash))) return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect' } });
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

  const emailAuthService = createEmailAuthService({ db, emailSender, emailCodeSecret });
  app.use(createEmailAuthRouter({ service: emailAuthService, createAuthResponse: (user) => authResponse({
    user_id: user.id,
    user_email: user.email,
    user_name: user.user_name,
    avatar_url: user.avatar_url,
    gender: user.gender,
    created_time: user.created_at,
    status: user.status,
    last_login_at: user.last_login_at,
  }) }));
  const wechatAuthService = createWechatAuthService({ db, wechatClient });
  app.use(createWechatAuthRouter({ service: wechatAuthService, createAuthResponse: (user) => authResponse({
    user_id: user.id,
    user_email: user.email,
    user_name: user.user_name,
    avatar_url: user.avatar_url,
    gender: user.gender,
    created_time: user.created_at,
    status: user.status,
    last_login_at: user.last_login_at,
  }) }));

  app.use(createIdentificationRouter({ requireAccess, uploadTempDirectory, client: identificationClient, plantRepository: createPlantRepository(db) }));
  app.use(createAiRouter({ requireAccess, client: aiClient, plantRepository: createPlantRepository(db) }));
  app.use(createImageRouter({ requireAccess, imageStorage, uploadTempDirectory }));
  app.use('/uploads', express.static(uploadDirectory, { index: false, dotfiles: 'deny', setHeaders: (res) => res.set('X-Content-Type-Options', 'nosniff') }));
  app.use(createImageReadRouter(imageStorage));
  app.use('/plants', createPlantRouter({ db }));
  app.use(createUserPlantsRouter({ db, requireAccess }));
  app.use(createRemindersRouter({ db, requireAccess }));
  app.use(createPostRouter({ db, requireAccess }));
  app.use((req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (development) {
      console.error(JSON.stringify({
        event: 'http-unhandled-error',
        requestId: req.requestId,
        method: req.method,
        path: requestPath(req),
        error: errorDetails(error),
      }));
    }
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  });
  return app;
}

module.exports = { createApp };
