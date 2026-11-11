const { Router } = require('express');
const { WechatAuthError } = require('./wechat-auth-service');

function createWechatAuthRouter({ service, createAuthResponse }) {
  const router = Router();

  router.post('/auth/wechat/android', async (req, res) => {
    try {
      const user = await service.login(req.body || {});
      res.json(createAuthResponse(user));
    } catch (error) {
      if (error instanceof WechatAuthError) {
        return res.status(error.status).json({ error: { code: error.code, message: error.message } });
      }
      return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
    }
  });

  return router;
}

module.exports = { createWechatAuthRouter };
