# Hotel Modbus System - Integration Guide

## Overview

This system manages hotel room access control via Modbus TCP relay control with comprehensive authentication, state tracking, and real-time notifications.

## Features

- ✅ **Dual Authentication**: JWT bearer token (frontend) + API key (third-party)
- ✅ **Role-based Access Control**: Admin (system management) + User (read-only plus guarded sub relay)
- ✅ **State Transitions**: Automatic state calculation (5 Vietnamese states)
- ✅ **State History**: SQLite logging with queryable API
- ✅ **Real-time Notifications**: WebSocket + Telegram + Email
- ✅ **Concurrent Write Safety**: Floor-based queue system
- ✅ **Per-floor Parallel Polling**: No blocking between floors

---

## 1. API Endpoints

### Authentication

#### POST /api/auth/login
Login with a username and password to receive a JWT access token.

**Request:**
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -H "Origin: http://localhost:3001" \
  -H "X-CSRF-Protection: 1" \
  -c cookies.txt \
  -d '{"username": "<INITIAL_ADMIN_USERNAME>", "password": "<INITIAL_ADMIN_PASSWORD>"}'
```

**Response:**
```json
{
  "success": true,
  "accessToken": "<JWT>",
  "user": {
    "id": 1,
    "username": "admin",
    "role": "admin"
  }
}
```

The refresh token is returned only as an `HttpOnly`, `SameSite=Strict` cookie at `/api/auth`.
The browser must use `credentials: 'include'`; JavaScript cannot read or persist the refresh token.
Access tokens are held in memory and sent as bearer tokens.

The first startup after this account-reset migration deletes all existing user accounts and
creates exactly one administrator using `INITIAL_ADMIN_USERNAME` and `INITIAL_ADMIN_PASSWORD`
from the backend environment. There is no default password or seeded user account. Existing room,
PLC, settings, and history data are retained. The migration runs once; later restarts and deploys
do not reset accounts.

---

#### GET /api/auth/verify
Verify the JWT and return the current user.

**Request (with bearer token):**
```bash
curl -X GET http://localhost:3000/api/auth/verify \
  -H "Authorization: Bearer <JWT>"
```

**Response:**
```json
{
  "success": true,
  "user": {
    "id": 1,
    "username": "admin",
    "role": "admin"
  }
}
```

#### POST /api/auth/refresh
Rotate the refresh token cookie and receive a new 15-minute access token:

```bash
curl -X POST http://localhost:3000/api/auth/refresh \
  -H "Origin: http://localhost:3001" \
  -H "X-CSRF-Protection: 1" \
  -b cookies.txt -c cookies.txt
