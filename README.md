# Smart Breaker Dashboard (React + Node/Express + PostgreSQL)

## How accounts work
People log in; devices don't. Each user registers their own device_id(s) through
the dashboard (POST /api/devices) before that device's readings will be accepted.
The ESP32 itself never needs a username/password — it just posts device_id +
readings, and the backend looks up which account owns that device_id to keep
each user's dashboard scoped to only their own devices.

## API endpoints (backend)
- `POST /api/auth/register` / `POST /api/auth/login` — `{ username, password }`, returns a JWT.
- `POST /api/devices` (requires login) — `{ device_id, nickname }`, claims a device_id for your account.
- `GET /api/devices` (requires login) — list your registered devices.
- `POST /readings` (no login — this is what the ESP32 calls) — Body:
  ```json
  { "device_id": "esp32-1", "voltage": 120.5, "current": 3.2, "power": 385.6 }
  ```
  Upserts the row for that device_id. Fails with 404 if device_id isn't registered yet.
- `GET /readings` (requires login) — latest reading for every device you own.
- `GET /readings/:device_id` (requires login) — latest reading for one of your devices.

## Deploying
Same process as the todo app:
1. Push this folder to a GitHub repo
2. Railway: new service, Root Directory = `/backend`, add PostgreSQL, link `DATABASE_URL`, generate domain
3. Railway: second service, Root Directory = `/frontend`, set `VITE_API_URL` to the backend's domain, build with
   `npm install && npm run build`, start with `npm run preview`, generate domain

## Note on the schema
`readings` has one row per `device_id` — every new POST overwrites the last one. This is
good for "what's happening right now" but does NOT keep history. If you later want a graph
of readings over time (e.g. with Chart.js), you'll need a second, append-only table
(e.g. `readings_log`) that inserts a new row every time instead of overwriting.
