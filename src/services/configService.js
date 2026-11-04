import db from '../database/db.js';

class ConfigService {
  getAllSystemConfigs() {
    return db.prepare('SELECT key, value FROM system_configs').all();
  }

  getSystemConfigValue(key) {
    return db.prepare('SELECT value FROM system_configs WHERE key = ?').get(key)?.value;
  }

  upsertSystemConfigs(entries) {
    const upsert = db.prepare(`
      INSERT INTO system_configs (key, value, category, description, updated_at)
      VALUES (@key, @value, @category, @description, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        category = excluded.category,
        description = excluded.description,
        updated_at = datetime('now')
    `);
    db.transaction(() => {
      for (const entry of entries) upsert.run(entry);
    })();
  }

  listPlcs() {
    return db.prepare(`
      SELECT floor, ip, port, slave_id, timeout, start_address, register_count, is_active
      FROM plcs
      ORDER BY floor
    `).all();
  }

  getPlc(floor) {
    return db.prepare(`
      SELECT floor, ip, port, slave_id, timeout, start_address, register_count, is_active
      FROM plcs
      WHERE floor = ?
    `).get(floor);
  }

  hasPlc(floor) {
    return Boolean(db.prepare('SELECT floor FROM plcs WHERE floor = ?').get(floor));
  }

  createPlc(floor, plc) {
    db.prepare(`
      INSERT INTO plcs (floor, ip, port, slave_id, timeout, start_address, register_count, is_active)
      VALUES (@floor, @ip, @port, @slave_id, @timeout, @start_address, @register_count, 1)
    `).run({ floor, ...plc });
  }

  updatePlc(floor, plc) {
    db.prepare(`
      UPDATE plcs
      SET ip = @ip,
          port = @port,
          slave_id = @slave_id,
          timeout = @timeout,
          start_address = @start_address,
          register_count = @register_count,
          updated_at = datetime('now')
      WHERE floor = @floor
    `).run({ floor, ...plc });
  }

  countRoomsOnFloor(floor) {
    return db.prepare('SELECT COUNT(*) AS count FROM rooms WHERE floor = ?').get(floor).count;
  }

  deletePlc(floor) {
    return db.prepare('DELETE FROM plcs WHERE floor = ?').run(floor).changes;
  }

  listRooms() {
    return db.prepare(`
      SELECT room_number, floor, y_main_coil, y_sub_coil, x_input,
             y_output_main, y_output_sub, description, is_active, show_in_ui
      FROM rooms
      ORDER BY floor, room_number
    `).all();
  }

  getRoom(roomNumber) {
    return db.prepare(`
      SELECT room_number, floor, y_main_coil, y_sub_coil, x_input,
             y_output_main, y_output_sub, description, is_active, show_in_ui
      FROM rooms
      WHERE room_number = ?
    `).get(roomNumber);
  }

  hasActivePlc(floor) {
    return Boolean(db.prepare(
      'SELECT 1 FROM plcs WHERE floor = ? AND is_active = 1'
    ).get(floor));
  }

  createRoom(room) {
    db.transaction(() => {
      db.prepare(`
        INSERT INTO rooms (
          room_number, floor, y_main_coil, y_sub_coil, x_input,
          y_output_main, y_output_sub, description, is_active, show_in_ui
        ) VALUES (
          @room_number, @floor, @y_main_coil, @y_sub_coil, @x_input,
          @y_output_main, @y_output_sub, @description, @is_active, @show_in_ui
        )
      `).run(room);
      db.prepare(`
        INSERT INTO room_current_states (room_number, state, state_name)
        VALUES (?, 0, 'Trống')
      `).run(room.room_number);
    })();
  }

  updateRoom(room) {
    return db.prepare(`
      UPDATE rooms
      SET floor = @floor,
          y_main_coil = @y_main_coil,
          y_sub_coil = @y_sub_coil,
          x_input = @x_input,
          y_output_main = @y_output_main,
          y_output_sub = @y_output_sub,
          description = @description,
          is_active = @is_active,
          show_in_ui = @show_in_ui
      WHERE room_number = @room_number
    `).run(room).changes;
  }

  deactivateRoom(roomNumber) {
    return db.prepare('UPDATE rooms SET is_active = 0 WHERE room_number = ?')
      .run(roomNumber).changes;
  }
}

export default new ConfigService();
