# Dynamic Config Screen + PostgreSQL Integration

## Tổng quan

Biến hệ thống từ **hardcoded hotel Modbus controller** thành **configurable IoT state engine**:

- **Hiện tại**: Logic tính state, tên state, màu sắc đều hardcode trong code
- **Mục tiêu**: Tất cả đều configurable trên UI — từ cách đọc PLC registers, rules tính state, đến cách hiển thị trên dashboard

**Chia 2 phase**:
- **Phase 1**: Config screen + Dynamic State Engine (file-based storage trước)
- **Phase 2**: PostgreSQL migration

---

## Kiến trúc Dynamic State Engine

### Ý tưởng cốt lõi

Thay vì hardcode:
```js
// ❌ Hiện tại: hardcode trong stateManager.js
{ name: 'Trống',     x: false, y: false, ySub: false }
{ name: 'Check-in',  x: false, y: true,  ySub: false }
// ❌ Hiện tại: hardcode trong DashboardPage.js
{ state: 'Trống', bg: 'bg-green-50', dot: 'bg-green-500' }
```

Chuyển thành **data-driven**:
```js
// ✅ Mới: Config lưu trong DB/file, đọc runtime
stateDefinitions: [
  {
    id: 0,
    name: "Trống",
    conditions: { x_input: false, y_output_main: false, y_output_sub: false },
    display: { color: "#22c55e", bgColor: "#f0fdf4", borderColor: "#bbf7d0", icon: "circle" }
  },
  {
    id: 1,
    name: "Check-in",
    conditions: { x_input: false, y_output_main: true, y_output_sub: false },
    display: { color: "#3b82f6", bgColor: "#eff6ff", borderColor: "#bfdbfe", icon: "key" }
  },
  // ... user thêm/sửa/xóa thoải mái trên config screen
]
```

### Data Flow

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  PLC Config  │────▶│  Register Reader  │────▶│  Bit Extractor   │
│  (IP, port,  │     │  (address, count) │     │  (bit positions)  │
│   registers) │     │  Config-driven    │     │  Config-driven    │
└─────────────┘     └──────────────────┘     └────────┬──────────┘
                                                       │
                                                       ▼
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Dashboard   │◀────│  Display Config   │◀────│  State Rules     │
│  (colors,    │     │  (color, name,    │     │  (conditions →   │
│   names)     │     │   icon per state) │     │   state mapping) │
└─────────────┘     └──────────────────┘     └─────────────────┘
```

---

## User Review Required

> [!IMPORTANT]
> **Dynamic State Engine**: Toàn bộ logic tính state sẽ dựa vào config thay vì hardcode. Nếu config sai → state hiển thị sai. Cần UI validation tốt + preview trước khi lưu.

> [!WARNING]
> **Backward compatibility**: Code mới sẽ fallback về default config (giống hiện tại) nếu chưa có custom config. Không break hệ thống đang chạy.

---

## Open Questions

> [!IMPORTANT]
> 1. **Notification transition messages** (vd: "Trống→Vào phòng" = "🔌 MỞ ĐIỆN + 🎫 KHÁCH VÀO PHÒNG"): Bạn muốn config luôn trên UI hay giữ trong file?
> 2. **PostgreSQL** sẽ chạy ở đâu? Thêm vào docker-compose cùng server hiện tại?

---

## Phase 1: Config Screen + Dynamic State Engine

### 1.1 — Backend: Dynamic Config System

---

#### [NEW] `src/services/dynamicConfig.js`
**Service trung tâm** quản lý toàn bộ config động:

```js
class DynamicConfig {
  // Lưu config vào file (Phase 1) hoặc DB (Phase 2)
  // Config sections:
  
  getStateDefinitions()    // → State rules + display config
  setStateDefinitions()    // ← Từ config screen
  
  getPlcConfigs()          // → PLC connection configs
  setPlcConfigs()          // ← Từ config screen
  
  getRoomMappings()        // → Room → bit position mappings
  setRoomMappings()        // ← Từ config screen
  
  getNotificationConfig()  // → Telegram, Email settings
  setNotificationConfig()  // ← Từ config screen
  
  getSystemConfig()        // → Polling, interlock, rate limit
  setSystemConfig()        // ← Từ config screen
  
  getUsersConfig()         // → User accounts
  setUsersConfig()         // ← Từ config screen
  
  getTransitionMessages()  // → State transition → message templates
  setTransitionMessages()  // ← Từ config screen
  
