import logger from '../utils/logger.js';
import db from '../database/db.js';

export class HistoryLogger {
  constructor({ logger, db }) {
    this.logger = logger;
    this.db = db;
    this._initPreparedStatements();
  }

  _initPreparedStatements() {
    try {
      this.insertStmt = this.db.prepare(`
        INSERT INTO room_history (timestamp, room_number, floor, previous_state, new_state, message, trigger_source)
        VALUES (@timestamp, @room_number, @floor, @previous_state, @new_state, @message, @trigger_source)
      `);
    } catch (err) {
      this.logger.error(`HistoryLogger prepared statements error: ${err.message}`);
    }
  }

  /**
   * Log state change to SQLite
   */
  logStateChange(room, floor, previousStateName, newStateName, message, triggerSource = 'modbus') {
    const timestamp = new Date().toISOString();
    const prevState = previousStateName || 'Unknown';
    const newState = newStateName || 'Unknown';
    const roomStr = (room || '').toString();
    const floorNum = parseInt(floor) || 0;

    // 1. Lưu vào SQLite
    try {
      this.insertStmt.run({
        timestamp,
        room_number: roomStr,
        floor: floorNum,
        previous_state: prevState,
        new_state: newState,
        message: message || '',
        trigger_source: triggerSource
      });
      this.logger.debug(`History logged to SQLite: Room ${room} ${prevState} → ${newState}`);
    } catch (error) {
      this.logger.error(`Failed to log history to SQLite: ${error.message}`);
    }

  }

  /**
   * Get history with advanced filtering & pagination
   * Options: { room, startDate, endDate, state, page = 1, limit = 20 }
   */
  getHistory(optionsOrRoom = null, limitParam = 20) {
    let options = {};
    if (typeof optionsOrRoom === 'object' && optionsOrRoom !== null) {
      options = optionsOrRoom;
    } else if (optionsOrRoom !== null) {
      options = { room: optionsOrRoom, limit: limitParam };
    }

    const {
      room,
      startDate,
      endDate,
      state,
      search,
      page = 1,
      limit = 20
    } = options;

    const limitNum = Math.max(1, Math.min(parseInt(limit) || 20, 500));
    const pageNum = Math.max(1, parseInt(page) || 1);

    const whereClauses = [];
    const params = [];

    if (room && room !== 'all') {
      whereClauses.push('room_number = ?');
      params.push(room.toString());
    }

    if (startDate) {
      whereClauses.push("date(timestamp, '+7 hours') >= date(?)");
      params.push(startDate.slice(0, 10));
    }

    if (endDate) {
      whereClauses.push("date(timestamp, '+7 hours') <= date(?)");
      params.push(endDate.slice(0, 10));
    }

    if (state && state !== 'all') {
      whereClauses.push('new_state = ?');
      params.push(state);
    }

    if (typeof search === 'string' && search.trim()) {
      const searchableFields = `
          coalesce(room_number, '') || ' ' ||
          coalesce(CAST(floor AS TEXT), '') || ' ' ||
          coalesce(previous_state, '') || ' ' ||
          coalesce(new_state, '') || ' ' ||
          coalesce(message, '') || ' ' ||
          coalesce(trigger_source, '')
      `;
      for (const term of search.trim().split(/\s+/)) {
        whereClauses.push(`instr(lower(${searchableFields}), lower(?)) > 0`);
        params.push(term);
      }
    }

    const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    try {
      // 1. Đếm tổng số bản ghi
      const countRow = this.db.prepare(`SELECT COUNT(*) as total FROM room_history ${whereStr}`).get(...params);
      const total = countRow ? countRow.total : 0;
      const totalPages = Math.max(1, Math.ceil(total / limitNum));
      const safePage = Math.min(pageNum, totalPages);
      const offset = (safePage - 1) * limitNum;

      // 2. Lấy dữ liệu theo trang
      const querySql = `
        SELECT id, timestamp, room_number as room, floor, previous_state, new_state, message, trigger_source
        FROM room_history
        ${whereStr}
        ORDER BY datetime(timestamp) DESC, id DESC
        LIMIT ? OFFSET ?
      `;

      const records = this.db.prepare(querySql).all(...params, limitNum, offset);

      return {
        records,
        pagination: {
          page: safePage,
          limit: limitNum,
          total,
          totalPages
        }
      };
    } catch (error) {
      this.logger.error(`Failed to query history from SQLite: ${error.message}`);
      return {
        records: [],
        pagination: { page: 1, limit: limitNum, total: 0, totalPages: 1 }
      };
    }
  }

  /**
   * Helper cũ giữ lại để tương thích ngược
   */
  getHistoryByDateRange(room, startDate, endDate) {
    const res = this.getHistory({ room, startDate, endDate, limit: 1000 });
    return res.records;
  }
}

export default new HistoryLogger({ logger, db });
