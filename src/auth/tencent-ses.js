class SesConfigurationError extends Error {
  constructor() {
    super('Tencent SES is not configured');
    this.code = 'SES_NOT_CONFIGURED';
  }
}

function createTencentSesEmailSender({
  secretId = process.env.TENCENTCLOUD_SECRET_ID,
  secretKey = process.env.TENCENTCLOUD_SECRET_KEY,
  region = process.env.SES_REGION,
  fromEmailAddress = process.env.SES_FROM_EMAIL,
  templateId = process.env.SES_TEMPLATE_ID,
  client,
} = {}) {
  let sesClient = client;

  return async function sendEmail({ to, variables }) {
    if (!secretId || !secretKey || !region || !fromEmailAddress || !templateId) {
      throw new SesConfigurationError();
    }
    if (!sesClient) {
      const { ses } = require('tencentcloud-sdk-nodejs-ses');
      const { Client } = ses.v20201002;
      sesClient = new Client({
        credential: { secretId, secretKey },
        region,
        profile: { httpProfile: { endpoint: 'ses.tencentcloudapi.com' } },
      });
    }

    await sesClient.SendEmail({
      FromEmailAddress: fromEmailAddress,
      Destination: [to],
      Subject: '【GreenKeeper】邮箱验证码',
      Template: {
        TemplateID: Number(templateId),
        TemplateData: JSON.stringify(variables),
      },
      TriggerType: 1,
    });
  };
}

module.exports = { createTencentSesEmailSender, SesConfigurationError };
