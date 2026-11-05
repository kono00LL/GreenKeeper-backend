const { Router } = require('express');
const { EmailAuthError } = require('./email-code-service');

function createEmailAuthRouter({ service, createAuthResponse }) {
  const router = Router();

  router.post('/auth/email-code', async (req, res) => {
    try {
      await service.requestCode({ ...req.body, ip: req.ip });
      res.status(202).json({ success: true });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/auth/email-code/verify', (req, res) => {
    try {
      const user = service.verifyLogin(req.body || {});
      res.json(createAuthResponse(user));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/auth/password/reset', async (req, res) => {
    try {
      const result = await service.resetPassword(req.body || {});
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  return router;
}

function sendError(res, error) {
  if (error instanceof EmailAuthError) {
    return res.status(error.status).json({ error: { code: error.code, message: error.message } });
  }
  return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
}

module.exports = { createEmailAuthRouter };
