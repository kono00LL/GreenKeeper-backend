const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { initializeDatabase } = require('../src/database');
const { seedStarterPlants } = require('../src/plants/seed-starter');
const { starterPlants } = require('../src/plants/starter-plants');
// Keep the original batch's import and migration guarantees covered independently.
const catalog = require('../src/plants/data/indoor-balcony-v1.json');
const { preflightCatalog, importCatalog } = require('../src/plants/import-catalog');

function database() { const db = new Database(':memory:'); initializeDatabase(db); return db; }
const clone = (value) => structuredClone(value);

test('catalog contains 100 distinct species, retains starter UUIDs and has traceable reviewed content', () => {
  const db = database();
  try {
    assert.equal(catalog.length, 100);
    assert.equal(preflightCatalog(db, catalog).valid, true);
    for (const starter of starterPlants) {
      assert.equal(catalog.find((p) => p.id === starter.id)?.name_zh, starter.nameZh);
    }
    for (const plant of catalog) {
      assert.ok(plant.summary && plant.appearance_features && plant.sources.length);
      if (plant.publication_status === 'published') {
        assert.equal(plant.identity_status, 'verified');
        assert.equal(plant.review.plantnet.status, 'confirmed');
        assert.ok(plant.sunlight_requirement && plant.watering_requirement);
        assert.ok(plant.sources.every((source) => source.review_status === 'approved'));
      }
    }
  } finally { db.close(); }
});

test('preflight does not write; import enriches starters, is idempotent and preserves UUIDs', () => {
  const db = database();
  try {
    seedStarterPlants(db);
    const before = db.prepare('SELECT * FROM plants ORDER BY id').all();
    const report = preflightCatalog(db, catalog);
    assert.equal(report.valid, true);
    assert.equal(report.inserted, 80);
    assert.equal(report.updated, 20);
    assert.deepEqual(db.prepare('SELECT * FROM plants ORDER BY id').all(), before);
    importCatalog(db, catalog);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM plants').get().n, 100);
    const snapshot = db.serialize();
    const repeat = importCatalog(db, catalog);
    assert.equal(repeat.inserted, 0);
    assert.equal(repeat.updated, 0);
    assert.deepEqual(db.serialize(), snapshot);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    assert.equal(db.pragma('integrity_check')[0].integrity_check, 'ok');
  } finally { db.close(); }
});

test('conflicting manual content and normalized names abort the entire import', () => {
  const db = database();
  try {
    seedStarterPlants(db);
    db.prepare('UPDATE plants SET summary = ? WHERE id = ?').run('人工资料', starterPlants[0].id);
    const before = db.serialize();
    assert.equal(preflightCatalog(db, catalog).valid, false);
    assert.throws(() => importCatalog(db, catalog), /conflict|预检/i);
    assert.deepEqual(db.serialize(), before);
    db.prepare('UPDATE plants SET summary = NULL WHERE id = ?').run(starterPlants[0].id);
    db.prepare('INSERT INTO plants (id, name_zh, scientific_name) VALUES (?, ?, ?)')
      .run('other', '其他记录', `  ${catalog[0].scientific_name.toUpperCase()}  `);
    assert.equal(preflightCatalog(db, catalog).valid, false);
    assert.throws(() => importCatalog(db, catalog));
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM plants').get().n, 21);
  } finally { db.close(); }
});

test('preflight rejects invalid identities, categories, sources, temperatures and publication evidence', () => {
  const mutations = [
    (p) => { p.id = 'not-a-uuid'; },
    (p) => { p.categories = ['unknown']; },
    (p) => { p.sources = []; },
    (p) => { p.sources[0].source_url = 'javascript:alert(1)'; },
    (p) => { p.temperature_min_c = 30; p.temperature_max_c = 10; },
    (p) => { p.identity_status = 'verified'; p.review.plantnet.status = 'unconfirmed'; },
    (p) => { p.publication_status = 'published'; p.summary = null; },
    (p) => { p.publication_status = 'published'; p.sources[0].review_status = 'unreviewed'; },
    (p) => { p.scientific_name = ' '; },
    (p) => { p.review.plantnet.scientificName = 'Different species'; p.identity_status = 'verified'; },
    (p) => { p.publication_status = 'published'; p.review.horticulture.status = 'unreviewed'; },
  ];
  const db = database();
  try {
    for (const mutate of mutations) {
      const plants = clone(catalog); mutate(plants[0]);
      assert.equal(preflightCatalog(db, plants).valid, false);
    }
    const duplicates = clone(catalog); duplicates[1].scientific_name = ` ${duplicates[0].scientific_name.toUpperCase()} `;
    assert.equal(preflightCatalog(db, duplicates).valid, false);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM plants').get().n, 0);
  } finally { db.close(); }
});

test('existing aliases, source edits and extra category relations are never silently overwritten', () => {
  const db = database();
  try {
    importCatalog(db, catalog);
    const first = catalog[0];
    db.prepare('UPDATE plant_sources SET source_name = ? WHERE plant_id = ?').run('人工修改来源', first.id);
    const before = db.serialize();
    assert.equal(preflightCatalog(db, catalog).valid, false);
    assert.throws(() => importCatalog(db, catalog));
    assert.deepEqual(db.serialize(), before);
  } finally { db.close(); }
});

test('rejects changed aliases, extra relations and conflicting UUIDs; SQL failure rolls back all writes', () => {
  for (const change of [
    (db, p) => db.prepare('INSERT INTO plant_aliases VALUES (?, ?, ?)').run(p.id, '人工别名', 'zh'),
    (db, p) => db.prepare('INSERT INTO plant_category_relations VALUES (?, ?)').run(p.id, 'cacti'),
    (db, p) => db.prepare('UPDATE plants SET scientific_name = ? WHERE id = ?').run('Another species', p.id),
  ]) {
    const db = database();
    try {
      importCatalog(db, catalog); change(db, catalog[0]); const before = db.serialize();
      assert.throws(() => importCatalog(db, catalog));
      assert.deepEqual(db.serialize(), before);
    } finally { db.close(); }
  }
  const db = database();
  try {
    db.exec("CREATE TRIGGER fail_sources BEFORE INSERT ON plant_sources BEGIN SELECT RAISE(ABORT, 'test failure'); END");
    assert.throws(() => importCatalog(db, catalog), /test failure/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM plants').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM plant_category_relations').get().n, 0);
  } finally { db.close(); }
});

test('supports the existing development alias schema with a required independent ID', () => {
  const db = database();
  try {
    db.exec(`DROP TABLE plant_aliases;
      CREATE TABLE plant_aliases (
        id TEXT PRIMARY KEY NOT NULL,
        plant_id TEXT NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
        alias TEXT NOT NULL COLLATE NOCASE, language TEXT, UNIQUE (plant_id, alias)
      )`);
    seedStarterPlants(db);
    importCatalog(db, catalog);
    assert.ok(db.prepare('SELECT COUNT(*) AS n FROM plant_aliases WHERE id IS NOT NULL').get().n > 0);
    assert.equal(importCatalog(db, catalog).unchanged, 100);
  } finally { db.close(); }
});
