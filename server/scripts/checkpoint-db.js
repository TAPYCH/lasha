'use strict';

/**
 * Сливает WAL в users.db перед коммитом в Git (иначе не попадут последние изменения).
 * Запуск: из папки server — npm run db:checkpoint
 * Останови сервер или не делай параллельных записей в БД.
 */

const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, '..', 'data', 'users.db');
const db = new Database(dbPath);
try {
  db.pragma('wal_checkpoint(FULL)');
  console.log('OK: wal_checkpoint(FULL) для', dbPath);
} finally {
  db.close();
}
