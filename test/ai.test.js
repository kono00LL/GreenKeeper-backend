const { afterEach, beforeEach, test } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const Database = require('better-sqlite3');
const { createApp } = require('../src/app');
const { initializeDatabase } = require('../src/database');
const { seedStarterPlants } = require('../src/plants/seed-starter');
const { createDeepSeekClient } = require('../src/ai/deepseek-client');

let db; let app; let aiCalls;
const access = (token) => ({ Authorization: `Bearer ${token}` });

beforeEach(() => {
  db = new Database(':memory:');
  initializeDatabase(db);
  seedStarterPlants(db);
  aiCalls = [];
  app = createApp({
    db,
    jwtSecret: 'test-secret',
    accessTokenTtl: '1h',
    refreshTokenTtl: '7d',
    aiClient: {
      model: 'deepseek-flash',
      async chat(messages, options) {
        aiCalls.push({ messages, options });
        return { content: '请先观察盆土干湿，再逐步调整浇水频率。' };
      },
    },
  });
});

afterEach(() => db.close());

async function register() {
  return (await request(app).post('/user/register').send({ email: 'garden@example.com', password: 'password123' })).body;
}

test('requires login and validates plant advice questions', async () => {
  const plant = db.prepare('SELECT id FROM plants LIMIT 1').get();
  assert.equal((await request(app).post('/ai/plant-advice').send({ plantId: plant.id, question: '怎么浇水？' })).status, 401);
  const session = await register();
  assert.equal((await request(app).post('/ai/plant-advice').set(access(session.access_token)).send({ plantId: plant.id, question: '' })).status, 400);
  assert.equal((await request(app).post('/ai/plant-advice').set(access(session.access_token)).send({ plantId: 'missing', question: '怎么浇水？' })).status, 404);
  assert.equal(aiCalls.length, 0);
});

test('uses local plant data as context and returns the model answer', async () => {
  const session = await register();
  const plant = db.prepare('SELECT id, name_zh, scientific_name FROM plants LIMIT 1').get();
  const response = await request(app).post('/ai/plant-advice').set(access(session.access_token)).send({
    plantId: plant.id,
    question: '最近叶子发黄，应该怎么排查？',
  });

  assert.equal(response.status, 200);
  assert.match(aiCalls[0].options.requestId, /^[A-Za-z0-9-]{8,80}$/);
  assert.deepEqual(response.body, { answer: '请先观察盆土干湿，再逐步调整浇水频率。', model: 'deepseek-flash' });
  assert.equal(aiCalls.length, 1);
  assert.equal(aiCalls[0].messages[0].role, 'system');
  assert.equal(aiCalls[0].messages[1].role, 'user');
  assert.match(aiCalls[0].messages[1].content, new RegExp(plant.name_zh));
  assert.match(aiCalls[0].messages[1].content, /最近叶子发黄/);
});

test('maps DeepSeek configuration errors without exposing credentials', async () => {
  const logEntries = [];
  const client = createDeepSeekClient({
    apiKey: '',
    fetchImpl: async () => { throw new Error('must not call'); },
    logger: { error: (entry) => logEntries.push(entry) },
  });
  app = createApp({ db, jwtSecret: 'test-secret', accessTokenTtl: '1h', refreshTokenTtl: '7d', aiClient: client });
  const session = await register();
  const plant = db.prepare('SELECT id FROM plants LIMIT 1').get();
  const response = await request(app).post('/ai/plant-advice').set(access(session.access_token)).send({ plantId: plant.id, question: '怎么浇水？' });
  assert.equal(response.status, 503);
  assert.equal(response.body.error.code, 'AI_NOT_CONFIGURED');
  assert.equal(JSON.stringify(response.body).includes('must not call'), false);
  assert.equal(logEntries.length, 1);
  assert.equal(logEntries[0].event, 'ai-service-error');
  assert.equal(logEntries[0].code, 'AI_NOT_CONFIGURED');
  assert.equal(logEntries[0].upstreamStatus, null);
  assert.equal(logEntries[0].model, 'deepseek-flash');
  assert.equal(typeof logEntries[0].durationMs, 'number');
});

test('DeepSeek client sends the compatible chat completion request', async () => {
  let call;
  const client = createDeepSeekClient({
    apiKey: 'private-key',
    baseUrl: 'https://api.deepseek.com/',
    fetchImpl: async (...args) => {
      call = args;
      return Response.json({ choices: [{ message: { content: '回答' } }] });
    },
  });
  const result = await client.chat([{ role: 'user', content: '你好' }]);
  assert.deepEqual(result, { content: '回答' });
  assert.equal(call[0], 'https://api.deepseek.com/chat/completions');
  assert.equal(call[1].headers.Authorization, 'Bearer private-key');
  assert.deepEqual(JSON.parse(call[1].body), {
    model: 'deepseek-flash',
    messages: [{ role: 'user', content: '你好' }],
    thinking: { type: 'enabled' },
    reasoning_effort: 'high',
    stream: false,
  });
});

