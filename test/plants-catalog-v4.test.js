const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { initializeDatabase } = require('../src/database');
const { catalog } = require('../src/plants/catalog');
const additions = require('../src/plants/data/indoor-balcony-v4-additions.json');
const images = require('../src/plants/data/plant-images-v1.json');
const { normalizeScientificName } = require('../src/plants/match-identification');
const { preflightCatalog, importCatalog } = require('../src/plants/import-catalog');

test('v4 adds 50 fixed-UUID species with balanced category quotas and no duplicate scientific names', () => {
  assert.equal(additions.length, 50);
  assert.equal(catalog.length, 250);
  assert.equal(new Set(catalog.map((plant) => plant.id)).size, 250);
  assert.equal(new Set(catalog.map((plant) => normalizeScientificName(plant.scientific_name))).size, 250);
  const counts = {};
  for (const plant of additions) {
    assert.match(plant.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.equal(plant.identity_status, 'pending');
    assert.equal(plant.publication_status, 'draft');
    assert.ok(plant.summary && plant.appearance_features && plant.sunlight_requirement && plant.watering_requirement);
    counts[plant.selection_category] = (counts[plant.selection_category] || 0) + 1;
  }
  assert.deepEqual(counts, { ferns: 7, cacti: 7, flowers: 6, 'vegetables-fruits': 6,
    herbs: 6, shrubs: 6, groundcover: 6, 'edible-plants': 6 });
});

test('v4 entries each have one image manifest row and source metadata', () => {
  assert.equal(images.length, 250);
  for (const plant of additions) {
    const rows = images.filter((image) => image.plantId === plant.id);
    assert.equal(rows.length, 1, plant.name_zh);
    assert.equal(rows[0].nameZh, plant.name_zh);
    assert.equal(rows[0].scientificName, plant.scientific_name);
    assert.match(rows[0].sourceUrl, /^https:\/\//);
    assert.ok(rows[0].altText && rows[0].attribution);
  }
});

test('v4 catalog import is additive and repeatable', () => {
  const db = new Database(':memory:');
  try {
    initializeDatabase(db);
    const previous = catalog.slice(0, 200);
    importCatalog(db, previous);
    const before = db.prepare('SELECT * FROM plants ORDER BY rowid').all();
    const report = preflightCatalog(db, catalog);
    assert.equal(report.valid, true, report.errors.join('\n'));
    assert.equal(report.inserted, 50);
    assert.equal(report.unchanged, 200);
    importCatalog(db, catalog);
    assert.deepEqual(db.prepare('SELECT * FROM plants ORDER BY rowid').all().slice(0, 200), before);
    const repeat = importCatalog(db, catalog);
    assert.equal(repeat.inserted, 0);
    assert.equal(repeat.unchanged, 250);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    assert.equal(db.pragma('integrity_check')[0].integrity_check, 'ok');
  } finally { db.close(); }
});
