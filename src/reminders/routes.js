const { Router } = require('express');
const { createReminderRepository } = require('./repository');
const { createReminderService } = require('./service');
const { ReminderError } = require('./schedule');
function createRemindersRouter({ db, requireAccess }) {
  const router = Router();
  const service = createReminderService(createReminderRepository(db));
  router.use('/me/reminders', requireAccess);
  router.get('/me/reminders', (req, res) => res.json({ items: service.list(req.user.user_id) }));
  router.post('/me/reminders', (req, res) => res.status(201).json({ reminder: service.create(req.user.user_id, req.body) }));
  router.patch('/me/reminders/:id', (req, res) => res.json({ reminder: service.update(req.user.user_id, req.params.id, req.body) }));
  router.post('/me/reminders/:id/complete', (req, res) => res.json({ reminder: service.complete(req.user.user_id, req.params.id) }));
  router.delete('/me/reminders/:id', (req, res) => res.json(service.remove(req.user.user_id, req.params.id)));
  router.use((error, req, res, next) => {
    if (!(error instanceof ReminderError)) return next(error);
    res.status(error.status).json({ error: { code: error.code, message: error.message, ...error.extra } });
  });
  return router;
}
module.exports = { createRemindersRouter };
