-- ============================================================================
-- HOTEL MODBUS SYSTEM - SQLITE DATABASE SCHEMA
-- ============================================================================

-- 1. Bảng cấu hình hệ thống (Key-Value)
CREATE TABLE IF NOT EXISTS system_configs (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    category TEXT DEFAULT 'general',
    description TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Bảng cấu hình PLC theo tầng
CREATE TABLE IF NOT EXISTS plcs (
    floor INTEGER PRIMARY KEY,
    ip TEXT NOT NULL,
    port INTEGER DEFAULT 502,
    slave_id INTEGER DEFAULT 1,
    timeout INTEGER DEFAULT 3000,
    start_address INTEGER DEFAULT 100,
    register_count INTEGER DEFAULT 2,
    is_active INTEGER DEFAULT 1,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. Bảng phòng và ánh xạ Modbus
CREATE TABLE IF NOT EXISTS rooms (
    room_number TEXT PRIMARY KEY,
    floor INTEGER NOT NULL,
    y_main_coil INTEGER NOT NULL,
    y_sub_coil INTEGER NOT NULL,
    x_input INTEGER NOT NULL,
    y_output_main INTEGER NOT NULL,
    y_output_sub INTEGER NOT NULL,
    description TEXT,
    is_active INTEGER DEFAULT 1,
    show_in_ui INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (floor) REFERENCES plcs(floor) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_rooms_floor ON rooms(floor);

-- 4. Bảng lưu snapshot trạng thái phòng & relay hiện tại
CREATE TABLE IF NOT EXISTS room_current_states (
    room_number TEXT PRIMARY KEY,
    state INTEGER DEFAULT 0,
    state_name TEXT DEFAULT 'Trống',
    x_input INTEGER DEFAULT 0,
    y_output_main INTEGER DEFAULT 0,
    y_output_sub INTEGER DEFAULT 0,
    main_relay_status INTEGER DEFAULT 0,
    sub_relay_status INTEGER DEFAULT 0,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (room_number) REFERENCES rooms(room_number) ON DELETE CASCADE
);

-- 5. Bảng lịch sử chuyển đổi trạng thái phòng (Audit Log)
CREATE TABLE IF NOT EXISTS room_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME NOT NULL,
    room_number TEXT NOT NULL,
    floor INTEGER NOT NULL,
    previous_state TEXT,
    new_state TEXT,
    message TEXT,
    trigger_source TEXT DEFAULT 'modbus'
);

CREATE INDEX IF NOT EXISTS idx_history_room_time ON room_history(room_number, timestamp);
CREATE INDEX IF NOT EXISTS idx_history_time ON room_history(timestamp DESC);

-- 6. Bảng thông báo hệ thống
CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    room_number TEXT NOT NULL,
    message TEXT NOT NULL,
    state_name TEXT,
    timestamp DATETIME NOT NULL,
    is_read INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_notifications_time ON notifications(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read);

-- 7. Bảng tài khoản người dùng
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    full_name TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 8. JWT access tokens for idle timeout and logout revocation
CREATE TABLE IF NOT EXISTS auth_tokens (
    token_id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    last_activity INTEGER NOT NULL,
    revoked_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (username) REFERENCES users(username) ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auth_tokens_user ON auth_tokens(username);

-- 9. Bảng API Keys tích hợp bên thứ ba (PMS / Skyhotel)
CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
