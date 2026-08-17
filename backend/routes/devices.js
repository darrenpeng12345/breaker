const express = require("express");
const { pool } = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.use(requireAuth);

// GET /api/devices — list the logged-in user's registered devices
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT device_id, nickname, created_at FROM devices WHERE user_id = $1 ORDER BY created_at",
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Fetch devices error:", err);
    res.status(500).json({ error: "Could not load devices" });
  }
});

// POST /api/devices  { device_id: "esp32-1", nickname: "Kitchen breaker" }
// Claims a device_id for the logged-in user. Do this once per physical
// ESP32 before it starts posting readings — /readings will reject data
// from a device_id nobody has registered yet.
router.post("/", async (req, res) => {
  const { device_id, nickname } = req.body;
  if (!device_id || !device_id.trim()) {
    return res.status(400).json({ error: "device_id is required" });
  }

  try {
    const existing = await pool.query("SELECT device_id FROM devices WHERE device_id = $1", [device_id]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "That device_id is already registered" });
    }

    const result = await pool.query(
      "INSERT INTO devices (device_id, user_id, nickname) VALUES ($1, $2, $3) RETURNING *",
      [device_id.trim(), req.userId, nickname || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Register device error:", err);
    res.status(500).json({ error: "Could not register device" });
  }
});

module.exports = router;