```

`POST /api/auth/logout` revokes the presented refresh-token family and clears the cookie.
`POST /api/auth/logout-all` revokes all sessions and requires a bearer token plus the CSRF header.
`GET /api/auth/me` returns the authenticated user. There is no `/api/auth/activity` token-renewal
endpoint; all renewal goes through refresh-token rotation.

### Authorization

- Every `/api/*` route is authenticated by default; only the declared login, refresh, and logout
  endpoints are public. `/api/status` is a public health check.
- Both roles may read room, PLC, history, and notification data. Users may mark notifications read
  and control only the sub relay while the main relay is on.
- Admins may control both relays and manage configuration, users, and global notifications.
- Updating room state and writing/clearing global notifications is restricted to an admin JWT or
  an API key configured with the `admin` role. API keys do not administer users or configuration.
- Room/notification data is shared across this single hotel; there are no per-user room ownership
  records. Relay checks are enforced server-side, not just by hidden UI controls.

---

### Relay Control

#### Option 1: API Key (Third-party Integration)

##### POST /api/relay/main/set
Control main relay using API Key.

**Request:**
```bash
curl -X POST http://localhost:3000/api/relay/main/set \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '[
    {"room": "201", "set": "on"},
    {"room": "202", "set": "off"}
  ]'
```

**Response:**
```json
[
  {
    "room": "201",
    "floor": 2,
    "status": "on",
    "type": "main",
    "timestamp": "2025-12-02T10:30:00.000Z"
  }
]
```

##### POST /api/relay/sub/set
Control sub relay using API Key.

```bash
curl -X POST http://localhost:3000/api/relay/sub/set \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '[{"room": "201", "set": "on"}]'
```

---

#### Frontend JWT (browser or app)

Send the access token in the `Authorization` header for subsequent API calls:

```bash
# Login and copy accessToken from the response
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "<INITIAL_ADMIN_USERNAME>", "password": "<INITIAL_ADMIN_PASSWORD>"}'

# Use the returned token to call main relay (Admin)
curl -X POST http://localhost:3000/api/relay/main/set \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '[{"room": "201", "set": "on"}]'

# Use the token to call sub relay
curl -X POST http://localhost:3000/api/relay/sub/set \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '[{"room": "201", "set": "on"}]'
```

Access tokens expire after 15 minutes. Refresh tokens rotate on every refresh and expire after
7 days; only their SHA-256 hashes are stored in SQLite. `API_KEY` is optional and should be
enabled only for trusted integrations. Account and configuration administration requires an
admin JWT.

### Monitoring

#### GET /api/monitor/rooms
Get current room states with state calculations.

**Request (browser/frontend - with bearer token):**
```bash
curl -X GET "http://localhost:3000/api/monitor/rooms" \
  -H "Authorization: Bearer <JWT>"
```

**Request (third-party - with API Key):**
```bash
curl -X GET "http://localhost:3000/api/monitor/rooms" \
  -H "X-API-Key: $API_KEY"
```

**Response:**
```json
{
  "success": true,
  "data": {
    "201": {
      "room": "201",
      "state": 2,
      "stateName": "Có khách",
      "x_input": true,
      "y_output_main": true,
      "y_output_sub": false,
      "timestamp": "2025-12-02T10:35:00.000Z"
    },
    "202": {
      "room": "202",
      "state": 0,
      "stateName": "Trống",
      "x_input": false,
      "y_output_main": false,
      "y_output_sub": false,
      "timestamp": "2025-12-02T10:35:00.000Z"
    }
  }
}
```

**State Codes:**
| State | Name | Description | x_input | y_main | y_sub |
|-------|------|-------|---------|--------|-------|
| 0 | Trống | Chưa có khách; relay chính và phụ tắt | 0 | 0 | 0 |
| 1 | Chờ khách | Relay chính bật; chưa phát hiện khách | 0 | 1 | 0 |
| 2 | Có khách | Đã phát hiện khách; relay chính bật | 1 | 1 | 0 |
| 3 | Bật cưỡng bức | Khách trong phòng; relay phụ được bật cưỡng bức | 1 | 1 | 1 |
| 4 | Bảo trì | Tín hiệu phòng ở trạng thái bảo trì | 1 | 0 | 1 |

---

#### GET /api/monitor/plc-status
Get PLC connection status.

**Request (browser/frontend - with bearer token):**
```bash
curl -X GET "http://localhost:3000/api/monitor/plc-status" \
  -H "Authorization: Bearer <JWT>"
```

**Request (third-party - with API Key):**
```bash
curl -X GET "http://localhost:3000/api/monitor/plc-status" \
  -H "X-API-Key: $API_KEY"
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "floor": 2,
      "connected": true,
      "status": "Connected",
      "isReconnecting": false,
      "reconnectDelay": null,
      "lastError": null
    }
  ],
  "timestamp": "2025-12-02T10:35:00.000Z"
}
```

---

#### GET /api/monitor/history
Get state change history from SQLite.

**Query Parameters:**
- `room` (optional): Filter by room number (e.g., "201")
- `limit` (optional): Number of records (default: 100)
- `startDate` (optional): ISO date string (e.g., "2025-12-01T00:00:00Z")
- `endDate` (optional): ISO date string
- `search` (optional): Search room, floor, state names, message, or event source (max 100 characters)

**Examples:**

Get last 50 changes for room 201 (JWT):
```bash
curl -X GET "http://localhost:3000/api/monitor/history?room=201&limit=50" \
  -H "Authorization: Bearer <JWT>"
```

Search history by room, state, or message:
```bash
curl -G "http://localhost:3000/api/monitor/history" \
  --data-urlencode "search=201 bật tay" \
  -H "Authorization: Bearer <JWT>"
```

Get all changes in a date range (API Key):
```bash
curl -X GET "http://localhost:3000/api/monitor/history?startDate=2025-12-01T00:00:00Z&endDate=2025-12-02T23:59:59Z" \
  -H "X-API-Key: $API_KEY"
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "timestamp": "2025-12-02T10:35:00.000Z",
      "room": "201",
      "floor": "2",
      "previous_state": "Trống",
      "new_state": "Có khách",
      "message": "✅ Đã cấp điện và cắm thẻ phòng 201"
    },
    {
      "timestamp": "2025-12-02T10:30:00.000Z",
      "room": "201",
      "floor": "2",
      "previous_state": "Chờ khách",
      "new_state": "Có khách",
      "message": "✅ Đã cắm thẻ phòng 201"
    }
  ],
  "timestamp": "2025-12-02T10:36:00.000Z"
}
```

---

## 2. WebSocket Real-time Notifications

### Connection
```javascript
const socket = io('http://localhost:3000', {
  auth: { token: accessToken }
});

socket.on('connect', () => {
  console.log('Connected to server');
});

socket.on('disconnect', () => {
  console.log('Disconnected from server');
});
```

### Room State Updates (Every 1000ms)
```javascript
socket.on('room-states', (states) => {
  console.log('Current room states:', states);
  // states: { "201": {...}, "202": {...}, ... }
});
```

### State Change Notifications
```javascript
socket.on('state-changed', (notification) => {
  console.log(`Room ${notification.room} changed:`, notification);
  /*
    {
      room: "201",
      previousState: "Trống",
      newState: "Có khách",
      message: "✅ Đã cấp điện và cắm thẻ phòng 201",
      timestamp: "2025-12-02T10:35:00.000Z"
    }
  */
});
```

---

## 3. State Transition Messages

Automatic notification messages when state changes:

| Transition | Message |
|-----------|---------|
| Trống → Có khách | Mở điện và phát hiện khách cùng lúc |
| Trống → Chờ khách | Mở điện trước khi phát hiện khách |
| Chờ khách → Có khách | Phát hiện khách vào phòng |
| Có khách → Bật cưỡng bức | Bật relay phụ cưỡng bức |
| Có khách → Chờ khách | Khách ra ngoài; điện chính vẫn bật |
| Bật cưỡng bức → Trống | Đóng điện sau trạng thái bật cưỡng bức |
| Có khách → Trống | Đóng điện và khách ra khỏi phòng |
| Chờ khách → Trống | Đóng điện khi chưa phát hiện khách |
| Trống → Bảo trì | Chuyển phòng sang chế độ bảo trì |

---

## 4. Notification Channels

### Telegram (Optional)

**Configure Telegram in the application's Settings page:** enable Telegram and enter the bot token and chat ID.

**How to get Bot Token & Chat ID:**
1. Create bot via [@BotFather](https://t.me/botfather)
2. Get your chat ID: https://api.telegram.org/bot{BOT_TOKEN}/getUpdates
3. Enter the token and chat ID in Settings.

---

### Email (Optional)

**Configure email in the application's Settings page:** enable email and enter the SMTP service, sender credentials, and recipient.

**Gmail Setup:**
1. Enable 2-Factor Authentication
2. Create App Password: https://myaccount.google.com/apppasswords
3. Use App Password in config

---

## 5. Frontend Integration Example (Vue.js / React)

**Authentication:** Keep the access token in memory, use the HttpOnly refresh cookie, and send the
CSRF header on cookie-authenticated POST requests.

```javascript
let accessToken;

