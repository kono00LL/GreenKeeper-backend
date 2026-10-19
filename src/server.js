require('dotenv').config();
const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');
const { initializeDatabase } = require('./database');
const { createApp } = require('./app');

const dataDirectory = process.env.DATA_DIRECTORY || path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDirectory, { recursive: true });
const db = new Database(path.join(dataDirectory, 'greenkeeper.sqlite'));
initializeDatabase(db);

const app = createApp({ db });
const port = Number(process.env.PORT || 8080);
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`GreenKeeper API listening on http://localhost:${port}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
