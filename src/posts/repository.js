function createPostRepository(db) {
  const fields = 'id, title, excerpt, content, cover_image AS coverImage, category, created_at AS createdAt';
  function decorate(post, userId) {
    if (!post) return null;
    const images = db
      .prepare(
        'SELECT id, url, width, height FROM post_images WHERE post_id = ? ORDER BY position ASC, id ASC',
      )
      .all(post.id);
    const collectionCount = db
      .prepare('SELECT COUNT(*) AS count FROM collections WHERE post_id = ?')
      .get(post.id).count;
    const collected = Boolean(
      userId &&
        db
          .prepare('SELECT 1 FROM collections WHERE post_id = ? AND user_id = ?')
          .get(post.id, userId),
    );
    return {
      ...post,
      coverImage: images[0]?.url ?? post.coverImage,
      images,
      collectionCount,
      collected,
    };
  }
  return {
    list(page, pageSize, userId) {
      const total = db.prepare('SELECT COUNT(*) AS count FROM posts').get().count;
      const rows = db
        .prepare(`SELECT ${fields} FROM posts ORDER BY created_at DESC, id ASC LIMIT ? OFFSET ?`)
        .all(pageSize, (page - 1) * pageSize);
      return {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
        items: rows.map((row) => decorate(row, userId)),
      };
    },
    detail(id, userId) {
      return decorate(db.prepare(`SELECT ${fields} FROM posts WHERE id = ?`).get(id), userId);
    },
    setCollection: db.transaction((id, userId, collected) => {
      if (!db.prepare('SELECT 1 FROM posts WHERE id = ?').get(id)) return null;
      if (collected)
        db.prepare('INSERT OR IGNORE INTO collections (user_id, post_id) VALUES (?, ?)').run(
          userId,
          id,
        );
      else db.prepare('DELETE FROM collections WHERE user_id = ? AND post_id = ?').run(userId, id);
      const collectionCount = db
        .prepare('SELECT COUNT(*) AS count FROM collections WHERE post_id = ?')
        .get(id).count;
      return { post_id: id, collected, collectionCount };
    }),
    collections(userId, category) {
      const rows = db
        .prepare(
          `SELECT p.id, p.title, p.excerpt, p.content, p.cover_image AS coverImage,
        p.category, p.created_at AS createdAt, c.created_at AS collectedAt FROM collections c JOIN posts p ON p.id = c.post_id
        WHERE c.user_id = ? AND (? IS NULL OR p.category = ?) ORDER BY c.created_at DESC, p.created_at DESC, p.id ASC`,
        )
        .all(userId, category ?? null, category ?? null);
      return rows.map((row) => decorate(row, userId));
    },
  };
}
module.exports = { createPostRepository };
