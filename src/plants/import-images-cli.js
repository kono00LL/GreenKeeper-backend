require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { randomUUID } = require('node:crypto');
const { createConfiguredImageStorage } = require('../images/config');
const { preflightImages, importImages } = require('./import-images');

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => !['--check', '--apply', '--replace', '--allow-small', '--partial'].includes(arg)) ||
      args.includes('--check') === args.includes('--apply') || new Set(args).size !== args.length) {
    throw new Error('Usage: npm run plants:images -- --check|--apply [--replace] [--allow-small] [--partial]');
  }
  const apply = args.includes('--apply');
  const dataDirectory = path.resolve(process.env.DATA_DIRECTORY || path.join(__dirname, '..', '..', 'data'));
  const manifestPath = path.resolve(process.env.PLANT_IMAGES_MANIFEST || path.join(__dirname, 'data', 'plant-images-v1.json'));
  const baseDirectory = path.resolve(process.env.PLANT_IMAGES_DIRECTORY || dataDirectory);
  const databasePath = path.join(dataDirectory, 'greenkeeper.sqlite');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const db = new Database(databasePath, { readonly: !apply, fileMustExist: true });
  let backupPath = null;
  const recordCleanup = (pending) => {
    if (!pending?.length) return null;
    const filename = path.join(dataDirectory, 'plant-image-cleanup.jsonl');
    for (const item of pending) fs.appendFileSync(filename, JSON.stringify({ ...item, storage: process.env.IMAGE_STORAGE?.trim() || 'local', recordedAt: new Date().toISOString() }) + '\n');
    return filename;
  };
  try {
    db.pragma('foreign_keys = ON');
    const options = { baseDirectory, replace: args.includes('--replace'), allowSmall: args.includes('--allow-small'), partial: args.includes('--partial') };
    const report = await preflightImages(db, manifest, options);
    const { prepared, ...publicReport } = report;
    if (!report.valid) { console.log(JSON.stringify({ mode: apply ? 'apply' : 'check', ...publicReport }, null, 2)); process.exitCode = 1; return; }
    let result = {};
    if (apply) {
      if (!options.allowSmall && prepared.some(({ image, unchanged }) => image.lowResolution && !unchanged)) {
        throw new Error('Low-resolution images need review; rerun with --allow-small to accept them');
      }
      const imageStorage = createConfiguredImageStorage({ directory: path.join(dataDirectory, 'uploads') });
      const backups = path.join(dataDirectory, 'backups');
      fs.mkdirSync(backups, { recursive: true });
      backupPath = path.join(backups, `before-plant-images-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.sqlite`);
      await db.backup(backupPath);
      const backup = new Database(backupPath, { readonly: true, fileMustExist: true });
      try {
        if (backup.pragma('integrity_check')[0].integrity_check !== 'ok') throw new Error('Backup integrity check failed');
      } finally { backup.close(); }
      result = await importImages(db, manifest, { ...options, imageStorage });
      result.cleanupReportPath = recordCleanup(result.cleanupPending);
      result.foreignKeyErrors = db.pragma('foreign_key_check').length;
      result.integrityCheck = db.pragma('integrity_check')[0].integrity_check;
      if (result.foreignKeyErrors || result.integrityCheck !== 'ok') throw new Error('Database integrity check failed');
    }
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'check', backupPath, ...publicReport, ...result }, null, 2));
  } catch (error) {
    const cleanupReportPath = recordCleanup(error.cleanupPending);
    if (backupPath) console.error(`Database backup: ${backupPath}`);
    if (cleanupReportPath) console.error(`Pending image cleanup: ${cleanupReportPath}`);
    throw error;
  } finally { db.close(); }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
