import logger from '../utils/logger.js';
import { hashPassword } from '../utils/password.js';

const DEFAULT_CORS_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001'
];

const DEFAULT_STATE_TRANSITIONS = {
  'Trống-Có khách': '🔌 MỞ ĐIỆN + 🎫 KHÁCH VÀO PHÒNG | {room}',
  'Trống-Chờ khách': '🔌 MỞ ĐIỆN | {room}',
  'Chờ khách-Có khách': '🎫 KHÁCH VÀO PHÒNG | {room}',
  'Có khách-Bật cưỡng bức': '💳 MỞ ĐIỆN THỦ CÔNG | {room}',
  'Có khách-Chờ khách': '⚠️ KHÁCH RA NGOÀI | {room}',
  'Bật cưỡng bức-Trống': '❌ ĐÓNG ĐIỆN | {room}',
  'Có khách-Trống': '❌ ĐÓNG ĐIỆN + KHÁCH RA NGOÀI | {room}',
  'Chờ khách-Trống': '⛔ ĐÓNG ĐIỆN | {room}',
  'Trống-Bảo trì': '🔧 BẢO TRÌ | {room}'
};

const STATE_NAME_RENAMES = {
  'Check-in': 'Chờ khách',
  'Vào phòng': 'Có khách',
  'Dùng thẻ': 'Bật cưỡng bức',
  'Bật tay': 'Bật cưỡng bức',
  'Sửa chữa': 'Bảo trì'
};

const TRANSITION_RENAMES = {
  'Trống-Vào phòng': 'Trống-Có khách',
  'Trống-Check-in': 'Trống-Chờ khách',
  'Check-in-Vào phòng': 'Chờ khách-Có khách',
  'Vào phòng-Dùng thẻ': 'Có khách-Bật cưỡng bức',
  'Vào phòng-Check-in': 'Có khách-Chờ khách',
  'Dùng thẻ-Trống': 'Bật cưỡng bức-Trống',
  'Vào phòng-Trống': 'Có khách-Trống',
  'Check-in-Trống': 'Chờ khách-Trống',
  'Trống-Sửa chữa': 'Trống-Bảo trì',
  'Có khách-Bật tay': 'Có khách-Bật cưỡng bức',
  'Bật tay-Trống': 'Bật cưỡng bức-Trống'
};

function migrateStateNames(db) {
  const renameState = db.prepare(`
    UPDATE room_current_states SET state_name = ?
    WHERE state_name = ?
  `);
  const renamePreviousState = db.prepare(`
    UPDATE room_history SET previous_state = ?
    WHERE previous_state = ?
  `);
  const renameNewState = db.prepare(`
    UPDATE room_history SET new_state = ?
    WHERE new_state = ?
  `);
  const renameNotificationState = db.prepare(`
    UPDATE notifications SET state_name = ?
    WHERE state_name = ?
  `);
  for (const [oldName, newName] of Object.entries(STATE_NAME_RENAMES)) {
    renameState.run(newName, oldName);
    renamePreviousState.run(newName, oldName);
    renameNewState.run(newName, oldName);
    renameNotificationState.run(newName, oldName);
  }

  const findConfig = db.prepare('SELECT value FROM system_configs WHERE key = ?');
  const renameConfig = db.prepare(`
    UPDATE system_configs
    SET key = ?, description = ?, updated_at = datetime('now')
    WHERE key = ?
  `);
  const deleteConfig = db.prepare('DELETE FROM system_configs WHERE key = ?');
  for (const [oldTransition, newTransition] of Object.entries(TRANSITION_RENAMES)) {
    const oldKey = `notifications.stateTransitions.${oldTransition}`;
    const newKey = `notifications.stateTransitions.${newTransition}`;
    const oldConfig = findConfig.get(oldKey);
    if (!oldConfig) continue;

    if (findConfig.get(newKey)) {
      deleteConfig.run(oldKey);
      continue;
    }

    renameConfig.run(newKey, `Thông báo chuyển trạng thái ${newTransition}`, oldKey);
  }
}

