const { randomUUID } = require('node:crypto');
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { initializeDatabase } = require('../src/database');

let db;
beforeEach(() => {
  db = new Database(':memory:');
  initializeDatabase(db);
});
afterEach(() => db.close());

function insertPlant() {
  const id = randomUUID();
  db.prepare('INSERT INTO plants (id, scientific_name, name_zh) VALUES (?, ?, ?)')
    .run(id, 'Testus example', '测试植物');
  return id;
}

test('creates an empty plant library and seeds the eight ordered categories', () => {
  for (const table of ['plants', 'plant_aliases', 'plant_category_relations', 'plant_sources']) {
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0);
  }
  assert.deepEqual(
    db.prepare('SELECT slug, name_zh, name_en FROM plant_categories ORDER BY sort_order').all(),
    [
      { slug: 'ferns', name_zh: '蕨类', name_en: 'Ferns' },
      { slug: 'cacti', name_zh: '仙人掌', name_en: 'Cacti' },
      { slug: 'flowers', name_zh: '花卉', name_en: 'Flowers' },
      { slug: 'vegetables-fruits', name_zh: '蔬菜和水果', name_en: 'Vegetables & Fruits' },
      { slug: 'herbs', name_zh: '草本植物', name_en: 'Herbs' },
      { slug: 'shrubs', name_zh: '灌木', name_en: 'Shrubs' },
      { slug: 'groundcover', name_zh: '地被植物', name_en: 'Groundcover' },
      { slug: 'edible-plants', name_zh: '可食用植物', name_en: 'Edible Plants' },
    ],
  );
  assert.equal(db.prepare('PRAGMA index_list(plants)').all()
    .find((index) => index.name === 'idx_plants_scientific_name').unique, 0);
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'plant_images'").get());
});

test('plant images enforce plant ownership and one cover per plant', () => {
  const id = insertPlant();
  const image = db.prepare(`INSERT INTO plant_images
    (id, plant_id, image_type, storage_key, mime_type, width, height, file_size, sha256,
     source_name, source_url, license, checked_at, created_at, updated_at)
    VALUES (?, ?, 'cover', ?, 'image/webp', 120, 100, 1000, ?, 'Test', 'https://example.com/a', 'CC0', ?, ?, ?)`);
  image.run('image-1', id, 'a.webp', 'hash-1', '2026-01-01', '2026-01-01', '2026-01-01');
  assert.throws(() => image.run('image-2', id, 'b.webp', 'hash-2', '2026-01-01', '2026-01-01', '2026-01-01'), /UNIQUE/);
  assert.throws(() => image.run('image-3', 'missing', 'c.webp', 'hash-3', '2026-01-01', '2026-01-01', '2026-01-01'), /FOREIGN KEY/);
  db.prepare('DELETE FROM plants WHERE id = ?').run(id);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM plant_images').get().count, 0);
});

test('plant images reject duplicate hashes across cover/gallery and invalid sizes', () => {
  const id = insertPlant();
  const image = db.prepare(`INSERT INTO plant_images
    (id, plant_id, image_type, storage_key, mime_type, width, height, file_size, sha256,
     source_name, source_url, license, checked_at, created_at, updated_at)
    VALUES (?, ?, ?, 'a.webp', 'image/webp', ?, ?, ?, ?, 'Self', 'https://example.com/a', 'CC0', '2026-11-03', '2026-11-03', '2026-11-03')`);
  image.run('cover', id, 'cover', 100, 100, 1000, 'same-hash');
  assert.throws(() => image.run('gallery', id, 'gallery', 100, 100, 1000, 'same-hash'), /UNIQUE/);
  for (const sizes of [[0, 100, 1000], [100, -1, 1000], [100, 100, 0], [1.5, 100, 1000], [100, 'bad', 1000]]) {
    assert.throws(() => image.run('invalid', id, 'gallery', ...sizes, 'new-hash'), /CHECK/);
  }
});

