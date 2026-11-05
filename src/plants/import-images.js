const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const sharp = require('sharp');
const { initializePlantImageDatabase } = require('./database');

const MAX_IMAGE_SIDE = 1200;
const WEBP_QUALITY = 82;

function isText(value) { return typeof value === 'string' && value.trim().length > 0; }
function isHttpsUrl(value) {
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}
function normalizePath(baseDirectory, file) {
  if (!isText(file)) return null;
  const resolved = path.resolve(baseDirectory, file);
  const relative = path.relative(path.resolve(baseDirectory), resolved);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? resolved : null;
}

async function prepareImage(entry, baseDirectory) {
  const filename = normalizePath(baseDirectory, entry.file);
  if (!filename) throw new Error('file must stay inside the input directory');
  const input = await fs.readFile(filename);
  const metadata = await sharp(input, { failOn: 'warning' }).metadata();
  if (!['jpeg', 'png', 'webp'].includes(metadata.format)) throw new Error('only JPEG, PNG and WebP are supported');
  if (!metadata.width || !metadata.height) throw new Error('image dimensions are missing');
  if (metadata.pages > 1) throw new Error('animated or multi-page images are not supported');
  const pipeline = sharp(input, { failOn: 'warning' }).rotate();
  if (metadata.width > MAX_IMAGE_SIDE || metadata.height > MAX_IMAGE_SIDE) {
    pipeline.resize({ width: MAX_IMAGE_SIDE, height: MAX_IMAGE_SIDE, fit: 'inside', withoutEnlargement: true });
  }
  const buffer = await pipeline.webp({ quality: WEBP_QUALITY }).toBuffer();
  const output = await sharp(buffer).metadata();
  return {
    buffer,
    width: output.width,
    height: output.height,
    size: buffer.length,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    lowResolution: Math.max(output.width, output.height) < MAX_IMAGE_SIDE,
  };
}

function validateEntry(entry, plantsById, seenIds) {
  const errors = [];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return ['entry must be an object'];
  if (!isText(entry.plantId)) errors.push('plantId is required');
  else if (seenIds.has(entry.plantId)) errors.push(`duplicate plantId ${entry.plantId}`);
  const plant = plantsById.get(entry.plantId);
  if (!plant) errors.push(`unknown plant ${entry.plantId}`);
  if (plant && entry.nameZh !== plant.nameZh) errors.push(`${entry.plantId}: nameZh does not match database`);
  if (plant && entry.scientificName !== plant.scientificName) errors.push(`${entry.plantId}: scientificName does not match database`);
  if (!isText(entry.file)) errors.push(`${entry.plantId || 'unknown'}: file is required`);
  if (!isText(entry.sourceName)) errors.push(`${entry.plantId || 'unknown'}: sourceName is required`);
  if (!isHttpsUrl(entry.sourceUrl)) errors.push(`${entry.plantId || 'unknown'}: sourceUrl must be HTTPS`);
  if (!isText(entry.license)) errors.push(`${entry.plantId || 'unknown'}: license is required`);
  if (!isText(entry.attribution)) errors.push(`${entry.plantId || 'unknown'}: attribution is required`);
  if (entry.altText != null && typeof entry.altText !== 'string') errors.push(`${entry.plantId || 'unknown'}: altText must be text`);
  if (entry.licenseUrl !== null && entry.licenseUrl !== undefined && !isHttpsUrl(entry.licenseUrl)) errors.push(`${entry.plantId || 'unknown'}: licenseUrl must be HTTPS`);
  if (!isText(entry.checkedAt) || !Number.isFinite(Date.parse(entry.checkedAt))) errors.push(`${entry.plantId || 'unknown'}: checkedAt must be a valid date`);
  return errors;
}

function existingCovers(db) {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'plant_images'").get();
  return exists ? db.prepare("SELECT * FROM plant_images WHERE image_type = 'cover'").all() : [];
}

async function preflightImages(db, manifest, { baseDirectory, replace = false, partial = false }) {
  const plants = db.prepare('SELECT id, name_zh AS nameZh, scientific_name AS scientificName FROM plants').all();
  const plantsById = new Map(plants.map((plant) => [plant.id, plant]));
  const errors = [];
  const existingRows = existingCovers(db);
  if (!Array.isArray(manifest)) return { valid: false, totalPlants: plants.length, ready: 0, missing: plants.length, invalid: 1, existing: existingRows.length, conflicts: 0, errors: ['manifest must be an array'], warnings: [] };
  const seen = new Set();
  if (partial && manifest.length === 0) errors.push('partial image manifest must not be empty');
  const prepared = [];
  const hashes = new Map();
  const warnings = [];
  let invalid = 0;
  for (const entry of manifest) {
    const entryErrors = validateEntry(entry, plantsById, seen);
    if (entryErrors.length) errors.push(...entryErrors);
    if (entry?.plantId) seen.add(entry.plantId);
    if (!entryErrors.length) {
      try {
        const image = await prepareImage(entry, baseDirectory);
        if (hashes.has(image.sha256)) throw new Error(`duplicate image also used by ${hashes.get(image.sha256)}`);
        hashes.set(image.sha256, entry.plantId);
        prepared.push({ entry, image });
        if (image.lowResolution) warnings.push(`${entry.plantId}: image is ${image.width}x${image.height}, below the recommended ${MAX_IMAGE_SIDE}px long edge`);
      }
      catch (error) { invalid += 1; errors.push(`${entry.plantId}: ${error.message}`); }
    } else {
      invalid += 1;
    }
  }
  const missing = plants.filter((plant) => !seen.has(plant.id));
  if (!partial) missing.forEach((plant) => errors.push(`${plant.id}: missing image manifest entry`));
  const existing = new Map(existingRows.map((row) => [row.plant_id, row]));
  let conflicts = 0;
  for (const item of prepared) {
    const row = existing.get(item.entry.plantId);
    item.unchanged = row?.sha256 === item.image.sha256;
    if (row && row.sha256 !== item.image.sha256) {
      conflicts += 1;
      if (!replace) errors.push(`${item.entry.plantId}: existing cover differs; rerun with --replace to replace it`);
    }
  }
  return {
    valid: errors.length === 0,
    totalPlants: plants.length,
    ready: prepared.length,
    missing: partial ? 0 : missing.length,
    outOfScope: partial ? missing.length : 0,
    scope: partial ? 'manifest' : 'all',
    invalid,
    existing: existingRows.length,
    conflicts,
    errors,
    warnings,
    prepared,
  };
}

