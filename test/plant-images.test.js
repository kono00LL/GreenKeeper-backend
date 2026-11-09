const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const Database = require('better-sqlite3');
const { initializeDatabase } = require('../src/database');
const { preflightImages, importImages } = require('../src/plants/import-images');

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'greenkeeper-plant-images-'));
  const db = new Database(':memory:');
  initializeDatabase(db);
  const plantId = crypto.randomUUID();
  db.prepare('INSERT INTO plants (id, scientific_name, name_zh) VALUES (?, ?, ?)').run(plantId, 'Testus plantus', '测试植物');
  const input = path.join(directory, 'incoming');
  await fs.mkdir(input);
  const file = path.join(input, 'test.jpg');
  await fs.writeFile(file, await sharp({ create: { width: 32, height: 20, channels: 3, background: '#4caf50' } }).jpeg().toBuffer());
  const entry = { plantId, nameZh: '测试植物', scientificName: 'Testus plantus', file: 'incoming/test.jpg', sourceName: 'Test source', sourceUrl: 'https://example.com/test', license: 'CC0', licenseUrl: null, attribution: '测试作者', altText: '测试植物', checkedAt: '2026-01-01T00:00:00.000Z' };
  return { directory, db, entry, input };
}

test('preflight validates the complete image manifest without writing', async (t) => {
  const { directory, db, entry } = await fixture();
  t.after(async () => { db.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const report = await preflightImages(db, [entry], { baseDirectory: directory });
  assert.equal(report.valid, true);
  assert.equal(report.ready, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM plant_images').get().count, 0);
});

test('preflight rejects missing plants and incomplete source metadata', async (t) => {
  const { directory, db, entry } = await fixture();
  t.after(async () => { db.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const report = await preflightImages(db, [{ ...entry, plantId: crypto.randomUUID(), sourceUrl: '' }], { baseDirectory: directory });
  assert.equal(report.valid, false);
  assert.ok(report.errors.some((error) => /unknown plant|source_url/i.test(error)));
});

test('partial import explicitly scopes the manifest while preserving strict full-library checks', async (t) => {
  const { directory, db, entry, options, saved } = await setup(t);
  db.prepare('INSERT INTO plants (id, name_zh, scientific_name) VALUES (?, ?, ?)').run('unselected', '未选植物', 'Unselected species');
  assert.equal((await preflightImages(db, [entry], { baseDirectory: directory })).valid, false);
  const report = await preflightImages(db, [entry], { baseDirectory: directory, partial: true });
  assert.equal(report.valid, true);
  assert.equal(report.totalPlants, 2);
  assert.equal(report.ready, 1);
  assert.equal(report.outOfScope, 1);
  assert.equal(report.missing, 0);
  for (const manifest of [[], [entry, entry], [{ ...entry, plantId: 'unknown' }], [{ ...entry, scientificName: 'Wrong species' }]]) {
    assert.equal((await preflightImages(db, manifest, { baseDirectory: directory, partial: true })).valid, false);
  }
  await importImages(db, [entry], { ...options, partial: true });
  assert.equal(saved.size, 1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM plant_images WHERE plant_id = ?').get('unselected').n, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM plants').get().n, 2);
});

test('imports a cover image idempotently and exposes prepared metadata', async (t) => {
  const { directory, db, entry } = await fixture();
  const stored = new Map();
  const storage = {
    async save(buffer, extension) { const key = `${stored.size + 1}.${extension}`; stored.set(key, buffer); return { key, url: `/uploads/${key}` }; },
    async delete(key) { stored.delete(key); },
  };
  t.after(async () => { db.close(); await fs.rm(directory, { recursive: true, force: true }); });
  const first = await importImages(db, [entry], { baseDirectory: directory, imageStorage: storage, allowSmall: true, now: '2026-01-02T00:00:00.000Z' });
  const second = await importImages(db, [entry], { baseDirectory: directory, imageStorage: storage, allowSmall: true, now: '2026-01-02T00:00:00.000Z' });
  assert.equal(first.inserted, 1);
  assert.equal(second.unchanged, 1);
  assert.equal(stored.size, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM plant_images').get().count, 1);
  assert.equal(db.prepare('SELECT mime_type FROM plant_images').get().mime_type, 'image/webp');
});

async function setup(t) {
  const fixtureData = await fixture();
  t.after(async () => { fixtureData.db.close(); await fs.rm(fixtureData.directory, { recursive: true, force: true }); });
  const saved = new Map();
  let uploads = 0;
  const imageStorage = {
    async save(buffer) { const key = `${++uploads}.webp`; saved.set(key, buffer); return { key }; },
    async delete(key) { saved.delete(key); },
  };
  return { ...fixtureData, saved, imageStorage, options: { baseDirectory: fixtureData.directory, imageStorage, allowSmall: true } };
}

test('preflight rejects incomplete, duplicate, mismatched and corrupt entries without writes', async (t) => {
  const { db, directory, entry } = await setup(t);
  const before = db.serialize();
  const original = await fs.readFile(path.join(directory, entry.file));
  for (const manifest of [
    null, [], [null], [entry, entry], [{ ...entry, plantId: 'unknown' }],
    [{ ...entry, nameZh: '别的植物' }], [{ ...entry, scientificName: 'Different species' }],
    [{ ...entry, file: 'missing.jpg' }], [{ ...entry, file: '../outside.jpg' }],
    ...['sourceName', 'sourceUrl', 'license', 'attribution', 'checkedAt'].map((key) => [{ ...entry, [key]: '' }]),
    [{ ...entry, sourceUrl: 'http://example.com/photo' }], [{ ...entry, licenseUrl: 'http://example.com/license' }],
  ]) {
    const result = await preflightImages(db, manifest, { baseDirectory: directory });
    assert.equal(result.valid, false, JSON.stringify(manifest));
  }
  await fs.writeFile(path.join(directory, 'broken.jpg'), 'broken image bytes');
  assert.equal((await preflightImages(db, [{ ...entry, file: 'broken.jpg' }], { baseDirectory: directory })).valid, false);
  assert.deepEqual(db.serialize(), before);
  assert.deepEqual(await fs.readFile(path.join(directory, entry.file)), original);
});

test('preflight counts invalid records rather than error messages and reports low resolution', async (t) => {
  const { db, directory, entry } = await setup(t);
  const invalid = await preflightImages(db, [{ ...entry, license: '', sourceUrl: '' }], { baseDirectory: directory });
  assert.equal(invalid.invalid, 1);
  const report = await preflightImages(db, [entry], { baseDirectory: directory });
  assert.equal(report.warnings.length, 1);
  await assert.rejects(importImages(db, [entry], { baseDirectory: directory, imageStorage: { save() { assert.fail('must not upload'); } } }), /allow-small/);
});

test('blocks all uploads on replacement conflicts and allows explicit replacement after commit', async (t) => {
  const { db, directory, entry, options, saved } = await setup(t);
  await importImages(db, [entry], options);
  const old = db.prepare('SELECT * FROM plant_images').get();
  await fs.writeFile(path.join(directory, entry.file), await sharp({ create: { width: 50, height: 30, channels: 3, background: '#000000' } }).png().toBuffer());
  const report = await preflightImages(db, [entry], { baseDirectory: directory });
  assert.equal(report.conflicts, 1);
  assert.equal(report.valid, false);
  const unknown = crypto.randomUUID();
  db.prepare('INSERT INTO plants (id, scientific_name, name_zh) VALUES (?, ?, ?)').run(unknown, 'Second species', '第二株');
  await fs.writeFile(path.join(directory, 'second.png'), await sharp({ create: { width: 60, height: 40, channels: 3, background: '#ffffff' } }).png().toBuffer());
  const manifest = [{ ...entry, plantId: unknown, nameZh: '第二株', scientificName: 'Second species', file: 'second.png' }, entry];
  await assert.rejects(importImages(db, manifest, { ...options, imageStorage: { save() { assert.fail('preflight must finish before upload'); } } }), /replace/);
  const deleted = [];
  const result = await importImages(db, manifest, { ...options, replace: true, imageStorage: {
    ...options.imageStorage,
    async delete(key) {
      assert.notEqual(db.prepare('SELECT storage_key FROM plant_images WHERE plant_id = ?').get(entry.plantId).storage_key, key);
      deleted.push(key); saved.delete(key);
    },
  } });
  assert.equal(result.replaced, 1);
  assert.equal(result.inserted, 1);
  assert.deepEqual(deleted, [old.storage_key]);
  assert.equal(saved.size, 2);
});

test('upload and transaction failures roll back all rows and clean uploaded files', async (t) => {
  const { db, entry, options, saved } = await setup(t);
  await assert.rejects(importImages(db, [entry], { ...options, imageStorage: { ...options.imageStorage, async save() { throw new Error('storage unavailable'); } } }), /storage unavailable/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM plant_images').get().n, 0);
  db.exec("CREATE TRIGGER reject_image BEFORE INSERT ON plant_images BEGIN SELECT RAISE(ABORT, 'write failed'); END");
  await assert.rejects(importImages(db, [entry], options), /write failed/);
  assert.equal(saved.size, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM plant_images').get().n, 0);
});

test('cleanup failures are reported without rolling back a committed replacement', async (t) => {
  const { db, directory, entry, options } = await setup(t);
  await importImages(db, [entry], options);
  const old = db.prepare('SELECT storage_key FROM plant_images').get().storage_key;
  await fs.writeFile(path.join(directory, entry.file), await sharp({ create: { width: 50, height: 30, channels: 3, background: '#000000' } }).jpeg().toBuffer());
  const result = await importImages(db, [entry], { ...options, replace: true, imageStorage: { ...options.imageStorage, async delete() { throw new Error('cannot delete'); } } });
  assert.equal(result.replaced, 1);
  assert.equal(result.cleanupPending[0].key, old);
  assert.notEqual(db.prepare('SELECT storage_key FROM plant_images').get().storage_key, old);
});

test('replaces a cover with a nonzero sort order while preserving its identity', async (t) => {
  const { db, directory, entry, options } = await setup(t);
  await importImages(db, [entry], options);
  const old = db.prepare('SELECT * FROM plant_images').get();
  db.prepare('UPDATE plant_images SET sort_order = 5').run();
  await fs.writeFile(path.join(directory, entry.file), await sharp({ create: { width: 80, height: 50, channels: 3, background: '#ff0000' } }).jpeg().toBuffer());
  const result = await importImages(db, [entry], { ...options, replace: true });
  assert.equal(result.replaced, 1);
  assert.equal(db.prepare('SELECT id FROM plant_images').get().id, old.id);
});

test('a later upload failure cleans earlier uploads and a later SQL failure rolls back earlier rows', async (t) => {
  const { db, entry, directory, options, saved, imageStorage } = await setup(t);
  db.prepare('INSERT INTO plants (id, scientific_name, name_zh) VALUES (?, ?, ?)').run('second', 'Second species', '第二株');
  await fs.writeFile(path.join(directory, 'second.png'), await sharp({ create: { width: 30, height: 20, channels: 3, background: '#ffffff' } }).png().toBuffer());
  const manifest = [entry, { ...entry, plantId: 'second', nameZh: '第二株', scientificName: 'Second species', file: 'second.png' }];
  let calls = 0;
  await assert.rejects(importImages(db, manifest, { ...options, imageStorage: { ...imageStorage, async save(buffer) {
    if (++calls === 2) throw new Error('second upload failed');
    return imageStorage.save(buffer);
  } } }), /second upload failed/);
  assert.equal(saved.size, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM plant_images').get().n, 0);
  db.exec("CREATE TRIGGER reject_second BEFORE INSERT ON plant_images WHEN NEW.plant_id = 'second' BEGIN SELECT RAISE(ABORT, 'second SQL failed'); END");
  await assert.rejects(importImages(db, manifest, options), /second SQL failed/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM plant_images').get().n, 0);
  assert.equal(saved.size, 0);
});

test('preflight rejects the same decoded cover assigned to different plants', async (t) => {
  const { db, entry, directory } = await setup(t);
  db.prepare('INSERT INTO plants (id, scientific_name, name_zh) VALUES (?, ?, ?)').run('second', 'Second species', '第二株');
  const report = await preflightImages(db, [entry, { ...entry, plantId: 'second', nameZh: '第二株', scientificName: 'Second species' }], { baseDirectory: directory });
  assert.equal(report.valid, false);
  assert.ok(report.errors.some((message) => message.includes('duplicate image')));
});

test('supports a read-only preflight on databases predating plant_images', async (t) => {
  const { db, directory, entry, options } = await setup(t);
  db.exec('DROP TABLE plant_images');
  assert.equal((await preflightImages(db, [entry], { baseDirectory: directory })).valid, true);
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'plant_images'").get(), undefined);
  await importImages(db, [entry], options);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM plant_images').get().n, 1);
});
