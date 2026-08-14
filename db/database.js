const path = require('path');
const Database = require('better-sqlite3');

// Lives at the project root (same place the earlier campusdesk.db / -shm / -wal
// files were sitting), one level up from this db/ folder.
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '..', 'campusdesk.db');
const db = new Database(dbPath);

function initDb() {
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      college_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      hostel TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      college_id TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      requested_department TEXT,
      department TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS complaints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      complaint_code TEXT UNIQUE NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id),
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      officer TEXT NOT NULL,
      stage_index INTEGER NOT NULL DEFAULT 0,
      note TEXT NOT NULL,
      photo TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      otp TEXT NOT NULL,
      otp_expires_at INTEGER NOT NULL,
      otp_used INTEGER NOT NULL DEFAULT 0,
      attempts INTEGER NOT NULL DEFAULT 0,
      reset_token TEXT,
      token_expires_at INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_complaints_user ON complaints(user_id);
    CREATE INDEX IF NOT EXISTS idx_resets_user ON password_resets(user_id);
  `);

  // Lightweight migration: campusdesk.db files created before the
  // `attempts` column existed won't have it — add it if missing so
  // upgrading doesn't require deleting the database.
  const cols = db.prepare("PRAGMA table_info(password_resets)").all().map(c => c.name);
  if (!cols.includes('attempts')) {
    db.exec('ALTER TABLE password_resets ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0');
  }
}

module.exports = { db, initDb };