test('repeated initialization preserves category edits, plant records and existing user data', () => {
  const id = insertPlant();
  const before = db.prepare('SELECT * FROM plants WHERE id = ?').get(id);
  const posts = db.prepare('SELECT * FROM posts ORDER BY id').all();
  db.prepare("UPDATE plant_categories SET name_zh = '自定义分类', sort_order = 99 WHERE slug = 'herbs'").run();
  const categories = db.prepare('SELECT * FROM plant_categories ORDER BY id').all();
  db.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').run('owner', 'owner@example.com', 'hash');
  db.prepare('INSERT INTO collections (user_id, post_id) VALUES (?, ?)').run('owner', posts[0].id);
  initializeDatabase(db);
  initializeDatabase(db);
  assert.deepEqual(db.prepare('SELECT * FROM plant_categories ORDER BY id').all(), categories);
  assert.deepEqual(db.prepare('SELECT * FROM plants').all(), [before]);
  assert.deepEqual(db.prepare('SELECT * FROM posts ORDER BY id').all(), posts);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM collections WHERE user_id = ?').get('owner').count, 1);
});

test('requires identity fields but allows shared names and null optional data', () => {
  const id = insertPlant();
  insertPlant(); // Names do not determine identity.
  const plant = db.prepare('SELECT * FROM plants WHERE id = ?').get(id);
  for (const [field, value] of Object.entries(plant)) {
    if (!['id', 'scientific_name', 'name_zh', 'identity_status'].includes(field)) assert.equal(value, null, field);
  }
  assert.equal(plant.identity_status, 'pending');
  for (const field of ['id', 'scientific_name', 'name_zh']) {
    assert.throws(() => db.prepare(`UPDATE plants SET ${field} = NULL WHERE id = ?`).run(id), /NOT NULL/);
  }
});

test('adds the identity review state when upgrading an existing plant table', () => {
  const legacyDb = new Database(':memory:');
  try {
    legacyDb.exec(`CREATE TABLE plants (
      id TEXT PRIMARY KEY NOT NULL,
      scientific_name TEXT NOT NULL,
      name_zh TEXT NOT NULL
    )`);
    legacyDb.prepare('INSERT INTO plants (id, scientific_name, name_zh) VALUES (?, ?, ?)')
      .run('legacy', 'Testus legacy', '旧记录');
    const { initializePlantDatabase } = require('../src/plants/database');
    initializePlantDatabase(legacyDb);
    assert.equal(legacyDb.prepare('SELECT identity_status FROM plants WHERE id = ?').get('legacy').identity_status, 'pending');
    assert.throws(() => legacyDb.prepare("UPDATE plants SET identity_status = 'unknown' WHERE id = 'legacy'").run(), /CHECK/);
  } finally {
    legacyDb.close();
  }
});

test('supports multiple aliases and categories while rejecting repeated associations', () => {
  const id = insertPlant();
  const other = insertPlant();
  const alias = db.prepare('INSERT INTO plant_aliases (plant_id, alias, language) VALUES (?, ?, ?)');
  alias.run(id, '别名一', 'zh');
  alias.run(id, 'Alias two', 'en');
  alias.run(other, '别名一', null);
  assert.throws(() => alias.run(id, '别名一', 'en'), /UNIQUE/);
  const categories = db.prepare('SELECT id FROM plant_categories ORDER BY sort_order LIMIT 2').all();
  const relate = db.prepare('INSERT INTO plant_category_relations (plant_id, category_id) VALUES (?, ?)');
  for (const category of categories) relate.run(id, category.id);
  assert.throws(() => relate.run(id, categories[0].id), /UNIQUE/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM plant_aliases WHERE plant_id = ?').get(id).count, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM plant_category_relations WHERE plant_id = ?').get(id).count, 2);
});

