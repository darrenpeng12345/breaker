import { useEffect, useState } from "react";
import { api } from "./api";

export default function App() {
  const [username, setUsername] = useState(localStorage.getItem("username") || "");
  const [loggedIn, setLoggedIn] = useState(!!localStorage.getItem("token"));

  function handleAuthSuccess(data) {
    localStorage.setItem("token", data.token);
    localStorage.setItem("username", data.username);
    setUsername(data.username);
    setLoggedIn(true);
  }

  function handleLogout() {
    localStorage.removeItem("token");
    localStorage.removeItem("username");
    setLoggedIn(false);
  }

  if (!loggedIn) {
    return <AuthForm onSuccess={handleAuthSuccess} />;
  }

  return <Dashboard username={username} onLogout={handleLogout} />;
}

function AuthForm({ onSuccess }) {
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = mode === "login" ? await api.login(username, password) : await api.register(username, password);
      onSuccess(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.page}>
      <form style={styles.card} onSubmit={handleSubmit}>
        <h1 style={styles.title}>{mode === "login" ? "Log in" : "Create account"}</h1>
        {error && <p style={styles.error}>{error}</p>}
        <input style={styles.input} placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
        <input style={styles.input} type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button style={styles.button} type="submit" disabled={loading}>
          {loading ? "Please wait..." : mode === "login" ? "Log in" : "Create account"}
        </button>
        <p style={styles.switchText}>
          {mode === "login" ? "Need an account?" : "Already have an account?"}{" "}
          <button type="button" style={styles.linkButton} onClick={() => setMode(mode === "login" ? "register" : "login")}>
            {mode === "login" ? "Register" : "Log in"}
          </button>
        </p>
      </form>
    </div>
  );
}

function Dashboard({ username, onLogout }) {
  const [readings, setReadings] = useState([]);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [deviceId, setDeviceId] = useState("");
  const [nickname, setNickname] = useState("");

  useEffect(() => {
    fetchReadings();
    const interval = setInterval(fetchReadings, 5000);
    return () => clearInterval(interval);
  }, []);

  async function fetchReadings() {
    try {
      const data = await api.getReadings();
      setReadings(data);
      setLastUpdated(new Date());
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleAddDevice(e) {
    e.preventDefault();
    if (!deviceId.trim()) return;
    try {
      await api.addDevice(deviceId.trim(), nickname.trim() || null);
      setDeviceId("");
      setNickname("");
      fetchReadings();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div style={styles.page}>
      <div style={{ ...styles.card, maxWidth: 900 }}>
        <div style={styles.header}>
          <h1 style={styles.title}>{username}'s Breakers</h1>
          <button style={styles.linkButton} onClick={onLogout}>Log out</button>
        </div>
        {error && <p style={styles.error}>{error}</p>}
        {lastUpdated && <p style={styles.subtitle}>Last updated: {lastUpdated.toLocaleTimeString()}</p>}

        <form style={styles.row} onSubmit={handleAddDevice}>
          <input style={{ ...styles.input, marginBottom: 0 }} placeholder="Device ID (e.g. esp32-1)" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} />
          <input style={{ ...styles.input, marginBottom: 0 }} placeholder="Nickname (optional)" value={nickname} onChange={(e) => setNickname(e.target.value)} />
          <button style={styles.button} type="submit">Register device</button>
        </form>

        {readings.length === 0 && !error && (
          <p style={styles.empty}>No devices reporting yet. Register a device_id above, then have that ESP32 POST to /readings with the same device_id.</p>
        )}

        <div style={styles.grid}>
          {readings.map((r) => (
            <div key={r.device_id} style={styles.deviceCard}>
              <h2 style={styles.deviceName}>{r.nickname || r.device_id}</h2>
              <p style={styles.deviceId}>{r.device_id}</p>
              <p style={styles.reading}>Voltage: <strong>{r.voltage ?? "—"}</strong> V</p>
              <p style={styles.reading}>Current: <strong>{r.current ?? "—"}</strong> A</p>
              <p style={styles.reading}>Power: <strong>{r.power ?? "—"}</strong> W</p>
              <p style={styles.timestamp}>Updated: {new Date(r.updated_at).toLocaleString()}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const styles = {
  page: { minHeight: "100vh", background: "#f4f4f5", fontFamily: "system-ui, sans-serif", padding: 24, display: "flex", justifyContent: "center" },
  card: { background: "white", padding: 32, borderRadius: 12, width: 380, boxShadow: "0 2px 12px rgba(0,0,0,0.08)", height: "fit-content" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  title: { fontSize: 20, margin: 0 },
  subtitle: { color: "#666", fontSize: 13, marginTop: 0 },
  input: { width: "100%", padding: "10px 12px", marginBottom: 12, borderRadius: 8, border: "1px solid #ddd", fontSize: 14, boxSizing: "border-box" },
  button: { padding: "10px 16px", borderRadius: 8, border: "none", background: "#18181b", color: "white", fontSize: 14, cursor: "pointer", whiteSpace: "nowrap" },
  linkButton: { background: "none", border: "none", color: "#3b82f6", cursor: "pointer", fontSize: 14, padding: 0 },
  error: { color: "#dc2626", fontSize: 13, marginBottom: 12 },
  switchText: { fontSize: 13, textAlign: "center", marginTop: 12, color: "#666" },
  row: { display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 },
  deviceCard: { background: "#f9f9f9", padding: 20, borderRadius: 12 },
  deviceName: { fontSize: 16, margin: "0 0 2px 0" },
  deviceId: { fontSize: 11, color: "#999", margin: "0 0 10px 0" },
  reading: { margin: "4px 0", fontSize: 14 },
  timestamp: { marginTop: 12, fontSize: 11, color: "#999" },
  empty: { color: "#888", fontSize: 14 },
};
