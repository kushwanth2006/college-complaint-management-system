const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL must be set to a PostgreSQL connection URL.');
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Translate the SQLite-style placeholders used by the original app into
// PostgreSQL parameter placeholders. Values always remain parameterized.
function postgresQuery(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

const db = {
  async get(sql, ...params) {
    const result = await pool.query(postgresQuery(sql), params);
    return result.rows[0];
  },
  async all(sql, ...params) {
    const result = await pool.query(postgresQuery(sql), params);
    return result.rows;
  },
  async run(sql, ...params) {
    const result = await pool.query(postgresQuery(sql), params);
    return { changes: result.rowCount, lastInsertRowid: result.rows[0]?.id };
  }
};

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      college_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      hostel TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      college_id TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      requested_department TEXT,
      department TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS complaints (
      id SERIAL PRIMARY KEY,
      complaint_code TEXT UNIQUE NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id),
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      officer TEXT NOT NULL,
      stage_index INTEGER NOT NULL DEFAULT 0,
      note TEXT NOT NULL,
      photo TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      otp TEXT NOT NULL,
      otp_expires_at INTEGER NOT NULL,
      otp_used INTEGER NOT NULL DEFAULT 0,
      attempts INTEGER NOT NULL DEFAULT 0,
      reset_token TEXT,
      token_expires_at INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_complaints_user ON complaints(user_id);
    CREATE INDEX IF NOT EXISTS idx_resets_user ON password_resets(user_id);
  `);

}

module.exports = { db, initDb, pool };
