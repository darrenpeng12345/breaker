const express = require("express");
const { pool } = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.use(requireAuth);

// GET /api/devices — list the logged-in user's registered devices
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT device_id, nickname, voltage_threshold, current_threshold, power_threshold, status, created_at FROM devices WHERE user_id = $1 ORDER BY created_at",
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Fetch devices error:", err);
    res.status(500).json({ error: "Could not load devices" });
  }
});

// POST /api/devices 
// Claims a device_id for the logged-in user. Do this once per physical
// ESP32 before it starts posting readings — /readings will reject data
// from a device_id nobody has registered yet.
router.post("/", async (req, res) => {
  const { device_id, nickname, voltage_threshold, current_threshold, power_threshold, status } = req.body;
  if (!device_id || !device_id.trim()) {
    return res.status(400).json({ error: "device_id is required" });
  }

  try {
    const existing = await pool.query("SELECT device_id FROM devices WHERE device_id = $1", [device_id]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "That device_id is already registered" });
    }

    const result = await pool.query(
      "INSERT INTO devices (device_id, user_id, nickname, voltage_threshold, current_threshold, power_threshold, status) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *",
      [device_id.trim(), req.userId, nickname || null, voltage_threshold ?? null, current_threshold ?? null, power_threshold ?? null, status || OFF]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Register device error:", err);
    res.status(500).json({ error: "Could not register device" });
  }
});


// PUT /api/devices/:device_id/status
// Update the current breaker status
router.put("/:device_id/status", async (req, res) => {
  const { status } = req.body;

  const validStatuses = ["ON", "OFF", "TRIPPED"];

  if (!validStatuses.includes(status)) {
    return res.status(400).json({
      error: "Status must be ON, OFF, or TRIPPED"
    });
  }

  try {
    const result = await pool.query(
      `UPDATE devices
       SET status = $1
       WHERE device_id = $2 AND user_id = $3
       RETURNING *`,
      [status, req.params.device_id, req.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Device not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Update device status error:", err);
    res.status(500).json({ error: "Could not update device status" });
  }
});


// PUT /api/devices/:device_id — update thresholds/nickname after registration
router.put("/:device_id", async (req, res) => {
  const { nickname, voltage_threshold, current_threshold, power_threshold } = req.body;

  try {
    const result = await pool.query(
      `UPDATE devices SET
         nickname = COALESCE($1, nickname),
         voltage_threshold = $2,
         current_threshold = $3,
         power_threshold = $4
       WHERE device_id = $5 AND user_id = $6
       RETURNING *`,
      [nickname, voltage_threshold ?? null, current_threshold ?? null, power_threshold ?? null, req.params.device_id, req.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Device not found" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Update device error:", err);
    res.status(500).json({ error: "Could not update device" });
  }
});

module.exports = router;
