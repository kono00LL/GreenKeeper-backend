const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { initializeDatabase } = require('../src/database');
const { starterPlants } = require('../src/plants/starter-plants');
const { seedStarterPlants } = require('../src/plants/seed-starter');

function createDatabase() {
  const db = new Database(':memory:');
  initializeDatabase(db);
  return db;
}

test('defines twenty unique pending plants with valid target categories', () => {
  assert.equal(starterPlants.length, 20);
  assert.equal(new Set(starterPlants.map(({ nameZh }) => nameZh)).size, 20);
  assert.equal(new Set(starterPlants.map(({ scientificName }) => scientificName)).size, 20);
  for (const plant of starterPlants) {
    assert.ok(plant.id);
    assert.ok(plant.nameZh);
    assert.ok(plant.scientificName);
    assert.ok(plant.categories.length);
    assert.ok(plant.categories.every((slug) => typeof slug === 'string'));
  }
});

test('seeds twenty unpublished plants and their many-to-many category links', () => {
  const db = createDatabase();
  try {
    const result = seedStarterPlants(db);
    assert.equal(result.inserted, 20);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM plants').get().count, 20);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM plant_aliases').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM plant_sources').get().count, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM plants WHERE identity_status != 'pending'").get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM plants WHERE publication_status IS NOT NULL OR content_version IS NOT NULL OR updated_at IS NOT NULL').get().count, 0);
    assert.ok(db.prepare('SELECT COUNT(*) AS count FROM plant_category_relations').get().count > 20);
    assert.equal(db.prepare(`
      SELECT COUNT(DISTINCT category_id) AS count FROM plant_category_relations
    `).get().count, 8);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  } finally {
    db.close();
  }
});

test('is idempotent and preserves reviewed edits on a repeated starter import', () => {
  const db = createDatabase();
  try {
    seedStarterPlants(db);
    const first = starterPlants[0];
    db.prepare("UPDATE plants SET identity_status = 'verified', summary = 'Reviewed copy' WHERE id = ?")
      .run(first.id);
    const relations = db.prepare('SELECT * FROM plant_category_relations ORDER BY plant_id, category_id').all();
    const result = seedStarterPlants(db);
    assert.equal(result.inserted, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM plants').get().count, 20);
    assert.deepEqual(db.prepare('SELECT * FROM plant_category_relations ORDER BY plant_id, category_id').all(), relations);
    const plant = db.prepare('SELECT identity_status, summary FROM plants WHERE id = ?').get(first.id);
    assert.deepEqual(plant, { identity_status: 'verified', summary: 'Reviewed copy' });
  } finally {
    db.close();
  }
});

test('rejects an existing name collision without partially importing the list', () => {
  const db = createDatabase();
  try {
    const first = starterPlants[starterPlants.length - 1];
    db.prepare('INSERT INTO plants (id, scientific_name, name_zh) VALUES (?, ?, ?)')
      .run('existing', first.scientificName, '已存在的其他记录');
    assert.throws(() => seedStarterPlants(db), /scientific name already exists/i);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM plants').get().count, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM plant_category_relations').get().count, 0);
  } finally {
    db.close();
  }
});

test('rolls back the import when a required category is missing', () => {
  const db = createDatabase();
  try {
    db.prepare("DELETE FROM plant_categories WHERE slug = 'groundcover'").run();
    assert.throws(() => seedStarterPlants(db), /Unknown starter plant category: groundcover/);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM plants').get().count, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM plant_category_relations').get().count, 0);
  } finally {
    db.close();
  }
});
