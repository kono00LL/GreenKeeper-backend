class PostError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const notFound = () => new PostError(404, 'POST_NOT_FOUND', 'Post not found');
function createPostService(repository) {
  return {
    list(query, userId) {
      const page = Number(query.page ?? 1),
        pageSize = Number(query.pageSize ?? 10);
      if (
        (query.page !== undefined && typeof query.page !== 'string') ||
        (query.pageSize !== undefined && typeof query.pageSize !== 'string') ||
        !Number.isSafeInteger(page) ||
        page < 1 ||
        !Number.isInteger(pageSize) ||
        pageSize < 1 ||
        pageSize > 50 ||
        !Number.isSafeInteger((page - 1) * pageSize)
      ) {
        throw new PostError(
          400,
          'VALIDATION_ERROR',
          'page must be positive and pageSize must be between 1 and 50',
        );
      }
      return repository.list(page, pageSize, userId);
    },
    detail(id, userId) {
      const post = repository.detail(id, userId);
      if (!post) throw notFound();
      return post;
    },
    setCollection(id, userId, collected) {
      if (typeof collected !== 'boolean')
        throw new PostError(400, 'VALIDATION_ERROR', 'collected must be a boolean');
      const result = repository.setCollection(id, userId, collected);
      if (!result) throw notFound();
      return result;
    },
    collections(userId, category) {
      if (category !== undefined && !['article', 'encyclopedia'].includes(category))
        throw new PostError(400, 'VALIDATION_ERROR', 'category must be article or encyclopedia');
      return repository.collections(userId, category);
    },
  };
}
module.exports = { createPostService, PostError };
