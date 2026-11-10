const { randomUUID } = require('node:crypto');

const categories = [
  { id: 'ferns', slug: 'ferns', nameZh: '蕨类', nameEn: 'Ferns', sortOrder: 0 },
  { id: 'cacti', slug: 'cacti', nameZh: '仙人掌', nameEn: 'Cacti', sortOrder: 1 },
  { id: 'flowers', slug: 'flowers', nameZh: '花卉', nameEn: 'Flowers', sortOrder: 2 },
  { id: 'vegetables-fruits', slug: 'vegetables-fruits', nameZh: '蔬菜和水果', nameEn: 'Vegetables & Fruits', sortOrder: 3 },
  { id: 'herbs', slug: 'herbs', nameZh: '草本植物', nameEn: 'Herbs', sortOrder: 4 },
  { id: 'shrubs', slug: 'shrubs', nameZh: '灌木', nameEn: 'Shrubs', sortOrder: 5 },
  { id: 'groundcover', slug: 'groundcover', nameZh: '地被植物', nameEn: 'Groundcover', sortOrder: 6 },
  { id: 'edible-plants', slug: 'edible-plants', nameZh: '可食用植物', nameEn: 'Edible Plants', sortOrder: 7 },
];

function initializePlantDatabase(db) {
  db.pragma('foreign_keys = ON');
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS plants (
        id TEXT PRIMARY KEY NOT NULL,
        scientific_name TEXT NOT NULL,
        name_zh TEXT NOT NULL,
        name_en TEXT,
        identity_status TEXT NOT NULL DEFAULT 'pending'
          CHECK (identity_status IN ('pending', 'verified')),
        summary TEXT,
        appearance_features TEXT,
        temperature_min_c REAL CHECK (temperature_min_c IS NULL OR typeof(temperature_min_c) IN ('integer', 'real')),
        temperature_max_c REAL CHECK (temperature_max_c IS NULL OR typeof(temperature_max_c) IN ('integer', 'real')),
        temperature_notes TEXT,
        sunlight_requirement TEXT,
        watering_requirement TEXT,
        repotting_requirement TEXT,
        pests TEXT,
        publication_status TEXT CHECK (publication_status IS NULL OR publication_status IN ('draft', 'published')),
        content_version INTEGER CHECK (content_version IS NULL OR (typeof(content_version) = 'integer' AND content_version > 0)),
        updated_at TEXT,
        CHECK (temperature_min_c IS NULL OR temperature_max_c IS NULL OR temperature_min_c <= temperature_max_c)
      );
      CREATE INDEX IF NOT EXISTS idx_plants_scientific_name
        ON plants(scientific_name);

      CREATE TABLE IF NOT EXISTS plant_aliases (
        plant_id TEXT NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
        alias TEXT NOT NULL,
        language TEXT,
        PRIMARY KEY (plant_id, alias)
      );

      CREATE TABLE IF NOT EXISTS plant_categories (
        id TEXT PRIMARY KEY NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        name_zh TEXT NOT NULL,
        name_en TEXT NOT NULL,
        sort_order INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS plant_category_relations (
        plant_id TEXT NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
        category_id TEXT NOT NULL REFERENCES plant_categories(id) ON DELETE CASCADE,
        PRIMARY KEY (plant_id, category_id)
      );
      CREATE INDEX IF NOT EXISTS idx_plant_category_relations_category
        ON plant_category_relations(category_id, plant_id);

      CREATE TABLE IF NOT EXISTS plant_sources (
        id TEXT PRIMARY KEY NOT NULL,
        plant_id TEXT NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
        source_name TEXT,
        source_url TEXT,
        checked_at TEXT,
        review_status TEXT CHECK (review_status IS NULL OR review_status IN ('unreviewed', 'approved', 'rejected'))
      );
      CREATE INDEX IF NOT EXISTS idx_plant_sources_plant
        ON plant_sources(plant_id);

      CREATE TABLE IF NOT EXISTS user_plants (
        instance_id TEXT PRIMARY KEY NOT NULL,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        plant_id TEXT NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        custom_name TEXT
      );
    `);

    const userPlantColumns = db.prepare('PRAGMA table_info(user_plants)').all();
    if (!userPlantColumns.some((column) => column.name === 'instance_id')) {
      db.exec(`
        ALTER TABLE user_plants RENAME TO user_plants_legacy;
        CREATE TABLE user_plants (
          instance_id TEXT PRIMARY KEY NOT NULL,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          plant_id TEXT NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          custom_name TEXT
        );
      `);
      const legacyRows = db.prepare('SELECT user_id, plant_id, created_at FROM user_plants_legacy').all();
      const insertLegacy = db.prepare('INSERT INTO user_plants (instance_id, user_id, plant_id, created_at) VALUES (?, ?, ?, ?)');
      for (const row of legacyRows) insertLegacy.run(randomUUID(), row.user_id, row.plant_id, row.created_at);
      db.exec('DROP TABLE user_plants_legacy');
    }
    const currentColumns = db.prepare('PRAGMA table_info(user_plants)').all();
    if (!currentColumns.some((column) => column.name === 'custom_name')) {
      db.exec('ALTER TABLE user_plants ADD COLUMN custom_name TEXT');
    }
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_user_plants_user_created
        ON user_plants(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_user_plants_plant_id
        ON user_plants(plant_id, user_id);
    `);

    initializePlantImageDatabase(db);

    const insertCategory = db.prepare(`
      INSERT OR IGNORE INTO plant_categories (id, slug, name_zh, name_en, sort_order)
      VALUES (@id, @slug, @nameZh, @nameEn, @sortOrder)
    `);
    for (const category of categories) insertCategory.run(category);

    const plantColumns = db.prepare('PRAGMA table_info(plants)').all();
    if (!plantColumns.some((column) => column.name === 'identity_status')) {
      db.exec(`ALTER TABLE plants ADD COLUMN identity_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (identity_status IN ('pending', 'verified'))`);
    }
  })();
}

function initializePlantImageDatabase(db) {
  db.exec(`
      CREATE TABLE IF NOT EXISTS plant_images (
        id TEXT PRIMARY KEY NOT NULL,
        plant_id TEXT NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
        image_type TEXT NOT NULL DEFAULT 'cover' CHECK (image_type IN ('cover', 'gallery')),
        storage_key TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        width INTEGER NOT NULL CHECK (typeof(width) = 'integer' AND width > 0),
        height INTEGER NOT NULL CHECK (typeof(height) = 'integer' AND height > 0),
        file_size INTEGER NOT NULL CHECK (typeof(file_size) = 'integer' AND file_size > 0),
        sha256 TEXT NOT NULL,
        alt_text TEXT,
        source_name TEXT NOT NULL,
        source_url TEXT NOT NULL,
        license TEXT NOT NULL,
        license_url TEXT,
        attribution TEXT,
        checked_at TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (plant_id, image_type, sort_order),
        UNIQUE (plant_id, sha256)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_one_cover_image_per_plant
        ON plant_images(plant_id) WHERE image_type = 'cover';
      CREATE INDEX IF NOT EXISTS idx_plant_images_plant
        ON plant_images(plant_id, image_type, sort_order);
  `);
}

module.exports = { initializePlantDatabase, initializePlantImageDatabase };
