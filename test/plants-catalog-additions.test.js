const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { initializeDatabase } = require('../src/database');
const { catalog } = require('../src/plants/catalog');
const original = require('../src/plants/data/indoor-balcony-v1.json');
const additions = require('../src/plants/data/indoor-balcony-v2-additions.json');
const v2Catalog = [...original, ...additions];
const { normalizeScientificName } = require('../src/plants/match-identification');
const { matchLocalPlant } = require('../src/plants/match-identification');
const { preflightCatalog, importCatalog } = require('../src/plants/import-catalog');

test('adds v2 50 distinct species with fixed UUIDs and balanced selection categories, preserving v1', () => {
  assert.equal(additions.length, 50);
  assert.equal(catalog.length, 250);
  assert.deepEqual(catalog.slice(0, 100), original);
  assert.deepEqual(catalog.slice(0, 150), v2Catalog);
  assert.equal(new Set(v2Catalog.map(p => p.id)).size, 150);
  assert.equal(new Set(v2Catalog.map(p => normalizeScientificName(p.scientific_name))).size, 150);
  const counts = {};
  for (const plant of additions) {
    assert.match(plant.id, /^[0-9a-f-]{36}$/);
    assert.ok(plant.categories.includes(plant.selection_category));
    counts[plant.selection_category] = (counts[plant.selection_category] || 0) + 1;
    assert.ok(plant.name_en && plant.summary && plant.appearance_features);
    assert.ok(plant.sunlight_requirement && plant.watering_requirement);
    assert.ok(plant.sources.length >= 2);
    if (plant.selection_category === 'cacti') assert.equal(plant.review.family, 'Cactaceae');
  }
  assert.deepEqual(counts, { ferns: 7, cacti: 7, flowers: 6, 'vegetables-fruits': 6,
    herbs: 6, shrubs: 6, groundcover: 6, 'edible-plants': 6 });
});

test('every new species has one cover manifest entry and can match an identification by scientific name', () => {
  const images = require('../src/plants/data/plant-images-v1.json');
  assert.equal(images.length, 250);
  assert.equal(new Set(images.slice(0, 150).map(image => image.plantId)).size, 150);
  const localPlants = catalog.map(p => ({ id: p.id, nameZh: p.name_zh, scientificName: p.scientific_name,
    identityStatus: p.identity_status, publicationStatus: p.publication_status }));
  for (const plant of additions) {
    const entries = images.filter(image => image.plantId === plant.id);
    assert.equal(entries.length, 1, plant.name_zh);
    const image = entries[0];
    assert.equal(image.scientificName, plant.scientific_name);
    assert.equal(image.nameZh, plant.name_zh);
    assert.ok(image.altText && image.attribution && image.sourceUrl.startsWith('https://'));
    const match = matchLocalPlant(plant.scientific_name, localPlants);
    assert.equal(match.status, plant.publication_status === 'published' ? 'matched' : 'not_ready');
    if (match.plant) assert.equal(match.plant.id, plant.id);
  }
});

test('imports additions without changing the existing 100 plants, and repeat import makes no changes', () => {
  const db = new Database(':memory:');
  try {
    initializeDatabase(db);
    importCatalog(db, original);
    const tables = ['plants', 'plant_aliases', 'plant_category_relations', 'plant_sources'];
    const snapshots = new Map(tables.map(table => [table, db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
    const report = preflightCatalog(db, v2Catalog);
    assert.equal(report.valid, true, report.errors.join('\n'));
    assert.equal(report.inserted, 50);
    assert.equal(report.unchanged, 100);
    importCatalog(db, v2Catalog);
    for (const table of tables) {
      const rows = db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
      assert.deepEqual(rows.slice(0, snapshots.get(table).length), snapshots.get(table));
    }
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM plants').get().n, 150);
    const snapshot = db.serialize();
    const repeat = importCatalog(db, v2Catalog);
    assert.equal(repeat.inserted, 0);
    assert.equal(repeat.unchanged, 150);
    assert.deepEqual(db.serialize(), snapshot);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    assert.equal(db.pragma('integrity_check')[0].integrity_check, 'ok');
  } finally { db.close(); }
});
