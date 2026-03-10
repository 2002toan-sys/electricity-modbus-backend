# Hotel Modbus System - Integration Guide

## Overview

This system manages hotel room access control via Modbus TCP relay control with comprehensive authentication, state tracking, and real-time notifications.

## Features

-- ✅ **Dual Authentication**: API Key (third-party) + Session (frontend)
- ✅ **Role-based Access Control**: Admin (full control) + User (limited sub relay)
- ✅ **State Transitions**: Automatic state calculation (5 Vietnamese states)
- ✅ **State History**: CSV logging with queryable API
- ✅ **Real-time Notifications**: WebSocket + Telegram + Email
- ✅ **Concurrent Write Safety**: Floor-based queue system
- ✅ **Per-floor Parallel Polling**: No blocking between floors

---

## 1. API Endpoints

### Authentication

#### POST /api/auth/login
Frontend login to create a server-side session (cookie).

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
  "user": {
    "username": "admin",
    "role": "admin"
  }
}
```

**Available users** (from appsettings.json):
- **admin** / admin123 (full control)
- **user** / user123 (limited sub relay only)

---

#### GET /api/auth/verify
Verify session (checks server-side session cookie).

**Request (with session cookie):**
```bash
# Use cookie saved from login (cookie jar)
curl -b cookies.txt -X GET http://localhost:3000/api/auth/verify
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

#### Frontend Session (browser or app)

Frontend logs in and receives a server-side session cookie. Use that cookie for subsequent API calls. Example with `curl` cookie jar:

```bash
# Login and save cookie
curl -c cookies.txt -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "admin123"}'

# Use saved cookie to call main relay (Admin)
curl -b cookies.txt -X POST http://localhost:3000/api/relay/main/set \
  -H "Content-Type: application/json" \
  -d '[{"room": "201", "set": "on"}]'

# Use saved cookie to call sub relay (User allowed only if main is ON)
curl -b cookies.txt -X POST http://localhost:3000/api/relay/sub/set \
  -H "Content-Type: application/json" \
  -d '[{"room": "201", "set": "on"}]'
```

### Monitoring

#### GET /api/monitor/rooms
Get current room states with state calculations.

**Request (browser/frontend - with session cookie):**
```bash
# Use cookie saved from login (cookie jar)
curl -b cookies.txt -X GET "http://localhost:3000/api/monitor/rooms"
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
      "stateName": "Vào phòng",
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
| State | Name | Color | x_input | y_main | y_sub |
|-------|------|-------|---------|--------|-------|
| 0 | Trống | 🟢 Green | 0 | 0 | 0 |
| 1 | Check-in | 🔵 Blue | 0 | 1 | 0 |
| 2 | Vào phòng | 🔴 Red | 1 | 1 | 0 |
| 3 | Dùng thẻ | 🟡 Yellow | 1 | 1 | 1 |
| 4 | Sửa chữa | ⚫ Black | 1 | 0 | 1 |

---

#### GET /api/monitor/plc-status
Get PLC connection status.

**Request (browser/frontend - with session cookie):**
```bash
curl -b cookies.txt -X GET "http://localhost:3000/api/monitor/plc-status"
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
Get state change history (CSV logged).

**Query Parameters:**
- `room` (optional): Filter by room number (e.g., "201")
- `limit` (optional): Number of records (default: 100)
- `startDate` (optional): ISO date string (e.g., "2025-12-01T00:00:00Z")
- `endDate` (optional): ISO date string

**Examples:**

Get last 50 changes for room 201 (session cookie):
```bash
curl -b cookies.txt -X GET "http://localhost:3000/api/monitor/history?room=201&limit=50"
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
      "new_state": "Vào phòng",
      "message": "✅ Đã cấp điện và cắm thẻ phòng 201"
    },
    {
      "timestamp": "2025-12-02T10:30:00.000Z",
      "room": "201",
      "floor": "2",
      "previous_state": "Check-in",
      "new_state": "Vào phòng",
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
const socket = io('http://localhost:3000');

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
      newState: "Vào phòng",
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
| Trống → Vào phòng | ✅ Đã cấp điện và cắm thẻ phòng {room} |
| Trống → Check-in | ✅ Đã cấp điện phòng {room} |
| Check-in → Vào phòng | ✅ Đã cắm thẻ phòng {room} |
| Vào phòng → Dùng thẻ | ⚠️ Đã bật điện cưỡng bức phòng {room} |
| Vào phòng → Check-in | ⚠️ Đã rút thẻ phòng {room} |
| Dùng thẻ → Trống | ❌ Đã cắt điện phòng {room} |
| Vào phòng → Trống | ❌ Đã cắt điện phòng {room} |
| Check-in → Trống | ❌ Đã cắt điện phòng {room} |
| Trống → Sửa chữa | 🔧 Đang sửa chữa phòng {room} |

---

## 4. Notification Channels

### Telegram (Optional)

**Enable in appsettings.json:**
```json
{
  "notifications": {
    "telegram": {
      "enabled": true,
      "botToken": "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
      "chatId": "-1001234567890"
    }
  }
}
```

**How to get Bot Token & Chat ID:**
1. Create bot via [@BotFather](https://t.me/botfather)
2. Get your chat ID: https://api.telegram.org/bot{BOT_TOKEN}/getUpdates
3. Save tokens to appsettings.json

---

### Email (Optional)

**Enable in appsettings.json:**
```json
{
  "notifications": {
    "email": {
      "enabled": true,
      "service": "gmail",
      "user": "your-email@gmail.com",
      "password": "your-app-password",
      "to": "admin@hotel.com"
    }
  }
}
```

**Gmail Setup:**
1. Enable 2-Factor Authentication
2. Create App Password: https://myaccount.google.com/apppasswords
3. Use App Password in config

---

## 5. Frontend Integration Example (Vue.js / React)

**Authentication:** Uses server-side session. Login once to get session cookie, then browser automatically sends it with all requests.

```javascript
// Login (session-based - browser saves cookie automatically)
async function login(username, password) {
  const response = await fetch('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',  // Important: send and save cookies
    body: JSON.stringify({ username, password })
  });
  const data = await response.json();
  if (data.user) {
    // Store only non-sensitive info for client-side UI
    localStorage.setItem('role', data.user.role);
    localStorage.setItem('username', data.user.username);
  }
  return data;
}

