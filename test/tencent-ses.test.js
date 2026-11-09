const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTencentSesEmailSender } = require('../src/auth/tencent-ses');

test('sends a single transactional email through the SES template API', async () => {
  let request;
  const sender = createTencentSesEmailSender({
    secretId: 'id',
    secretKey: 'key',
    region: 'ap-guangzhou',
    fromEmailAddress: 'GreenKeeper <noreply@mail.example.com>',
    templateId: '67866',
    client: { SendEmail: async (value) => { request = value; } },
  });

  await sender({ to: 'user@example.com', variables: { code: '123456', expire_minutes: '5' } });
  assert.deepEqual(request, {
    FromEmailAddress: 'GreenKeeper <noreply@mail.example.com>',
    Destination: ['user@example.com'],
    Subject: '【GreenKeeper】邮箱验证码',
    Template: { TemplateID: 67866, TemplateData: '{"code":"123456","expire_minutes":"5"}' },
    TriggerType: 1,
  });
});

test('reports missing SES configuration without exposing credentials', async () => {
  const sender = createTencentSesEmailSender({
    secretId: '', secretKey: '', region: 'ap-guangzhou', fromEmailAddress: 'noreply@example.com', templateId: '1',
  });
  await assert.rejects(sender({ to: 'user@example.com', variables: {} }), (error) => error.code === 'SES_NOT_CONFIGURED');
});