async function cleanupImages(imageStorage, keys) {
  const pending = [];
  for (const key of keys) {
    try { await imageStorage.delete(key); }
    catch (error) { pending.push({ key, error: error.message }); }
  }
  return pending;
}

async function importImages(db, manifest, { baseDirectory, imageStorage, replace = false, partial = false, allowSmall = false, now = new Date().toISOString() }) {
  const report = await preflightImages(db, manifest, { baseDirectory, replace, partial });
  if (!report.valid) throw new Error(`Plant image preflight failed:\n${report.errors.join('\n')}`);
  const existing = new Map(existingCovers(db).map((row) => [row.plant_id, row]));
  const changed = report.prepared.filter(({ entry, image }) => existing.get(entry.plantId)?.sha256 !== image.sha256);
  if (!allowSmall && changed.some(({ image }) => image.lowResolution)) throw new Error('Low-resolution images need review; rerun with --allow-small to accept them');
  if (typeof imageStorage?.save !== 'function' || typeof imageStorage?.delete !== 'function') throw new Error('Image storage must support save() and delete()');
  const toDelete = [];
  const uploaded = [];
  const rows = [];
  const results = { inserted: 0, unchanged: 0, replaced: 0 };
  try {
    for (const { entry, image } of report.prepared) {
      const current = existing.get(entry.plantId);
      if (current?.sha256 === image.sha256) { results.unchanged += 1; continue; }
      if (current && !replace) throw new Error(`${entry.plantId}: existing cover differs; rerun with --replace to replace it`);
      const saved = await imageStorage.save(image.buffer, 'webp');
      uploaded.push(saved.key);
      rows.push({
        id: current?.id || randomUUID(), plantId: entry.plantId, storageKey: saved.key,
        mimeType: 'image/webp', width: image.width, height: image.height, fileSize: image.size,
        sha256: image.sha256, altText: entry.altText || null, sourceName: entry.sourceName,
        sourceUrl: entry.sourceUrl, license: entry.license, licenseUrl: entry.licenseUrl || null,
        attribution: entry.attribution || null, checkedAt: entry.checkedAt, createdAt: current?.created_at || now, updatedAt: now,
      });
      if (current) toDelete.push(current.storage_key);
      current ? results.replaced += 1 : results.inserted += 1;
    }
    db.transaction(() => {
      initializePlantImageDatabase(db);
      // Reject a changed database instead of overwriting work done during uploads.
      const latest = existingCovers(db);
      const snapshot = new Map(latest.map((row) => [row.plant_id, row]));
      for (const { entry } of report.prepared) {
        const plant = db.prepare('SELECT name_zh, scientific_name FROM plants WHERE id = ?').get(entry.plantId);
        if (!plant || plant.name_zh !== entry.nameZh || plant.scientific_name !== entry.scientificName ||
          JSON.stringify(snapshot.get(entry.plantId)) !== JSON.stringify(existing.get(entry.plantId))) {
          throw new Error('Database changed during image import; rerun preflight');
        }
      }
      const upsert = db.prepare(`INSERT INTO plant_images
        (id, plant_id, image_type, storage_key, mime_type, width, height, file_size, sha256, alt_text,
         source_name, source_url, license, license_url, attribution, checked_at, sort_order, created_at, updated_at)
        VALUES (@id, @plantId, 'cover', @storageKey, @mimeType, @width, @height, @fileSize, @sha256, @altText,
         @sourceName, @sourceUrl, @license, @licenseUrl, @attribution, @checkedAt, 0, @createdAt, @updatedAt)
        ON CONFLICT(id) DO UPDATE SET
          storage_key = excluded.storage_key, mime_type = excluded.mime_type, width = excluded.width, height = excluded.height,
          file_size = excluded.file_size, sha256 = excluded.sha256, alt_text = excluded.alt_text, source_name = excluded.source_name,
          source_url = excluded.source_url, license = excluded.license, license_url = excluded.license_url, attribution = excluded.attribution,
          checked_at = excluded.checked_at, updated_at = excluded.updated_at, sort_order = 0`);
      rows.forEach((row) => upsert.run(row));
      if (db.pragma('foreign_key_check').length || db.pragma('integrity_check')[0].integrity_check !== 'ok') throw new Error('Database integrity check failed');
    })();
  } catch (error) {
    error.cleanupPending = await cleanupImages(imageStorage, uploaded);
    throw error;
  }
  results.cleanupPending = await cleanupImages(imageStorage, toDelete);
  return results;
}

module.exports = { MAX_IMAGE_SIDE, preflightImages, importImages, prepareImage };