test('enforces foreign keys and cascades only the deleted plant dependencies', () => {
  const id = insertPlant();
  const other = insertPlant();
  const category = db.prepare('SELECT id FROM plant_categories LIMIT 1').get().id;
  const alias = db.prepare('INSERT INTO plant_aliases (plant_id, alias) VALUES (?, ?)');
  const relation = db.prepare('INSERT INTO plant_category_relations (plant_id, category_id) VALUES (?, ?)');
  const source = db.prepare('INSERT INTO plant_sources (id, plant_id) VALUES (?, ?)');
  assert.throws(() => alias.run('missing', '别名'), /FOREIGN KEY/);
  assert.throws(() => relation.run('missing', category), /FOREIGN KEY/);
  assert.throws(() => relation.run(id, 'missing'), /FOREIGN KEY/);
  assert.throws(() => source.run(randomUUID(), 'missing'), /FOREIGN KEY/);
  for (const plantId of [id, other]) {
    alias.run(plantId, '别名');
    relation.run(plantId, category);
    source.run(randomUUID(), plantId);
  }
  db.prepare('DELETE FROM plants WHERE id = ?').run(id);
  for (const table of ['plant_aliases', 'plant_category_relations', 'plant_sources']) {
    assert.deepEqual(db.prepare(`SELECT plant_id FROM ${table}`).all(), [{ plant_id: other }]);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM plant_categories').get().count, 8);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});

test('validates temperature ranges and accepts partial or unknown temperatures', () => {
  const id = insertPlant();
  const update = db.prepare('UPDATE plants SET temperature_min_c = ?, temperature_max_c = ? WHERE id = ?');
  for (const [min, max] of [[-5, 25.5], [20, 20], [null, 30], [10, null], [null, null]]) {
    update.run(min, max, id);
  }
  assert.throws(() => update.run(30, 10, id), /CHECK/);
  assert.throws(() => update.run('unknown', null, id), /CHECK/);
  assert.throws(() => update.run(null, 'unknown', id), /CHECK/);
});

test('keeps management and provenance unset until explicitly supplied and validates values', () => {
  const id = insertPlant();
  const sourceId = randomUUID();
  db.prepare('INSERT INTO plant_sources (id, plant_id) VALUES (?, ?)').run(sourceId, id);
  const source = db.prepare('SELECT * FROM plant_sources WHERE id = ?').get(sourceId);
  for (const [field, value] of Object.entries(source)) {
    if (!['id', 'plant_id'].includes(field)) assert.equal(value, null, field);
  }
  for (const state of ['draft', 'published', null]) {
    db.prepare('UPDATE plants SET publication_status = ? WHERE id = ?').run(state, id);
  }
  assert.throws(() => db.prepare("UPDATE plants SET publication_status = 'unknown' WHERE id = ?").run(id), /CHECK/);
  for (const version of [0, -1, 1.5, 'unknown']) {
    assert.throws(() => db.prepare('UPDATE plants SET content_version = ? WHERE id = ?').run(version, id), /CHECK/);
  }
  db.prepare('UPDATE plants SET content_version = 1 WHERE id = ?').run(id);
  for (const state of ['unreviewed', 'approved', 'rejected', null]) {
    db.prepare('UPDATE plant_sources SET review_status = ? WHERE id = ?').run(state, sourceId);
  }
  assert.throws(() => db.prepare("UPDATE plant_sources SET review_status = 'unknown' WHERE id = ?").run(sourceId), /CHECK/);
  db.prepare('UPDATE plants SET summary = ? WHERE id = ?').run('更新简介', id);
  assert.equal(db.prepare('SELECT updated_at FROM plants WHERE id = ?').get(id).updated_at, null);
});

test('rolls back plant schema creation if category seeding fails', () => {
  const failingDb = new Database(':memory:');
  try {
    failingDb.exec(`
      CREATE TABLE plant_categories (
        id TEXT PRIMARY KEY NOT NULL, slug TEXT NOT NULL UNIQUE,
        name_zh TEXT NOT NULL, name_en TEXT NOT NULL, sort_order INTEGER NOT NULL
      );
      CREATE TRIGGER reject_category BEFORE INSERT ON plant_categories
      BEGIN SELECT RAISE(ABORT, 'seed failed'); END;
    `);
    assert.throws(() => initializeDatabase(failingDb), /seed failed/);
    assert.equal(failingDb.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'plants'").get().count, 0);
    assert.equal(failingDb.prepare('SELECT COUNT(*) AS count FROM plant_categories').get().count, 0);
    failingDb.exec('DROP TRIGGER reject_category');
    initializeDatabase(failingDb);
    assert.equal(failingDb.prepare('SELECT COUNT(*) AS count FROM plant_categories').get().count, 8);
  } finally {
    failingDb.close();
  }
});
