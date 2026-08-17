const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

// One row per device — every new reading overwrites the previous one
// for that device_id, rather than piling up a history table. Good for
// "what's the current state right now" dashboards; if you need history
// or graphing over time, you'd add a separate append-only readings_log
// table instead of (or alongside) this one.
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // A device is "claimed" by whichever user registers its device_id first.
  // The ESP32 itself never logs in — it just posts to /readings with a
  // device_id. That device_id has to already be registered to a user
  // for the reading to be accepted, which is what scopes data per account.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS devices (
      device_id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      nickname TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS readings (
      device_id TEXT PRIMARY KEY REFERENCES devices(device_id) ON DELETE CASCADE,
      voltage NUMERIC,
      current NUMERIC,
      power NUMERIC,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  console.log("Database tables ready");
}

module.exports = { pool, initDb };