  // Hot-reload: Khi config thay đổi → notify services
  on('config-changed', (section) => { ... })
}
```

**Storage abstraction**:
```js
// Phase 1: File-based
class FileConfigStorage {
  async load(section)        // Read from data/dynamic-config.json
  async save(section, data)  // Write to data/dynamic-config.json
}

// Phase 2: PostgreSQL
class PostgresConfigStorage {
  async load(section)        // SELECT from config tables
  async save(section, data)  // UPSERT into config tables
}
```

#### [MODIFY] [stateManager.js](file:///c:/Users/2002t/Videos/software/hotel-modbus-system/src/services/stateManager.js)
- Xóa hardcoded `_initStateLookup()` với 5 states cố định
- Thay bằng đọc state definitions từ `dynamicConfig.getStateDefinitions()`
- `calculateRoomState()` → dùng dynamic lookup từ config
- Listen `config-changed` event → rebuild lookup table

#### [MODIFY] [configLoader.js](file:///c:/Users/2002t/Videos/software/hotel-modbus-system/src/utils/configLoader.js)
- Giữ làm "bootstrap loader" — đọc `appsettings.json` cho lần đầu
- Delegate sang `dynamicConfig` cho runtime config
- Thêm `reload()` method

#### [MODIFY] [notificationService.js](file:///c:/Users/2002t/Videos/software/hotel-modbus-system/src/services/notificationService.js)
- `stateTransitionMessages` → đọc từ `dynamicConfig.getTransitionMessages()`
- `telegramConfig` / `emailConfig` → đọc từ `dynamicConfig.getNotificationConfig()`
- Listen `config-changed` → reinit Telegram/Email

#### [MODIFY] [monitorService.js](file:///c:/Users/2002t/Videos/software/hotel-modbus-system/src/services/monitorService.js)
- Polling interval → đọc từ `dynamicConfig.getSystemConfig()`
- Listen `config-changed` → restart polling với interval mới

---

### 1.2 — Backend: Config API

---

#### [NEW] `src/controllers/configController.js`

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| **State Definitions** | | |
| GET | `/api/config/state-definitions` | Lấy danh sách state rules + display |
| PUT | `/api/config/state-definitions` | Lưu state definitions (bulk) |
| POST | `/api/config/state-definitions/preview` | Preview: gửi D100, D101 → trả về state result |
| **PLC Config** | | |
| GET | `/api/config/plcs` | Lấy PLC configs |
| PUT | `/api/config/plcs` | Lưu PLC configs (bulk) |
| POST | `/api/config/plcs/test-connection` | Test kết nối PLC |
| **Room Mapping** | | |
| GET | `/api/config/rooms` | Lấy room mappings |
| PUT | `/api/config/rooms` | Lưu room mappings (bulk) |
| **Users** | | |
| GET | `/api/config/users` | Lấy users (không trả password) |
| POST | `/api/config/users` | Thêm user |
| PUT | `/api/config/users/:id` | Sửa user |
| DELETE | `/api/config/users/:id` | Xóa user |
| **Notifications** | | |
| GET | `/api/config/notifications` | Lấy notification settings |
| PUT | `/api/config/notifications` | Lưu notification settings |
| POST | `/api/config/notifications/test` | Test gửi notification |
| **System** | | |
| GET | `/api/config/system` | Lấy system config |
| PUT | `/api/config/system` | Lưu system config |
| **Transition Messages** | | |
| GET | `/api/config/transitions` | Lấy state transition messages |
| PUT | `/api/config/transitions` | Lưu transition messages |
| **Full Config** | | |
| GET | `/api/config/all` | Export toàn bộ config |
| POST | `/api/config/import` | Import config từ JSON |

#### [NEW] `src/middleware/adminOnly.js`
- Chỉ cho phép role `admin` truy cập config API

#### [MODIFY] [routes/index.js](file:///c:/Users/2002t/Videos/software/hotel-modbus-system/src/routes/index.js)
- Thêm config routes, protected bởi `authenticate` + `adminOnly`

---

### 1.3 — Frontend: Config Screen UI

---

#### [NEW] `src/components/config/ConfigPage.js`
**Màn hình config chính** — layout 2 cột:
- **Left**: Vertical tab menu (State Definitions, PLC, Rooms, Users, Notifications, System, Transitions)
- **Right**: Nội dung tab tương ứng

#### [NEW] `src/components/config/StateDefinitionsTab.js`
**⭐ Tab quan trọng nhất** — Dynamic State Rules Editor:

```
┌──────────────────────────────────────────────────────────┐
│  STATE DEFINITIONS                              [+ Thêm] │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌─ State #0 ─────────────────────────────────────────┐  │
│  │ Tên: [Trống________]  Màu: [🟢 ████ ] Color Picker │  │
│  │                                                     │  │
│  │ Điều kiện:                                          │  │
│  │   x_input:      [false ▼]                           │  │
│  │   y_output_main: [false ▼]                          │  │
│  │   y_output_sub:  [false ▼]                          │  │
│  │                                             [🗑 Xóa] │  │
│  └─────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌─ State #1 ─────────────────────────────────────────┐  │
│  │ Tên: [Check-in_____]  Màu: [🔵 ████ ] Color Picker │  │
│  │ Điều kiện:                                          │  │
│  │   x_input:      [false ▼]                           │  │
│  │   y_output_main: [true  ▼]                          │  │
│  │   y_output_sub:  [false ▼]                          │  │
│  └─────────────────────────────────────────────────────┘  │
│  ...                                                     │
├──────────────────────────────────────────────────────────┤
│  📋 LIVE PREVIEW                                         │
│  ┌────────────────────────────────────────────────────┐  │
│  │ D100: [____] D101: [____]  Room: [201 ▼] [▶ Test] │  │
│  │                                                    │  │
│  │ Kết quả: ██ Check-in (x=0, y_main=1, y_sub=0)     │  │
│  │ Màu hiển thị: [████████████████████]               │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  [💾 Lưu cấu hình]                                      │
└──────────────────────────────────────────────────────────┘
```

**Key features**:
- Drag-and-drop reorder states
- Color picker cho mỗi state
- **Live preview**: Nhập giá trị D100/D101 → hiển thị kết quả state ngay lập tức
- Validation: cảnh báo nếu 2 states có cùng conditions
- Preview card hiển thị giống RoomCard trên dashboard

#### [NEW] `src/components/config/PlcConfigTab.js`
- Bảng editable: floor, IP, port, slaveId, timeout, data registers
- Nút "Test Connection" → gọi API kiểm tra kết nối PLC
- Thêm/xóa PLC

#### [NEW] `src/components/config/RoomMappingTab.js`
- Bảng editable: room number, floor, coil addresses, bit positions
- Auto-generate rooms cho 1 floor (bulk add)
- Visual bit map: hiển thị register D100/D101 với bit positions được highlight

#### [NEW] `src/components/config/UsersTab.js`
- Bảng users: username, role, actions (edit/delete)
- Form thêm/sửa user
- Không hiển thị password, chỉ có option reset

#### [NEW] `src/components/config/NotificationsTab.js`
- Telegram config: bot token, chat ID, enabled toggle
- Email config: SMTP settings, enabled toggle
- Nút "Test" gửi thử thông báo

#### [NEW] `src/components/config/SystemTab.js`
- Polling interval (ms)
- Interlock enabled (toggle)
- Write relay enabled (toggle)
- Rate limit config
- HTTP keep-alive timeout

#### [NEW] `src/components/config/TransitionsTab.js`
- Bảng: State A → State B → Message template
- Auto-generate từ state definitions (tổ hợp)
- Hỗ trợ biến `{room}`, `{floor}`, `{time}`
- Emoji picker

---

### 1.4 — Frontend: Integrate vào App

---

#### [MODIFY] [Sidebar.js](file:///c:/Users/2002t/Videos/software/modbus-control-frontend/src/components/Sidebar.js)
- Thêm nav item `{ id: 'config', label: 'Cấu hình', icon: Settings }` — chỉ hiện cho admin

#### [MODIFY] [App.js](file:///c:/Users/2002t/Videos/software/modbus-control-frontend/src/App.js)
- Import `ConfigPage`
- Render khi `activePage === 'config'`
- Truyền state definitions xuống `DashboardPage` để dùng dynamic colors/names

#### [MODIFY] [DashboardPage.js](file:///c:/Users/2002t/Videos/software/modbus-control-frontend/src/components/DashboardPage.js)
- Xóa hardcoded `STAT_CONFIGS`
- Nhận `stateDefinitions` từ props/API
- Render stat cards và room cards theo dynamic config

#### [MODIFY] [RoomCard.js](file:///c:/Users/2002t/Videos/software/modbus-control-frontend/src/components/RoomCard.js)
- Nhận display config từ props thay vì hardcode màu

#### [MODIFY] [api.js](file:///c:/Users/2002t/Videos/software/modbus-control-frontend/src/services/api.js)
- Thêm methods cho config API endpoints
- Thêm `getStateDefinitions()` — gọi lúc app load

---

### 1.5 — Default Config (Backward Compatibility)

---

#### [NEW] `src/config/defaultStateDefinitions.js` (backend)
Default config giống hệ thống hiện tại — dùng khi chưa có custom config:

```js
export default [
  {
    id: 0, name: 'Trống',
    conditions: { x_input: false, y_output_main: false, y_output_sub: false },
    display: { color: '#22c55e', bgColor: '#f0fdf4', borderColor: '#bbf7d0', dotColor: '#22c55e', textColor: '#15803d' }
  },
  {
    id: 1, name: 'Check-in',
    conditions: { x_input: false, y_output_main: true, y_output_sub: false },
    display: { color: '#3b82f6', bgColor: '#eff6ff', borderColor: '#bfdbfe', dotColor: '#3b82f6', textColor: '#1d4ed8' }
  },
  {
    id: 2, name: 'Vào phòng',
    conditions: { x_input: true, y_output_main: true, y_output_sub: false },
    display: { color: '#ef4444', bgColor: '#fef2f2', borderColor: '#fecaca', dotColor: '#ef4444', textColor: '#b91c1c' }
  },
  {
    id: 3, name: 'Dùng thẻ',
    conditions: { x_input: true, y_output_main: true, y_output_sub: true },
    display: { color: '#eab308', bgColor: '#fefce8', borderColor: '#fef08a', dotColor: '#eab308', textColor: '#a16207' }
  },
  {
    id: 4, name: 'Sửa chữa',
    conditions: { x_input: true, y_output_main: false, y_output_sub: true },
    display: { color: '#6b7280', bgColor: '#f9fafb', borderColor: '#e5e7eb', dotColor: '#6b7280', textColor: '#4b5563' }
  }
];
```

---

## Phase 2: PostgreSQL Migration

> [!NOTE]
> Phase 2 thực hiện **sau khi Phase 1 hoàn thành và ổn định**. Storage abstraction trong Phase 1 đã chuẩn bị sẵn interface cho việc swap sang PostgreSQL.

### 2.1 — Setup PostgreSQL

#### [MODIFY] [docker-compose.yml](file:///c:/Users/2002t/Videos/software/hotel-modbus-system/docker-compose.yml)
- Thêm PostgreSQL service, volumes, healthcheck

#### [MODIFY] [.env](file:///c:/Users/2002t/Videos/software/hotel-modbus-system/.env)
- Thêm `DATABASE_URL`

#### [NEW] `src/database/init.sql`
- Schema cho tất cả tables: config, state_history, notifications, users

#### [NEW] `src/database/db.js`
- Connection pool, query helpers

### 2.2 — Implement PostgresConfigStorage

#### [NEW] `src/services/storage/postgresStorage.js`
- Implement `PostgresConfigStorage` interface (cùng API với `FileConfigStorage`)

### 2.3 — Migrate Data Services

#### [MODIFY] `historyLogger.js` → Write to PostgreSQL
#### [MODIFY] `notificationLogger.js` → Write to PostgreSQL
#### [MODIFY] `authController.js` → Users from PostgreSQL + bcrypt

#### [NEW] `src/database/seed.js`
- One-time migration script: import từ `appsettings.json` + CSV files vào PostgreSQL

### 2.4 — Dependencies

#### [MODIFY] [package.json](file:///c:/Users/2002t/Videos/software/hotel-modbus-system/package.json)
- Thêm `pg`, `bcrypt`

---

## Verification Plan

### Phase 1 Verification

#### Manual Testing
1. **Config Screen Access**: Login admin → thấy menu "Cấu hình" trên sidebar
2. **State Definitions**:
   - Xem danh sách 5 state mặc định
   - Thay đổi màu sắc → dashboard cập nhật ngay
   - Thêm state mới → dashboard hiển thị state mới
   - Live preview: nhập D100=0, D101=2 → hiện "Check-in" với màu tương ứng
3. **PLC Config**: Thay đổi IP → backend reconnect PLC
4. **Room Mapping**: Thêm phòng mới → dashboard hiển thị phòng mới
5. **Users**: Thêm user → đăng nhập bằng user mới thành công
6. **Notifications**: Config Telegram → test gửi → nhận được message
7. **Non-admin**: Login user thường → không thấy menu config

### Phase 2 Verification
```bash
docker compose up -d                 # PostgreSQL + Backend start
node src/database/seed.js            # Import data
npm run dev                          # Backend chạy với PostgreSQL
```
- State history lưu vào DB → query trên config screen
- Config thay đổi → persist vào PostgreSQL
