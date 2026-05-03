'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

let dbInstance;

function getDb() {
  if (dbInstance) return dbInstance;

  const dir = path.join(__dirname, 'data');
  fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, 'users.db');

  dbInstance = new Database(dbPath);
  dbInstance.pragma('journal_mode = WAL');
  dbInstance.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL CHECK (role IN ('tourist', 'guide')),
      login TEXT UNIQUE NOT NULL COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT,
      passport_url TEXT,
      selfie_url TEXT,
      avatar_url TEXT,
      guide_status TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_users_login ON users(login);
  `);

  return dbInstance;
}

module.exports = { getDb };