async function login(username, password) {
  const response = await fetch('http://localhost:3000/api/auth/login', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Protection': '1'
    },
    body: JSON.stringify({ username, password })
  });
  const data = await response.json();
  accessToken = data.accessToken;
  return data;
}

async function refreshSession() {
  const response = await fetch('http://localhost:3000/api/auth/refresh', {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-CSRF-Protection': '1' }
  });
  if (!response.ok) {
    accessToken = null;
    return null;
  }
  const data = await response.json();
  accessToken = data.accessToken;
  return data;
}

// Verify the access token
async function verifyToken() {
  const response = await fetch('http://localhost:3000/api/auth/verify', {
    credentials: 'include',
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  return await response.json();
}

// Logout
async function logout() {
  const response = await fetch('http://localhost:3000/api/auth/logout', {
    method: 'POST',
    credentials: 'include',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'X-CSRF-Protection': '1'
    }
  });
  accessToken = null;
  return await response.json();
}

// Fetch room states
async function getRoomStates() {
  const response = await fetch('http://localhost:3000/api/monitor/rooms', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  return await response.json();
}

// Control relay with client-side role check (server also enforces)
async function controlRelay(room, relayType, value) {
  const role = localStorage.getItem('role');
  
  // Client-side check (optional - server will enforce too)
  if (relayType === 'main' && role !== 'admin') {
    alert('Only admins can control main relay');
    return;
  }
  
  const response = await fetch(`http://localhost:3000/api/relay/${relayType}/set`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify([{ room, set: value }])
  });
  return await response.json();
}

// Listen to real-time WebSocket updates
const socket = io('http://localhost:3000', {
  auth: { token: accessToken }
});

socket.on('room-states', (states) => {
  updateUI(states);
});

socket.on('state-changed', (notification) => {
  showNotification(notification.message, notification.newState);
});
```

---

## 6. Third-party API Integration (API Key)

For external systems (such as PMS integrations), set an optional `API_KEY` in the backend `.env` file:

```bash
#!/bin/bash

API_KEY="${API_KEY:?Set API_KEY in the environment first}"
BASE_URL="http://localhost:3000"

# Check room 201 status
curl -X GET "${BASE_URL}/api/monitor/rooms" \
  -H "X-API-Key: ${API_KEY}"

# Get room history
curl -X GET "${BASE_URL}/api/monitor/history?room=201&limit=50" \
  -H "X-API-Key: ${API_KEY}"

# Turn on main relay for room 201 (admin API key)
curl -X POST "${BASE_URL}/api/relay/main/set" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${API_KEY}" \
  -d '[{"room": "201", "set": "on"}]'

# Turn on sub relay for room 201
curl -X POST "${BASE_URL}/api/relay/sub/set" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${API_KEY}" \
  -d '[{"room": "201", "set": "on"}]'
```

---

## 7. State History Queries

### Get history for specific room (JWT)
```bash
curl -H "Authorization: Bearer <JWT>" "http://localhost:3000/api/monitor/history?room=201&limit=20"
```

### Get history for specific room (API Key)
```bash
curl "http://localhost:3000/api/monitor/history?room=201&limit=20" \
  -H "X-API-Key: $API_KEY"
```

### Get history with date filter
```bash
curl -H "Authorization: Bearer <JWT>" "http://localhost:3000/api/monitor/history?startDate=2025-12-01T00:00:00Z&endDate=2025-12-02T23:59:59Z"
```

### Export to CSV (via script)
```bash
curl -H "Authorization: Bearer <JWT>" "http://localhost:3000/api/monitor/history?limit=1000" \
  | jq -r '.data[] | [.timestamp, .room, .previous_state, .new_state, .message] | @csv' > history.csv
```

---

## 8. Error Handling

### JWT Expired, Revoked, or Invalid
```json
{
  "error": "Unauthorized"
}
```
**Solution:** Try `POST /api/auth/refresh` with the refresh cookie. Log in again only if the
refresh token is expired, revoked, or invalid.

### Insufficient Permissions
```json
{
  "error": "Insufficient permission"
}
```
**Solution:** Check the role's permissions. A user can control only the sub relay while the main
relay is on; only an administrator can control the main relay or change system configuration.

### PLC Connection Error
```json
{
  "error": "PLC connection lost"
}
```
**Solution:** Check the PLC IP/port in the application's Settings page and verify network connectivity

---

## 9. Production deployment configuration

Start from `.env.example` and copy it to `.env` on the production server. The Compose file
loads `.env`; do not commit it or put real secrets in `.env.example`.

### Required and optional environment variables

| Variable | Production value | Notes |
|---|---|---|
| `NODE_ENV` | `production` | Enables production security headers and cookie rules. |
| `JWT_SECRET` | Unique random value, at least 32 characters | Generate a new value for each environment. Changing it invalidates all access tokens. |
| `JWT_ISSUER` | `hotel-modbus-system` | Must match the issuer used when creating access tokens. |
| `JWT_AUDIENCE` | `hotel-modbus-frontend` | Must match the intended client. |
| `ACCESS_TOKEN_TTL_SECONDS` | `900` or less | Maximum accepted lifetime is 15 minutes. |
| `INITIAL_ADMIN_USERNAME` | `admin` or another valid username | Used only once by the account-reset migration. Username must be 3-32 letters, numbers, dots, underscores, or hyphens. |
| `INITIAL_ADMIN_PASSWORD` | Unique password, 12-128 characters | Required for the one-time reset migration. Do not commit it; remove it from `.env` after confirming the first startup and admin login. |
| `REFRESH_TOKEN_COOKIE_NAME` | `refresh_token` | Keep stable unless intentionally changing the cookie name. |
| `REFRESH_TOKEN_COOKIE_SECURE` | `true` | Never set to false in production; serve the site over HTTPS. |
| `API_KEY` | Empty unless needed | Optional integration key; grants admin-level API access and must be at least 32 characters. |
| `BACKEND_DATA_DIR` | Absolute writable host directory | Persistent SQLite database location mounted at `/app/data`. |
| `BACKEND_LOGS_DIR` | Absolute writable host directory | Persistent file logs mounted at `/app/logs`. |
| `LOG_TO_FILE` | `true` or `false` | Console logging remains enabled either way. |
| `LOG_LEVEL` | `info` | Use `warn` or `error` if less operational detail is needed. |

SQLite uses `data/hotel.db` by default, persisted through the configured backend data volume.
The app port is managed by the application's system settings (default
`3000`), not by an environment variable. The production CORS allowlist is managed in Admin
Settings, not in `.env`; use the exact HTTPS origin(s) of the deployed UI, never `*`.

Generate secrets on the server and paste each output into the corresponding `.env` value:

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Run the command once for `JWT_SECRET`, once for the bootstrap admin password, and again for
`API_KEY` only when an external system must use API-key authentication. Do not reuse values across
environments. The bootstrap password output can contain URL-safe characters and should be stored
only in the production `.env` or a secret manager.

### Deploy with Docker Compose

On the production host, from the directory containing `docker-compose.yml`:

```bash
cp .env.example .env
mkdir -p /opt/hotel-modbus/backend/data /opt/hotel-modbus/backend/logs
sudo chown -R 1000:1000 /opt/hotel-modbus/backend
chmod 600 .env
```

Edit `.env`, generate and set the secrets above, then ensure the Compose external network exists:

```bash
docker network create my_global_network
```

If Docker reports that the network already exists, continue. To build from the checked-out source:

```bash
docker compose up -d --build
```

To deploy the image configured in Compose instead, pull and start it:

```bash
docker compose pull
docker compose up -d
```

Check startup and health:

```bash
docker compose ps
docker compose logs --tail=100 modbus-backend
curl -fsS http://127.0.0.1:3000/api/status
```

On the first startup after this migration, all existing user accounts are deleted and exactly
one admin is created from the two `INITIAL_ADMIN_*` values. Back up the database before deploying;
this reset retains room, PLC, configuration, and history data, but cannot be undone for user
accounts. After a successful admin login, remove `INITIAL_ADMIN_PASSWORD` from `.env`. The
migration marker ensures future restarts and deployments retain accounts.

Place the service behind an HTTPS reverse proxy, restrict direct public access to port `3000`,
and ensure the proxy is the single trusted hop used by Express. After logging in as admin, set the
exact production UI origin(s) in Admin Settings and verify login, refresh, and logout through HTTPS.

Back up the SQLite database regularly. Because SQLite uses WAL mode, stop the service or use a
SQLite-aware backup procedure that includes the active WAL state; do not copy only `hotel.db`
while the application is writing.

---

## 10. Security Best Practices

1. **JWT Secret:** Keep `JWT_SECRET` private, random, and at least 32 characters. Rotating it invalidates all access tokens.

2. **Secure API Key Storage**
   - Set `API_KEY` in `.env` only when third-party access is required.
   - The current configuration uses one shared integration key; rotate it if exposed.

3. **JWT Security**
   - Use HTTPS in production; access tokens remain in memory and refresh tokens are HttpOnly cookies.
   - Access tokens expire after 15 minutes; refresh tokens rotate and expire after 7 days.
   - Logout revokes the refresh-token family; logout-all invalidates every session.

4. **HTTPS in Production**
   - Use TLS/SSL certificates
   - Keep the UI and API same-origin, or set exact allowed origins through Admin settings
   - Enable HSTS headers (enabled in production)
   - The refresh cookie is Secure in production; do not disable it

5. **CSRF and request limits**
   - Cookie-authenticated POST requests require an allowed Origin and `X-CSRF-Protection: 1`.
   - JSON request bodies are limited to 10 KB.

6. **User Credentials**
   - Passwords use bcrypt; keep the one-time bootstrap password private and remove it after setup.
   - Authentication audit events include user ID, IP, and user agent, but never tokens or passwords.

7. **Database Security**
   - Store password hashes and SHA-256 hashes of refresh tokens only.
   - Use parameterized queries
   - Run the Docker image as the non-root `node` user. Ensure bind-mounted data and log directories
     are writable by UID 1000 on the host.

---

## Support

For issues or questions, check:
- `logs/` - Application logs
- `data/hotel.db` - Users, room states, configuration, and history
