const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { initializeDatabase } = require('../src/database');
const { catalog } = require('../src/plants/catalog');
const previous = require('../src/plants/data/indoor-balcony-v2-additions.json');
const additions = require('../src/plants/data/indoor-balcony-v3-additions.json');
const v4 = require('../src/plants/data/indoor-balcony-v4-additions.json');
const { normalizeScientificName } = require('../src/plants/match-identification');
const { preflightCatalog, importCatalog } = require('../src/plants/import-catalog');

test('v3 adds 50 new plants in the established category quotas without duplicating earlier species', () => {
  assert.equal(additions.length, 50);
  assert.equal(catalog.length, 250);
  assert.deepEqual(catalog.slice(100, 150), previous);
  assert.equal(new Set(catalog.map(plant => plant.id)).size, 250);
  assert.equal(new Set(catalog.map(plant => normalizeScientificName(plant.scientific_name))).size, 250);
  const counts = {};
  for (const plant of additions) {
    assert.match(plant.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.ok(plant.categories.includes(plant.selection_category));
    assert.ok(plant.name_en && plant.summary && plant.appearance_features);
    assert.ok(plant.sunlight_requirement && plant.watering_requirement);
    assert.ok(plant.sources.length >= (plant.publication_status === 'published' ? 2 : 1));
    counts[plant.selection_category] = (counts[plant.selection_category] || 0) + 1;
    if (plant.selection_category === 'cacti') assert.equal(plant.review.family, 'Cactaceae');
  }
  assert.deepEqual(counts, { ferns: 7, cacti: 7, flowers: 6, 'vegetables-fruits': 6,
    herbs: 6, shrubs: 6, groundcover: 6, 'edible-plants': 6 });
});

test('v3 plants have matching cover images with verified metadata', () => {
  const images = require('../src/plants/data/plant-images-v1.json');
  const sources = require('../src/plants/data/plant-images-v1-sources.json');
  assert.equal(images.length, 250);
  assert.equal(sources.length, 250);
  for (const plant of additions) {
    const rows = images.filter(image => image.plantId === plant.id);
    assert.equal(rows.length, 1, plant.name_zh);
    assert.equal(rows[0].scientificName, plant.scientific_name);
    assert.ok(rows[0].altText && rows[0].sourceUrl.startsWith('https://'));
    assert.equal(sources.filter(source => source.plantId === plant.id).length, 1);
  }
});

test('v3 catalog import preserves the earlier 150 plants and is idempotent', () => {
  const db = new Database(':memory:');
  try {
    initializeDatabase(db);
    const before = catalog.slice(0, 200);
    importCatalog(db, before);
    const snapshot = db.prepare('SELECT * FROM plants ORDER BY rowid').all();
    const report = preflightCatalog(db, catalog);
    assert.equal(report.valid, true, report.errors.join('\n'));
    assert.equal(report.inserted, 50);
    assert.equal(report.unchanged, 200);
    importCatalog(db, catalog);
    assert.deepEqual(db.prepare('SELECT * FROM plants ORDER BY rowid').all().slice(0, 200), snapshot);
    const serialized = db.serialize();
    const repeat = importCatalog(db, catalog);
    assert.equal(repeat.inserted, 0);
    assert.equal(repeat.unchanged, 250);
    assert.deepEqual(db.serialize(), serialized);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    assert.equal(db.pragma('integrity_check')[0].integrity_check, 'ok');
  } finally { db.close(); }
});
