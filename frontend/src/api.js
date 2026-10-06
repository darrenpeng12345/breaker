// Talks to the BreakerSense backend (the Express + Postgres API on Railway).
// Set VITE_API_URL in Railway (frontend service) to the BACKEND's public URL, e.g.
//   https://breaker-backend-production.up.railway.app
// Vite bakes this in at BUILD time, so set it before the frontend builds/deploys.
const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:4000").replace(/\/+$/, "");

const TOKEN_KEY = "breakersense_token";
const EMAIL_KEY = "breakersense_email";

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const getEmail = () => localStorage.getItem(EMAIL_KEY);

export function saveSession({ token, email, username }) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(EMAIL_KEY, email || username || "");
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(EMAIL_KEY);
}

async function request(path, options = {}) {
  const token = getToken();
  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new Error("Can't reach the server. Check your connection and try again.");
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON body (e.g. a proxy error page)
  }

  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  login: (email, password) =>
    request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),

  register: (email, password) =>
    request("/api/auth/register", { method: "POST", body: JSON.stringify({ email, password }) }),

  getDevices: () => request("/api/devices"),

  // status: "ON" | "OFF"
  addDevice: ({ device_id, nickname, location, capacity_amps, status }) =>
    request("/api/devices", {
      method: "POST",
      body: JSON.stringify({ device_id, nickname, location, capacity_amps, status }),
    }),

  getDashboard: (deviceId, hours = 6) =>
    request(`/api/dashboard/${encodeURIComponent(deviceId)}?hours=${hours}`),
};
