import { useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { api, clearSession, getToken } from "../api";
import "./SuccessPage.css";

ChartJS.register(CategoryScale, Filler, LinearScale, LineElement, PointElement, Tooltip);

const POLL_MS = 3000;       // how often the dashboard refreshes
const HISTORY_HOURS = 6;    // chart window
const STALE_AFTER_S = 30;   // no reading for this long => device counts as offline

const EMPTY_FORM = { device_id: "", name: "", location: "", capacity: "", status: "active" };

/* ------------------------------ helpers ------------------------------ */

function secondsBetween(earlierIso, laterIso) {
  return (new Date(laterIso).getTime() - new Date(earlierIso).getTime()) / 1000;
}

// "12 minutes ago", measured against the SERVER's clock so a wrong laptop clock can't skew it.
function timeAgo(iso, nowIso) {
  if (!iso) return "";
  const s = Math.max(0, secondsBetween(iso, nowIso));
  if (s < 5) return "just now";
  if (s < 60) return `${Math.floor(s)} seconds ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

function severityTone(severity) {
  if (severity === "High") return "red";
  if (severity === "Medium") return "amber";
  return "blue";
}

function isFresh(view) {
  return !!view.latest && secondsBetween(view.latest.updated_at, view.server_time) <= STALE_AFTER_S;
}

// One place that decides what the big "Circuit breaker status" card says.
function deriveBreakerStatus(view) {
  const { device, latest, alerts } = view;

  if (device.status === "TRIPPED") {
    return { key: "alert", label: "Tripped", icon: "!", detail: "Breaker has tripped" };
  }
  if (device.status === "OFF") {
    return { key: "offline", label: "Inactive", icon: "–", detail: "Monitoring is currently paused" };
  }
  if (!latest) {
    return { key: "offline", label: "Waiting for data", icon: "–", detail: "No readings received from this device yet" };
  }
  if (!isFresh(view)) {
    return {
      key: "offline",
      label: "Offline",
      icon: "–",
      detail: `No data received since ${timeAgo(latest.updated_at, view.server_time)}`,
    };
  }
  if (alerts.some((a) => a.severity === "High")) {
    return { key: "alert", label: "Alert", icon: "!", detail: alerts[0].title };
  }
  if (alerts.length > 0) {
    return { key: "warning", label: "Warning", icon: "!", detail: alerts[0].title };
  }
  return { key: "healthy", label: "Healthy", icon: "✓", detail: "No trip conditions detected" };
}

// watchRatio: show "Watch" once a reading reaches this fraction of its limit.
// Voltage sits near its limit all the time (237 V nominal vs a 264 V limit), so it gets a tighter band.
const SENSORS = [
  { key: "voltage", label: "Voltage", unit: "V", tone: "blue", limitKey: "voltage_threshold", decimals: 0, watchRatio: 0.97 },
  { key: "current", label: "Current", unit: "A", tone: "teal", limitKey: "current_threshold", decimals: 1, watchRatio: 0.85 },
  { key: "temperature", label: "Temperature", unit: "°C", tone: "blue", limitKey: "temperature_threshold", decimals: 0, watchRatio: 0.85 },
];

function deriveSensors(view) {
  const fresh = isFresh(view);
  return SENSORS.map((def) => {
    const value = view.latest ? view.latest[def.key] : null;
    const limit = view.device[def.limitKey];
    const hasValue = value !== null && value !== undefined;
    const hasLimit = limit !== null && limit !== undefined && Number(limit) > 0;
    const ratio = hasValue && hasLimit ? value / limit : null;

    let status = "Normal";
    let tone = def.tone;
    if (!hasValue) status = "No data";
    else if (!fresh) status = "Last known";
    else if (ratio !== null && ratio > 1) { status = "Over limit"; tone = "red"; }
    else if (ratio !== null && ratio >= def.watchRatio) { status = "Watch"; tone = "amber"; }

    let caption = hasLimit ? `Limit ${limit} ${def.unit}` : "No limit set";
    if (status === "Over limit") caption = `Above the ${limit} ${def.unit} limit`;

    return {
      label: def.label,
      unit: def.unit,
      value: hasValue ? Number(value).toFixed(def.decimals) : "—",
      status,
      tone,
      caption,
      barPercent: ratio === null ? 0 : Math.min(100, Math.max(0, ratio * 100)),
    };
  });
}

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  animation: false, // data refreshes every few seconds; don't re-animate each time
  plugins: { legend: { display: false }, tooltip: { displayColors: false } },
  scales: {
    x: { grid: { display: false }, ticks: { color: "#718087", maxTicksLimit: 8 } },
    y: { beginAtZero: true, border: { display: false }, grid: { color: "#e8efed" }, ticks: { color: "#718087" } },
  },
};

function buildChartData(view) {
  const withSeconds = view.bucket_seconds < 60;
  const fmt = { hour: "2-digit", minute: "2-digit", ...(withSeconds ? { second: "2-digit" } : {}) };
  return {
    labels: view.history.map((p) => new Date(p.t).toLocaleTimeString([], fmt)),
    datasets: [{
      label: "Current draw (A)",
      data: view.history.map((p) => Math.round(p.current * 100) / 100),
      borderColor: "#1b9586",
      backgroundColor: "rgba(27, 149, 134, 0.12)",
      fill: true,
      tension: 0.35,
      pointRadius: 3,
      pointBackgroundColor: "#1b9586",
    }],
  };
}

/* ------------------------------- pages ------------------------------- */

// /success is only for logged-in users.
function SuccessPage() {
  if (!getToken()) return <Navigate to="/" replace />;
  return <Dashboard />;
}

function Dashboard() {
  const navigate = useNavigate();

  const [devices, setDevices] = useState(null);      // null = still loading
  const [selectedId, setSelectedId] = useState(null);
  const [data, setData] = useState(null);            // last /api/dashboard response
  const [lastFetch, setLastFetch] = useState(null);
  const [loadError, setLoadError] = useState("");

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const logout = useCallback(() => {
    clearSession();
    navigate("/", { replace: true });
  }, [navigate]);

  // An expired/invalid token (401) sends you back to the login page.
  const handleApiError = useCallback((err) => {
    if (err.status === 401) logout();
    else setLoadError(err.message);
  }, [logout]);

  const loadDevices = useCallback(async () => {
    try {
      const list = await api.getDevices();
      setDevices(list);
      setSelectedId((current) =>
        current && list.some((d) => d.device_id === current) ? current : list[0]?.device_id ?? null
      );
      setLoadError("");
      return list;
    } catch (err) {
      handleApiError(err);
      return null;
    }
  }, [handleApiError]);

  useEffect(() => {
    loadDevices();
  }, [loadDevices]);

  // Poll the one-call dashboard endpoint for the selected breaker.
  useEffect(() => {
    if (!selectedId) return undefined;
    let cancelled = false;

    async function poll() {
      try {
        const result = await api.getDashboard(selectedId, HISTORY_HOURS);
        if (cancelled) return;
        setData(result);
        setLastFetch(Date.now());
        setLoadError("");
      } catch (err) {
        if (!cancelled) handleApiError(err);
      }
    }

    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [selectedId, handleApiError]);

  function handleFormChange(event) {
    const { name, value } = event.target;
    setFormData((current) => ({ ...current, [name]: value }));
  }

  function closeModal() {
    setIsModalOpen(false);
    setFormError("");
  }

  async function handleAddBreaker(event) {
    event.preventDefault();

    if (!formData.device_id.trim() || !formData.name.trim() || !formData.location.trim() || !formData.capacity) {
      setFormError("Complete all fields before adding the breaker.");
      return;
    }

    setSubmitting(true);
    try {
      const created = await api.addDevice({
        device_id: formData.device_id.trim(),
        nickname: formData.name.trim(),
        location: formData.location.trim(),
        capacity_amps: Number(formData.capacity),
        status: formData.status === "active" ? "ON" : "OFF",
      });
      await loadDevices();
      setSelectedId(created.device_id);
      setFormData(EMPTY_FORM);
      setFormError("");
      setIsModalOpen(false);
    } catch (err) {
      if (err.status === 401) logout();
      else setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  // Ignore a stale response that belongs to a breaker we've since switched away from.
  const view = data && data.device.device_id === selectedId ? data : null;
  const status = view ? deriveBreakerStatus(view) : null;
  const sensors = view ? deriveSensors(view) : [];
  const chartData = view ? buildChartData(view) : null;

  let connection = { className: "", text: "Connecting…" };
  if (loadError) connection = { className: "connection-status--error", text: "Connection lost" };
  else if (view && isFresh(view) && view.device.status !== "OFF") connection = { className: "", text: "Live monitor" };
  else if (view) connection = { className: "connection-status--idle", text: "Waiting for device" };

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">BreakerSense / Operations</p>
          <h1>System overview</h1>
        </div>
        <div className="dashboard-header__actions">
          {devices && devices.length > 1 && (
            <select
              className="breaker-select"
              aria-label="Select breaker"
              value={selectedId || ""}
              onChange={(e) => setSelectedId(e.target.value)}
            >
              {devices.map((d) => (
                <option key={d.device_id} value={d.device_id}>
                  {d.nickname || d.device_id}
                </option>
              ))}
            </select>
          )}
          <button className="add-breaker-button" type="button" onClick={() => setIsModalOpen(true)}>
            <span aria-hidden="true">+</span>
            Add breaker
          </button>
          <div className={`connection-status ${connection.className}`}>
            <span className="connection-dot" aria-hidden="true" />
            <span>{connection.text}</span>
            {lastFetch && <span className="updated-time">Updated {new Date(lastFetch).toLocaleTimeString()}</span>}
          </div>
          <button className="logout-button" type="button" onClick={logout}>Log out</button>
        </div>
      </header>

      <main className="dashboard-content">
        {loadError && <p className="dashboard-banner" role="alert">{loadError}</p>}

        {devices === null && !loadError && <p className="muted-text">Loading your breakers…</p>}

        {devices !== null && devices.length === 0 && (
          <section className="empty-state">
            <h2>No breakers yet</h2>
            <p className="muted-text">
              Add your first breaker to start monitoring. Use the same Device ID your ESP32 sends with its readings.
            </p>
            <button className="add-breaker-button" type="button" onClick={() => setIsModalOpen(true)}>
              <span aria-hidden="true">+</span>
              Add breaker
            </button>
          </section>
        )}

        {devices !== null && devices.length > 0 && !view && !loadError && (
          <p className="muted-text">Loading breaker data…</p>
        )}

        {view && (
          <>
            <section className="breaker-card" aria-labelledby="breaker-heading">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Circuit breaker status</p>
                  <h2 id="breaker-heading">{view.device.nickname || view.device.device_id}</h2>
                  <p className="muted-text">
                    {view.device.location || "No location set"} · ID {view.device.device_id}
                  </p>
                </div>
                <span className={`status-pill status-pill--${status.key}`}>
                  <span className="status-dot" aria-hidden="true" />
                  {status.label}
                </span>
              </div>

              <div className="breaker-summary">
                <div className={`breaker-icon breaker-icon--${status.key}`} aria-hidden="true">{status.icon}</div>
                <div>
                  <strong>{status.detail}</strong>
                  <p className="muted-text">
                    Last event:{" "}
                    {view.last_event
                      ? `${view.last_event.title} (${timeAgo(view.last_event.created_at, view.server_time)})`
                      : "No events in the last 24 hours"}
                  </p>
                </div>
              </div>

              <div className="breaker-metrics">
                <div>
                  <span className="metric-label">Uptime (24h)</span>
                  <strong>{view.uptime_pct === null ? "—" : `${view.uptime_pct}%`}</strong>
                </div>
                <div>
                  <span className="metric-label">Rated capacity</span>
                  <strong>{view.device.capacity_amps ? `${view.device.capacity_amps} A` : "—"}</strong>
                </div>
                <div>
                  <span className="metric-label">Last reading</span>
                  <strong>{view.latest ? timeAgo(view.latest.updated_at, view.server_time) : "No readings yet"}</strong>
                </div>
              </div>
            </section>

            <section className="chart-panel" aria-labelledby="trend-heading">
              <div className="section-title-row">
                <div>
                  <p className="eyebrow">Live telemetry</p>
                  <h2 id="trend-heading">Current draw trend</h2>
                </div>
                <span className="muted-text">Last {HISTORY_HOURS} hours</span>
              </div>
              <div className="chart-wrap">
                {view.history.length > 0 ? (
                  <Line data={chartData} options={chartOptions} />
                ) : (
                  <p className="chart-empty">Waiting for readings from the device…</p>
                )}
              </div>
            </section>

            <section aria-labelledby="sensors-heading">
              <div className="section-title-row">
                <div>
                  <p className="eyebrow">Telemetry</p>
                  <h2 id="sensors-heading">Sensor data</h2>
                </div>
                <span className="muted-text">{sensors.length} connected sensors</span>
              </div>
              <div className="sensor-grid">
                {sensors.map((sensor) => (
                  <article className={`sensor-card sensor-card--${sensor.tone}`} key={sensor.label}>
                    <div className="sensor-card__topline">
                      <span className="sensor-label">{sensor.label}</span>
                      <span className="sensor-status">{sensor.status}</span>
                    </div>
                    <p className="sensor-value">
                      {sensor.value}<span>{sensor.unit}</span>
                    </p>
                    <div className="sensor-bar" aria-hidden="true">
                      <span style={{ width: `${sensor.barPercent}%` }} />
                    </div>
                    <p className="sensor-caption">{sensor.caption}</p>
                  </article>
                ))}
              </div>
            </section>

            <section className="alerts-section" aria-labelledby="alerts-heading">
              <div className="section-title-row">
                <div>
                  <p className="eyebrow">Needs attention</p>
                  <h2 id="alerts-heading">Alerts</h2>
                </div>
                <span className="alert-count">{view.alerts.length} open</span>
              </div>
              <div className="alerts-list">
                {view.alerts.length === 0 && (
                  <article className="alert-row">
                    <span className="alert-marker alert-marker--green" aria-hidden="true" />
                    <div className="alert-copy">
                      <div className="alert-title-row"><h3>All clear</h3></div>
                      <p>No open alerts for this breaker.</p>
                    </div>
                  </article>
                )}
                {view.alerts.map((alert) => {
                  const tone = severityTone(alert.severity);
                  return (
                    <article className="alert-row" key={alert.id}>
                      <span className={`alert-marker alert-marker--${tone}`} aria-hidden="true" />
                      <div className="alert-copy">
                        <div className="alert-title-row">
                          <h3>{alert.title}</h3>
                          <span className={`severity severity--${tone}`}>{alert.severity}</span>
                        </div>
                        <p>{alert.message}</p>
                      </div>
                      <time>{timeAgo(alert.created_at, view.server_time)}</time>
                    </article>
                  );
                })}
              </div>
            </section>
          </>
        )}
      </main>

      {isModalOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={closeModal}>
          <div className="breaker-modal" role="dialog" aria-modal="true" aria-labelledby="modal-heading" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">Equipment setup</p>
                <h2 id="modal-heading">Add breaker</h2>
              </div>
              <button className="modal-close" type="button" aria-label="Close add breaker dialog" onClick={closeModal}>×</button>
            </div>
            <form className="breaker-form" onSubmit={handleAddBreaker}>
              <label>
                Device ID
                <input name="device_id" value={formData.device_id} onChange={handleFormChange} placeholder="e.g. esp32-1 (must match the ESP32)" autoFocus />
              </label>
              <label>
                Breaker name
                <input name="name" value={formData.name} onChange={handleFormChange} placeholder="e.g. Workshop breaker" />
              </label>
              <label>
                Location
                <input name="location" value={formData.location} onChange={handleFormChange} placeholder="e.g. Panel B / Line 02" />
              </label>
              <label>
                Capacity
                <span className="input-with-unit">
                  <input name="capacity" type="number" min="1" max="10000" value={formData.capacity} onChange={handleFormChange} placeholder="100" />
                  <span>amps</span>
                </span>
              </label>
              <fieldset>
                <legend>Initial status</legend>
                <div className="status-options">
                  <label className={formData.status === "active" ? "status-option status-option--selected" : "status-option"}>
                    <input type="radio" name="status" value="active" checked={formData.status === "active"} onChange={handleFormChange} />
                    Active
                  </label>
                  <label className={formData.status === "inactive" ? "status-option status-option--selected" : "status-option"}>
                    <input type="radio" name="status" value="inactive" checked={formData.status === "inactive"} onChange={handleFormChange} />
                    Inactive
                  </label>
                </div>
              </fieldset>
              {formError && <p className="form-error" role="alert">{formError}</p>}
              <div className="modal-actions">
                <button className="cancel-button" type="button" onClick={closeModal}>Cancel</button>
                <button className="submit-button" type="submit" disabled={submitting}>
                  {submitting ? "Adding…" : "Add breaker"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default SuccessPage;
