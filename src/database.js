const { randomUUID } = require('node:crypto');

const seedPosts = [
  { title: '为室内植物建立稳定的浇水节奏', excerpt: '观察土壤和光照，比固定日历更能帮助你判断植物何时需要水。', content: '先检查盆土表层和花盆重量，再决定是否浇水。不同植物、季节和光照环境的需水量都不同。', coverImage: 'https://images.unsplash.com/photo-1485955900006-10f4d324d411?auto=format&fit=crop&w=1200&q=80' },
  { title: '认识窗边的明亮散射光', excerpt: '叶片颜色、灼斑和徒长都能提供植物光照是否合适的线索。', content: '明亮散射光通常指植物能看清周围环境，但叶片不会长时间受到强烈直射阳光照射的位置。', coverImage: 'https://images.unsplash.com/photo-1497250681960-ef046c08a56e?auto=format&fit=crop&w=1200&q=80' },
  { title: '换盆前先检查根系和排水', excerpt: '换盆不必追求大盆，合适的排水和根系空间更重要。', content: '如果根系已经绕满盆底、浇水后很快流出，或基质长期板结，可以考虑换盆。', coverImage: 'https://images.unsplash.com/photo-1501004318641-b39e6451bec6?auto=format&fit=crop&w=1200&q=80' },
];

function addColumnIfMissing(db, table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function initializeDatabase(db) {
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL COLLATE NOCASE UNIQUE,
      password_hash TEXT NOT NULL,
      user_name TEXT DEFAULT '匿名用户', avatar_url TEXT,
      gender TEXT NOT NULL DEFAULT 'private' CHECK (gender IN ('male', 'female', 'private')),
      status INTEGER NOT NULL DEFAULT 1, last_login_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, excerpt TEXT NOT NULL, content TEXT NOT NULL,
      cover_image TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS collections (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (user_id, post_id)
    );
    CREATE TABLE IF NOT EXISTS refresh_sessions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
      revoked_at TEXT, replaced_by TEXT REFERENCES refresh_sessions(id)
    );
    CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_collections_user_id ON collections(user_id);
    CREATE INDEX IF NOT EXISTS idx_refresh_sessions_user_id ON refresh_sessions(user_id);
  `);
  addColumnIfMissing(db, 'users', 'user_name', 'TEXT');
  addColumnIfMissing(db, 'users', 'avatar_url', 'TEXT');
  addColumnIfMissing(db, 'users', 'status', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing(db, 'users', 'last_login_at', 'TEXT');
  addColumnIfMissing(db, 'users', 'gender', "TEXT NOT NULL DEFAULT 'private' CHECK (gender IN ('male', 'female', 'private'))");
  db.prepare("UPDATE users SET gender = 'private' WHERE gender IS NULL OR gender NOT IN ('male', 'female', 'private')").run();

  if (db.prepare('SELECT COUNT(*) AS count FROM posts').get().count === 0) {
    const insert = db.prepare('INSERT INTO posts (id, title, excerpt, content, cover_image, created_at) VALUES (@id, @title, @excerpt, @content, @coverImage, @createdAt)');
    db.transaction(() => seedPosts.forEach((post, index) => insert.run({ id: randomUUID(), ...post, createdAt: new Date(Date.now() - index * 60000).toISOString() })))();
  }
}

module.exports = { initializeDatabase };