export function seedDatabase(db) {
  const roomCount = db.prepare('SELECT COUNT(*) as count FROM rooms').get().count;
  if (roomCount === 0) logger.info('Seeding database with default initial data...');

  const transaction = db.transaction(() => {
    migrateStateNames(db);

    if (roomCount === 0) {
    // 1. Seed PLCs (Floors 2 to 7)
    const insertPlc = db.prepare(`
      INSERT OR IGNORE INTO plcs (floor, ip, port, slave_id, timeout, start_address, register_count, is_active)
      VALUES (@floor, @ip, @port, @slave_id, @timeout, @start_address, @register_count, 1)
    `);

    const plcs = [
      { floor: 2, ip: '192.168.10.242', port: 502, slave_id: 1, timeout: 3000, start_address: 100, register_count: 2 },
      { floor: 3, ip: '192.168.10.243', port: 502, slave_id: 1, timeout: 3000, start_address: 100, register_count: 2 },
      { floor: 4, ip: '192.168.10.244', port: 502, slave_id: 1, timeout: 3000, start_address: 100, register_count: 2 },
      { floor: 5, ip: '192.168.10.245', port: 502, slave_id: 1, timeout: 3000, start_address: 100, register_count: 2 },
      { floor: 6, ip: '192.168.10.246', port: 502, slave_id: 1, timeout: 3000, start_address: 100, register_count: 2 },
      { floor: 7, ip: '192.168.10.247', port: 502, slave_id: 1, timeout: 3000, start_address: 100, register_count: 2 },
    ];

    for (const plc of plcs) {
      insertPlc.run(plc);
    }

    // 2. Seed Rooms (6 floors x 6 rooms = 36 rooms)
    const insertRoom = db.prepare(`
      INSERT OR IGNORE INTO rooms (room_number, floor, y_main_coil, y_sub_coil, x_input, y_output_main, y_output_sub, description, is_active)
      VALUES (@room_number, @floor, @y_main_coil, @y_sub_coil, @x_input, @y_output_main, @y_output_sub, @description, 1)
    `);

    const insertInitialState = db.prepare(`
      INSERT OR IGNORE INTO room_current_states (room_number, state, state_name, x_input, y_output_main, y_output_sub, main_relay_status, sub_relay_status, last_updated)
      VALUES (?, 0, 'Trống', 0, 0, 0, 0, 0, datetime('now'))
    `);

    const floors = [2, 3, 4, 5, 6, 7];
    const roomOffsets = [
      { num: 1, y_main: 501, y_sub: 509, x_in: 0, y_out_m: 0, y_out_s: 8 },
      { num: 2, y_main: 502, y_sub: 510, x_in: 1, y_out_m: 1, y_out_s: 9 },
      { num: 3, y_main: 503, y_sub: 511, x_in: 2, y_out_m: 2, y_out_s: 10 },
      { num: 4, y_main: 504, y_sub: 512, x_in: 3, y_out_m: 3, y_out_s: 11 },
      { num: 5, y_main: 505, y_sub: 513, x_in: 4, y_out_m: 4, y_out_s: 12 },
      { num: 6, y_main: 506, y_sub: 514, x_in: 5, y_out_m: 5, y_out_s: 13 },
    ];

    for (const floor of floors) {
      for (const offset of roomOffsets) {
        const roomNumber = `${floor}0${offset.num}`;
        insertRoom.run({
          room_number: roomNumber,
          floor,
          y_main_coil: offset.y_main,
          y_sub_coil: offset.y_sub,
          x_input: offset.x_in,
          y_output_main: offset.y_out_m,
          y_output_sub: offset.y_out_s,
          description: `Phòng ${roomNumber} - Tầng ${floor}`
        });

        insertInitialState.run(roomNumber);
      }
    }
    }

    // 3. Seed System Configs
    const insertConfig = db.prepare(`
      INSERT OR IGNORE INTO system_configs (key, value, category, description)
      VALUES (?, ?, ?, ?)
    `);

    const configEntry = (key, value, category, description) => [
      key,
      typeof value === 'string' ? value : JSON.stringify(value),
      category,
      description
    ];
    const configs = [
      configEntry('app.port', 3000, 'app', 'Cổng HTTP Server'),
      configEntry('app.polling_interval', 500, 'app', 'Tần suất đọc Modbus PLC (ms)'),
      configEntry('app.interlock_enabled', true, 'app', 'Tự động tắt relay phụ khi relay chính tắt'),
      configEntry('app.write_relay_enabled', true, 'app', 'Cho phép lệnh ghi relay'),
      configEntry('app.http_keep_alive_timeout', 60000, 'app', 'HTTP keep-alive timeout (ms)'),
      configEntry('app.cors_origins', DEFAULT_CORS_ORIGINS, 'app', 'Danh sách CORS origins được phép'),
      configEntry('rateLimit.windowMs', 60000, 'rateLimit', 'Cửa sổ giới hạn request (ms)'),
      configEntry('rateLimit.maxRequests', 100, 'rateLimit', 'Số request tối đa trong cửa sổ'),
      configEntry('reconnect.initialDelay', 2000, 'reconnect', 'Thời gian chờ reconnect ban đầu (ms)'),
      configEntry('reconnect.maxDelay', 30000, 'reconnect', 'Thời gian chờ reconnect tối đa (ms)'),
      configEntry('reconnect.backoffMultiplier', 1.5, 'reconnect', 'Hệ số tăng thời gian reconnect'),
      configEntry('notifications.telegram.enabled', false, 'telegram', 'Kích hoạt thông báo Telegram'),
      configEntry('notifications.telegram.bot_token', '', 'telegram', 'Token Bot Telegram'),
      configEntry('notifications.telegram.chat_id', '', 'telegram', 'ID Chat Telegram'),
      configEntry('notifications.email.enabled', false, 'email', 'Kích hoạt thông báo Email'),
      configEntry('notifications.email.service', 'gmail', 'email', 'Dịch vụ SMTP email'),
      configEntry('notifications.email.user', '', 'email', 'Tài khoản email gửi'),
      configEntry('notifications.email.password', '', 'email', 'Mật khẩu ứng dụng email'),
      configEntry('notifications.email.to', '', 'email', 'Địa chỉ email nhận'),
      ...Object.entries(DEFAULT_STATE_TRANSITIONS).map(([transition, message]) =>
        configEntry(`notifications.stateTransitions.${transition}`, message, 'stateTransitions', `Thông báo chuyển trạng thái ${transition}`)
      )
    ];

    for (const [k, v, cat, desc] of configs) {
      insertConfig.run(k, v, cat, desc);
    }

    // 4. Seed Users
    if (roomCount === 0) {
      const insertUser = db.prepare(`
        INSERT OR IGNORE INTO users (username, password_hash, role, full_name)
        VALUES (?, ?, ?, ?)
      `);
      insertUser.run('admin12345', hashPassword('admin123'), 'admin', 'Quản trị viên');
      insertUser.run('user', hashPassword('user123'), 'user', 'Nhân viên lễ tân');
    }

  });

  transaction();
  logger.info(roomCount === 0 ? 'Database seeded successfully.' : 'System config defaults ensured.');
}
