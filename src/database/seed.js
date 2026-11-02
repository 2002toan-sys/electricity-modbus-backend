import logger from '../utils/logger.js';

export function seedDatabase(db) {
  const roomCount = db.prepare('SELECT COUNT(*) as count FROM rooms').get().count;
  if (roomCount > 0) {
    logger.debug('Database already seeded, skipping seed step.');
    return;
  }

  logger.info('Seeding database with default initial data...');

  const transaction = db.transaction(() => {
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

    // 3. Seed System Configs
    const insertConfig = db.prepare(`
      INSERT OR IGNORE INTO system_configs (key, value, category, description)
      VALUES (?, ?, ?, ?)
    `);

    const configs = [
      ['app.port', '3000', 'app', 'Cổng HTTP Server'],
      ['app.polling_interval', '500', 'app', 'Tần suất đọc Modbus PLC (ms)'],
      ['app.interlock_enabled', 'true', 'app', 'Bật liên động tắt sub khi main tắt'],
      ['app.write_relay_enabled', 'true', 'app', 'Cho phép lệnh ghi relay'],
      ['notifications.telegram.enabled', 'true', 'telegram', 'Kích hoạt thông báo Telegram'],
      ['notifications.telegram.bot_token', '8491303758:AAHvbsxyBQ1tRTdbWdPruB4NANuCzhOnQI0', 'telegram', 'Token Bot Telegram'],
      ['notifications.telegram.chat_id', '-1003335218426', 'telegram', 'ID Chat Telegram'],
      ['notifications.email.enabled', 'false', 'email', 'Kích hoạt thông báo Email']
    ];

    for (const [k, v, cat, desc] of configs) {
      insertConfig.run(k, v, cat, desc);
    }

    // 4. Seed Users
    const insertUser = db.prepare(`
      INSERT OR IGNORE INTO users (username, password_hash, role, full_name)
      VALUES (?, ?, ?, ?)
    `);
    insertUser.run('admin12345', 'admin123', 'admin', 'Quản trị viên');
    insertUser.run('user', 'user123', 'user', 'Nhân viên lễ tân');

    // 5. Seed API Keys
    const insertApiKey = db.prepare(`
      INSERT OR IGNORE INTO api_keys (key, name, role, is_active)
      VALUES (?, ?, ?, 1)
    `);
    insertApiKey.run('your-secret-api-key-here', 'internal-system', 'admin');
  });

  transaction();
  logger.info('Database seeded successfully.');
}
