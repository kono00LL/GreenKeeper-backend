const { Router } = require('express');
const { createPostRepository } = require('./repository');
const { createPostService, PostError } = require('./service');
function createPostRouter({ db, requireAccess }) {
  const router = Router();
  const service = createPostService(createPostRepository(db));
  const optionalAccess = (req, res, next) =>
    req.get('authorization') !== undefined ? requireAccess(req, res, next) : next();
  router.get('/posts', optionalAccess, (req, res) =>
    res.json(service.list(req.query, req.user?.user_id)),
  );
  router.get('/posts/:id', optionalAccess, (req, res) =>
    res.json({ post: service.detail(req.params.id, req.user?.user_id) }),
  );
  router.put('/posts/:id/collection', requireAccess, (req, res) =>
    res.json(service.setCollection(req.params.id, req.user.user_id, req.body?.collected)),
  );
  router.get('/me/collections', requireAccess, (req, res) =>
    res.json({ items: service.collections(req.user.user_id, req.query.category) }),
  );
  router.use((error, req, res, next) => {
    if (!(error instanceof PostError)) return next(error);
    res.status(error.status).json({ error: { code: error.code, message: error.message } });
  });
  return router;
}
module.exports = { createPostRouter };
