const { Pool } = require("pg");

types.setTypeParser(1700, (val) => (val === null ? null : parseFloat(val)));

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

  // Added a thresholds
  await pool.query(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS voltage_threshold NUMERIC;`);
  await pool.query(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS current_threshold NUMERIC;`);
  await pool.query(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS power_threshold NUMERIC;`);

  // Added status
  await pool.query(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS status TEXT DEFAULT "OFF";`);


  await pool.query(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS location TEXT;`);          // "Panel A / Line 01"
  await pool.query(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS capacity_amps NUMERIC;`);  // "Capacity (amps)"
  await pool.query(`ALTER TABLE devices ADD COLUMN IF NOT EXISTS temperature_threshold NUMERIC;`);
  
  // Notifications
  // Lets user know which notificaiton is dismissed or new
  await pool.query(`
    CREATE TABLE IF NOT EXISTS alerts (
      id SERIAL PRIMARY KEY,
      device_id TEXT REFERENCES devices(device_id) ON DELETE CASCADE,
      message TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      resolved BOOLEAN DEFAULT FALSE
    );
  `);

  await pool.query(`ALTER TABLE alerts ADD COLUMN IF NOT EXISTS title TEXT;`);
  await pool.query(`ALTER TABLE alerts ADD COLUMN IF NOT EXISTS severity TEXT DEFAULT 'Medium';`);
  await pool.query(`ALTER TABLE alerts ADD COLUMN IF NOT EXISTS metric TEXT;`);
  
  await pool.query(`
    CREATE TABLE IF NOT EXISTS readings (
      device_id TEXT PRIMARY KEY REFERENCES devices(device_id) ON DELETE CASCADE,
      voltage NUMERIC,
      current NUMERIC,
      power NUMERIC,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);


  await pool.query(`ALTER TABLE readings ADD COLUMN IF NOT EXISTS temperature NUMERIC;`);

  // NEW — append-only history (one row per POST /readings) for the trend chart + uptime.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS readings_log (
      id BIGSERIAL PRIMARY KEY,
      device_id TEXT NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
      voltage NUMERIC,
      current NUMERIC,
      power NUMERIC,
      temperature NUMERIC,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS readings_log_device_time_idx ON readings_log (device_id, created_at DESC);`
  );
  

  console.log("Database tables ready");
}

module.exports = { pool, initDb };
