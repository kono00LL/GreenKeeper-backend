require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { initializePlantDatabase } = require('./database');
const { seedStarterPlants } = require('./seed-starter');
const { starterPlants } = require('./starter-plants');

async function main() {
  const dataDirectory = path.resolve(process.env.DATA_DIRECTORY || path.join(__dirname, '..', '..', 'data'));
  const databasePath = path.join(dataDirectory, 'greenkeeper.sqlite');
  const db = new Database(databasePath, { fileMustExist: true });
  try {
    db.pragma('foreign_keys = ON');
    const backupDirectory = path.join(dataDirectory, 'backups');
    fs.mkdirSync(backupDirectory, { recursive: true });
    const backupName = `greenkeeper-before-starter-plants-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`;
    const backupPath = path.join(backupDirectory, backupName);
    await db.backup(backupPath);
    const backup = new Database(backupPath, { readonly: true, fileMustExist: true });
    try {
      if (backup.pragma('integrity_check')[0].integrity_check !== 'ok') {
        throw new Error('SQLite backup integrity check failed');
      }
    } finally {
      backup.close();
    }

    initializePlantDatabase(db);
    const result = seedStarterPlants(db);
    const counts = {
      starterPlants: db.prepare('SELECT COUNT(*) AS count FROM plants WHERE id IN (' + starterPlants.map(() => '?').join(',') + ')')
        .get(...starterPlants.map((plant) => plant.id)).count,
      pending: db.prepare("SELECT COUNT(*) AS count FROM plants WHERE identity_status = 'pending'").get().count,
      categoryLinks: db.prepare('SELECT COUNT(*) AS count FROM plant_category_relations').get().count,
    };
    if (counts.starterPlants !== starterPlants.length) throw new Error('Starter plant verification failed');
    if (db.pragma('foreign_key_check').length) throw new Error('Plant foreign key check failed');
    if (db.pragma('integrity_check')[0].integrity_check !== 'ok') throw new Error('SQLite integrity check failed');
    console.log(JSON.stringify({ databasePath, backupPath, ...result, counts }, null, 2));
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
