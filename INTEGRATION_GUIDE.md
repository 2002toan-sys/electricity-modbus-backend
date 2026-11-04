# Hotel Modbus System - Integration Guide

## Overview

This system manages hotel room access control via Modbus TCP relay control with comprehensive authentication, state tracking, and real-time notifications.

## Features

- ✅ **Dual Authentication**: JWT bearer token (frontend) + API key (third-party)
- ✅ **Role-based Access Control**: Admin (full control) + User (limited sub relay)
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
  -d '{"username": "admin", "password": "admin123"}'
```

**Response:**
```json
{
  "success": true,
  "accessToken": "<JWT>",
  "user": {
    "username": "admin",
    "role": "admin"
  }
}
```

**Default users** (created in SQLite on first setup; change the passwords after login):
- **admin12345** / admin123 (full control)
- **user** / user123 (limited sub relay only)

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
    "username": "admin",
    "role": "admin"
  }
}
```

---

### Relay Control

#### Option 1: API Key (Third-party Integration)

##### POST /api/relay/main/set
Control main relay using API Key.

**Request:**
```bash
curl -X POST http://localhost:3000/api/relay/main/set \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-secret-api-key-here" \
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
  -H "X-API-Key: your-secret-api-key-here" \
  -d '[{"room": "201", "set": "on"}]'
```

---

#### Frontend JWT (browser or app)

Send the access token in the `Authorization` header for subsequent API calls:

```bash
# Login and copy accessToken from the response
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "admin123"}'

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

Access tokens are renewed by `/api/auth/activity` and expire after 24 hours without activity.
Call `/api/auth/logout` with the bearer token to revoke it immediately. `API_KEY` is optional and
should be enabled only when a trusted third-party system needs machine-to-machine access. API keys
do not authenticate user-management or configuration endpoints.

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
  -H "X-API-Key: your-secret-api-key-here"
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
  -H "X-API-Key: your-secret-api-key-here"
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
  -H "X-API-Key: your-secret-api-key-here"
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

**Authentication:** Login to receive an access token and send it as a bearer token with every protected request.

```javascript
let accessToken;

async function login(username, password) {
  const response = await fetch('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  const data = await response.json();
  accessToken = data.accessToken;
  return data;
}

// Verify the access token
async function verifyToken() {
  const response = await fetch('http://localhost:3000/api/auth/verify', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  return await response.json();
}

// Logout
async function logout() {
  const response = await fetch('http://localhost:3000/api/auth/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` }
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

API_KEY="your-secret-api-key-here"
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
  -H "X-API-Key: your-secret-api-key-here"
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
**Solution:** Call `POST /api/auth/login` again to obtain a new access token.

### Insufficient Permissions
```json
{
  "error": "User can only control sub relay when main relay is ON"
}
```
**Solution:** Turn on main relay first (admin only)

### PLC Connection Error
```json
{
  "error": "PLC connection lost"
}
```
**Solution:** Check the PLC IP/port in the application's Settings page and verify network connectivity

---

## 9. Configuration

### Environment - Auth secrets

```dotenv
JWT_SECRET=generate-a-random-secret-at-least-32-characters
API_KEY=optional-random-secret-for-third-party-integration
```

---

## 10. Security Best Practices

1. **JWT Secret:** Keep `JWT_SECRET` private, random, and at least 32 characters. Rotating it invalidates all access tokens.

2. **Secure API Key Storage**
   - Set `API_KEY` in `.env` only when third-party access is required.
   - The current configuration uses one shared integration key; rotate it if exposed.

3. **JWT Security**
   - Use HTTPS in production; browser access tokens are stored in session storage.
   - Access tokens expire after 24 hours without activity; logout revokes the token in SQLite.

4. **HTTPS in Production**
   - Use TLS/SSL certificates
   - Update CORS origins to specific domains
   - Enable HSTS headers

5. **User Credentials**
   - Enforce strong passwords
   - Consider external auth (OAuth2, LDAP, SSO)
   - Audit login attempts and set lockout policies

6. **Database Security**
   - Hash passwords with bcrypt
   - Use parameterized queries
   - Encrypt sensitive relay state data

---

## Support

For issues or questions, check:
- `logs/` - Application logs
- `data/hotel.db` - Users, room states, configuration, and history
