require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { catalog } = require('./catalog');
const { preflightCatalog, importCatalog } = require('./import-catalog');

async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => !['--apply'].includes(arg))) throw new Error('Usage: npm run plants:catalog -- [--apply]');
  const apply = args.includes('--apply');
  const directory = path.resolve(process.env.DATA_DIRECTORY || path.join(__dirname, '..', '..', 'data'));
  const db = new Database(path.join(directory, 'greenkeeper.sqlite'), { readonly: !apply, fileMustExist: true });
  try {
    db.pragma('foreign_keys = ON');
    const { actions, ...report } = preflightCatalog(db, catalog);
    if (!report.valid) { console.log(JSON.stringify(report, null, 2)); process.exitCode = 1; return; }
    let backupPath = null;
    if (apply && report.inserted + report.updated > 0) {
      const backups = path.join(directory, 'backups');
      fs.mkdirSync(backups, { recursive: true });
      backupPath = path.join(backups, `before-plant-catalog-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
      await db.backup(backupPath);
      const backup = new Database(backupPath, { readonly: true, fileMustExist: true });
      try { if (backup.pragma('integrity_check')[0].integrity_check !== 'ok') throw new Error('Backup integrity check failed'); }
      finally { backup.close(); }
      importCatalog(db, catalog);
      if (db.pragma('foreign_key_check').length || db.pragma('integrity_check')[0].integrity_check !== 'ok') throw new Error('Database integrity check failed');
    }
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', backupPath, ...report }, null, 2));
  } finally { db.close(); }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