// Verify session (check if still logged in)
async function verifySession() {
  const response = await fetch('http://localhost:3000/api/auth/verify', {
    credentials: 'include'  // Send session cookie
  });
  return await response.json();
}

// Logout
async function logout() {
  const response = await fetch('http://localhost:3000/api/auth/logout', {
    method: 'POST',
    credentials: 'include'
  });
  localStorage.removeItem('role');
  localStorage.removeItem('username');
  return await response.json();
}

// Fetch room states (browser sends session cookie automatically)
async function getRoomStates() {
  const response = await fetch('http://localhost:3000/api/monitor/rooms', {
    credentials: 'include'  // Send session cookie
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
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',  // Send session cookie
    body: JSON.stringify([{ room, set: value }])
  });
  return await response.json();
}

// Listen to real-time WebSocket updates
const socket = io('http://localhost:3000');

socket.on('room-states', (states) => {
  updateUI(states);
});

socket.on('state-changed', (notification) => {
  showNotification(notification.message, notification.newState);
});
```

---

## 6. Third-party API Integration (API Key)

For external systems (door locks, booking system, etc.), use an API Key mapped in `appsettings.json`:

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

### Get history for specific room (session)
```bash
curl -b cookies.txt "http://localhost:3000/api/monitor/history?room=201&limit=20"
```

### Get history for specific room (API Key)
```bash
curl "http://localhost:3000/api/monitor/history?room=201&limit=20" \
  -H "X-API-Key: your-secret-api-key-here"
```

### Get history with date filter
```bash
curl -b cookies.txt "http://localhost:3000/api/monitor/history?startDate=2025-12-01T00:00:00Z&endDate=2025-12-02T23:59:59Z"
```

### Export to CSV (via script)
```bash
curl -b cookies.txt "http://localhost:3000/api/monitor/history?limit=1000" \
  | jq -r '.data[] | [.timestamp, .room, .previous_state, .new_state, .message] | @csv' > history.csv
```

---

## 8. Error Handling

### Session Expired or Invalid
```json
{
  "error": "Unauthorized"
}
```
**Solution:** Call `POST /api/auth/login` again to create a new session

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
**Solution:** Check PLC IP/port in appsettings.json and network connectivity

---

## 9. Configuration

### appsettings.json - Auth Section

```json
{
  "auth": {
    "session": {
      "secret": "your-session-secret-change-in-production",
      "maxAge": 86400000
    },
    "users": [
      {
        "username": "admin",
        "password": "admin123",
        "role": "admin"
      },
      {
        "username": "user",
        "password": "user123",
        "role": "user"
      }
    ],
    "apiKeys": [
      {
        "key": "your-secret-api-key-here",
        "role": "admin",
        "name": "internal-system"
      }
    ]
  },
  "notifications": {
    "telegram": {
      "enabled": false,
      "botToken": "...",
      "chatId": "..."
    },
    "email": {
      "enabled": false,
      "service": "gmail",
      "user": "...",
      "password": "...",
      "to": "..."
    },
    "stateTransitions": {
      "Trống-Vào phòng": "✅ Đã cấp điện và cắm thẻ phòng {room}"
    }
  }
}
```

---

## 10. Security Best Practices

1. **Change Session Secret in Production**
   ```json
   "auth": { "session": { "secret": "generate-random-string-min-32-chars" } }
   ```

2. **Secure API Key Storage**
   - Move `apiKeys` to `.env` file (not in config) for production
   - Rotate API keys regularly
   - Use different keys per third-party client
   - Log API key usage for auditing

3. **Session Security**
   - In production: Set `cookie.secure: true` (HTTPS only)
   - Set `cookie.httpOnly: true` (prevent JavaScript access)
   - Consider using Redis session store for scalability

4. **HTTPS in Production**
   - Use TLS/SSL certificates
   - Update CORS origins to specific domains
   - Enable HSTS headers

5. **User Credentials**
   - Enforce strong passwords
   - Consider external auth (OAuth2, LDAP, SSO)
   - Audit login attempts and set lockout policies

6. **Database Security** (if added)
   - Hash passwords with bcrypt
   - Use parameterized queries
   - Encrypt sensitive relay state data

---

## Support

For issues or questions, check:
- `logs/` - Application logs
- `data/state-history.csv` - State change history
- `data/state.json` - Current coil states

