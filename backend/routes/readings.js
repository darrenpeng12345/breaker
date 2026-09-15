const express = require("express");
const { pool } = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// POST /readings — the ESP32 calls this, no login required (devices don't
// have accounts, people do). It only succeeds if device_id was already
// registered to some user via POST /api/devices — that's what ties a
// reading back to the right account.
// Body example: { "device_id": "esp32-1", "voltage": 120.5, "current": 3.2, "power": 385.6 }
router.post("/", async (req, res) => {
  const { device_id, voltage, current, power } = req.body;

  if (!device_id) {
    return res.status(400).json({ error: "device_id is required" });
  }

  try {
    const owned = await pool.query("SELECT device_id, voltage_threshold, current_threshold, power_threshold FROM devices WHERE device_id = $1", [device_id]);
    if (owned.rows.length === 0) {
      return res.status(404).json({ error: "This device_id hasn't been registered to an account yet" });
    }
    const device = owned.rows[0];

    const result = await pool.query(
      `INSERT INTO readings (device_id, voltage, current, power, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (device_id)
       DO UPDATE SET voltage = $2, current = $3, power = $4, updated_at = NOW()
       RETURNING *`,
      [device_id, voltage ?? null, current ?? null, power ?? null]
    );

    // For the thresholds
    const breaches = [];
    if (device.voltage_threshold != null && voltage > device.voltage_threshold) {
      breaches.push(`voltage (${voltage}V, threshold ${device.voltage_threshold}V)`);
    }
    if (device.current_threshold != null && current > device.current_threshold) {
      breaches.push(`current (${current}A, threshold ${device.current_threshold}A)`);
    }
    if (device.power_threshold != null && power > device.power_threshold) {
      breaches.push(`power (${power}W, threshold ${device.power_threshold}W)`);
    }

    if (breaches.length > 0) {
      let message = `${device_id} is exceeding its threshold: ${breaches.join(", ")}.`;

      if (device.power_threshold != null && power > device.power_threshold) {
        const excess = power - device.power_threshold;
        const guesses = guessAppliances(excess);
        if (guesses.length > 0) {
          message += ` Possible cause: ${guesses.join(" or ")}.`;
        }
      }

      await pool.query("INSERT INTO alerts (device_id, message) VALUES ($1, $2)", [device_id, message]);
    }

    res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error("Insert reading error:", err);
    res.status(500).json({ error: "Could not save reading" });
  }
});

// GET /readings — the logged-in user's devices' latest readings only
router.get("/", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.*, d.nickname FROM readings r
       JOIN devices d ON d.device_id = r.device_id
       WHERE d.user_id = $1
       ORDER BY r.device_id`,
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Fetch readings error:", err);
    res.status(500).json({ error: "Could not load readings" });
  }
});

// GET /readings/:device_id — one device's latest reading, only if it belongs to the logged-in user
router.get("/:device_id", requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.*, d.nickname FROM readings r
       JOIN devices d ON d.device_id = r.device_id
       WHERE r.device_id = $1 AND d.user_id = $2`,
      [req.params.device_id, req.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "No reading found for that device" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Fetch reading error:", err);
    res.status(500).json({ error: "Could not load reading" });
  }
});

module.exports = router;
