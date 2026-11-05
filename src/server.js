require('dotenv').config();
const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');
const { initializeDatabase } = require('./database');
const { createApp } = require('./app');
const { createConfiguredImageStorage } = require('./images/config');
const { errorDetails } = require('./diagnostics');

const dataDirectory = process.env.DATA_DIRECTORY || path.join(__dirname, '..', 'data');
const uploadDirectory = path.join(dataDirectory, 'uploads');
const imageStorage = createConfiguredImageStorage({ directory: uploadDirectory });
fs.mkdirSync(dataDirectory, { recursive: true });
const db = new Database(path.join(dataDirectory, 'greenkeeper.sqlite'));
initializeDatabase(db);

const app = createApp({ db, uploadDirectory, imageStorage, uploadTempDirectory: path.join(dataDirectory, '.uploads-tmp') });
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
process.on('uncaughtException', (error) => {
  logProcessError('uncaughtException', error);
});
process.on('unhandledRejection', (reason) => {
  logProcessError('unhandledRejection', reason);
});

function logProcessError(event, error) {
  if (process.env.NODE_ENV === 'production') {
    console.error(JSON.stringify({ event }));
    return;
  }
  console.error(JSON.stringify({ event, error: errorDetails(error) }));
}
