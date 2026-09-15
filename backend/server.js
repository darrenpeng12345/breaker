require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { initDb } = require("./db");
const authRoutes = require("./routes/auth");
const deviceRoutes = require("./routes/devices");
const readingsRoutes = require("./routes/readings");
const alertRoutes = require("./routes/alerts");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Smart breaker API is running" });
});

app.use("/api/auth", authRoutes);
app.use("/api/devices", deviceRoutes);
app.use("/api/readings", readingsRoutes);
app.use("/alerts", alertRoutes);

const PORT = process.env.PORT || 4000;

initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch((err) => {
    console.error("Failed to initialize database:", err);
    process.exit(1);
  });