test('DeepSeek client maps upstream throttling and network failures', async () => {
  const throttled = createDeepSeekClient({ apiKey: 'key', fetchImpl: async () => new Response('', { status: 429 }) });
  await assert.rejects(() => throttled.chat([]), (error) => error.code === 'AI_RATE_LIMITED' && error.status === 429);

  const unavailable = createDeepSeekClient({ apiKey: 'key', fetchImpl: async () => { throw new Error('private transport detail'); } });
  await assert.rejects(() => unavailable.chat([]), (error) => error.code === 'AI_UNAVAILABLE' && error.status === 502);
});

test('logs upstream authentication failures without logging credentials or prompts', async () => {
  for (const status of [401, 403]) {
    const logEntries = [];
    const client = createDeepSeekClient({
      apiKey: 'secret-api-key-marker',
      model: 'test-model',
      fetchImpl: async () => new Response('private upstream body', { status }),
      logger: { error: (entry) => logEntries.push(entry) },
    });

    await assert.rejects(
      () => client.chat([{ role: 'user', content: 'private prompt marker' }]),
      (error) => error.code === 'AI_CONFIGURATION_ERROR' && error.status === 503,
    );

    assert.equal(logEntries.length, 1);
    assert.equal(logEntries[0].event, 'ai-service-error');
    assert.equal(logEntries[0].code, 'AI_CONFIGURATION_ERROR');
    assert.equal(logEntries[0].upstreamStatus, status);
    assert.equal(logEntries[0].model, 'test-model');
    assert.equal(typeof logEntries[0].durationMs, 'number');
    const serialized = JSON.stringify(logEntries);
    assert.equal(serialized.includes('secret-api-key-marker'), false);
    assert.equal(serialized.includes('private prompt marker'), false);
    assert.equal(serialized.includes('private upstream body'), false);
  }
});

test('logs rate limits, network failures, and timeouts with safe diagnostic fields', async () => {
  const cases = [
    {
      name: 'rate limit',
      makeClient: (logger) => createDeepSeekClient({
        apiKey: 'secret-api-key-marker',
        fetchImpl: async () => new Response('private upstream body', { status: 429 }),
        logger,
      }),
      code: 'AI_RATE_LIMITED',
      status: 429,
      upstreamStatus: 429,
    },
    {
      name: 'network failure',
      makeClient: (logger) => createDeepSeekClient({
        apiKey: 'secret-api-key-marker',
        fetchImpl: async () => { throw new Error('private transport detail'); },
        logger,
      }),
      code: 'AI_UNAVAILABLE',
      status: 502,
      upstreamStatus: null,
    },
    {
      name: 'timeout',
      makeClient: (logger) => createDeepSeekClient({
        apiKey: 'secret-api-key-marker',
        timeoutMs: 5,
        fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason || new Error('aborted')), { once: true });
        }),
        logger,
      }),
      code: 'AI_TIMEOUT',
      status: 504,
      upstreamStatus: null,
    },
  ];

  for (const scenario of cases) {
    const logEntries = [];
    const client = scenario.makeClient({ error: (entry) => logEntries.push(entry) });
    await assert.rejects(
      () => client.chat([{ role: 'user', content: 'private prompt marker' }]),
      (error) => error.code === scenario.code && error.status === scenario.status,
      scenario.name,
    );
    assert.equal(logEntries.length, 1, scenario.name);
    assert.equal(logEntries[0].code, scenario.code, scenario.name);
    assert.equal(logEntries[0].upstreamStatus, scenario.upstreamStatus, scenario.name);
    assert.equal(typeof logEntries[0].model, 'string', scenario.name);
    assert.equal(typeof logEntries[0].durationMs, 'number', scenario.name);
    const serialized = JSON.stringify(logEntries);
    assert.equal(serialized.includes('secret-api-key-marker'), false, scenario.name);
    assert.equal(serialized.includes('private prompt marker'), false, scenario.name);
    assert.equal(serialized.includes('private transport detail'), false, scenario.name);
    assert.equal(serialized.includes('private upstream body'), false, scenario.name);
  }
});

test('does not add AI diagnostics to production logs by default', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousConsoleError = console.error;
  const consoleCalls = [];
  process.env.NODE_ENV = 'production';
  console.error = (...args) => consoleCalls.push(args);

  try {
    const client = createDeepSeekClient({
      apiKey: '',
      fetchImpl: async () => { throw new Error('must not call'); },
    });
    await assert.rejects(() => client.chat([]), (error) => error.code === 'AI_NOT_CONFIGURED');
  } finally {
    console.error = previousConsoleError;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }

  assert.equal(consoleCalls.length, 0);
});
