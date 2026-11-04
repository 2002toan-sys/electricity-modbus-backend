/**
 * StateManager: Manages room states (input from PLC) and relay coil states (output to PLC)
 * - In-memory cache for ultra-fast O(1) reads
 * - Persisted to SQLite table `room_current_states`
 */
export default class StateManager {
  constructor({ logger, historyLogger, notificationService, db }) {
    this.logger = logger;
    this.historyLogger = historyLogger;
    this.notificationService = notificationService;
    this.db = db;
    // Prepare SQLite statements
    this._initPreparedStatements();

    // Lookup map for O(1) calculateRoomState: "x-y-ySub" -> { state, stateName }
    this.stateLookup = this._initStateLookup();

    // In-memory room states and coil states loaded from SQLite
    this.roomStates = {};
    this.coilStates = {};
    this._loadInitialStates();
  }

  _initPreparedStatements() {
    try {
      this.updateRoomStateStmt = this.db.prepare(`
        UPDATE room_current_states
        SET state = @state,
            state_name = @stateName,
            x_input = @xInput,
            y_output_main = @yOutputMain,
            y_output_sub = @yOutputSub,
            last_updated = datetime('now')
        WHERE room_number = @room
      `);

      this.updateMainCoilStmt = this.db.prepare(`
        UPDATE room_current_states
        SET main_relay_status = ?, last_updated = datetime('now')
        WHERE room_number = ?
      `);

      this.updateSubCoilStmt = this.db.prepare(`
        UPDATE room_current_states
        SET sub_relay_status = ?, last_updated = datetime('now')
        WHERE room_number = ?
      `);

      this.loadAllStmt = this.db.prepare(`SELECT * FROM room_current_states`);
      this.loadRoomStmt = this.db.prepare(`
        SELECT * FROM room_current_states WHERE room_number = ?
      `);
    } catch (err) {
      this.logger.error(`StateManager prepared statements error: ${err.message}`);
    }
  }

  _loadInitialStates() {
    try {
      const rows = this.loadAllStmt.all();
      for (const row of rows) {
        const room = row.room_number;
        this.roomStates[room] = {
          room,
          state: row.state,
          stateName: row.state_name || 'Trống',
          x_input: Boolean(row.x_input),
          y_output_main: Boolean(row.y_output_main),
          y_output_sub: Boolean(row.y_output_sub),
          timestamp: row.last_updated || new Date().toISOString()
        };

        this.coilStates[room] = {
          y_output_main: Boolean(row.main_relay_status),
          y_output_sub: Boolean(row.sub_relay_status),
          timestamp: row.last_updated || new Date().toISOString()
        };
      }
      this.logger.info(`StateManager: Loaded ${rows.length} room states from SQLite`);
    } catch (error) {
      this.logger.error(`StateManager failed to load initial states from SQLite: ${error.message}`);
      throw error;
    }
  }

  loadRoomState(room) {
    const row = this.loadRoomStmt.get(room.toString());
    if (!row) {
      throw new Error(`Room state not found for room ${room}`);
    }
    this.roomStates[row.room_number] = {
      room: row.room_number,
      state: row.state,
      stateName: row.state_name || 'Trống',
      x_input: Boolean(row.x_input),
      y_output_main: Boolean(row.y_output_main),
      y_output_sub: Boolean(row.y_output_sub),
      timestamp: row.last_updated || new Date().toISOString()
    };
    this.coilStates[row.room_number] = {
      y_output_main: Boolean(row.main_relay_status),
      y_output_sub: Boolean(row.sub_relay_status),
      timestamp: row.last_updated || new Date().toISOString()
    };
  }

  _initStateLookup() {
    const lookup = {};
    const definitions = {
      0: { name: 'Trống', x: false, y: false, ySub: false },
      1: { name: 'Chờ khách', x: false, y: true, ySub: false },
      2: { name: 'Có khách', x: true, y: true, ySub: false },
      3: { name: 'Bật cưỡng bức', x: true, y: true, ySub: true },
      4: { name: 'Bảo trì', x: true, y: false, ySub: true }
    };

    for (const [id, s] of Object.entries(definitions)) {
      const key = `${!!s.x}-${!!s.y}-${!!s.ySub}`;
      lookup[key] = { state: parseInt(id), stateName: s.name };
    }
    return lookup;
  }

  calculateRoomState(x, y, ySub) {
    const key = `${!!x}-${!!y}-${!!ySub}`;
    return this.stateLookup[key] || { state: -1, stateName: 'Unknown' };
  }

  updateRoomState(room, d100, d101, mapping) {
    const xInput = !!((d100 >> mapping.x_input) & 1);
    const yOutputMain = !!((d101 >> mapping.y_output_main) & 1);
    const yOutputSub = !!((d101 >> mapping.y_output_sub) & 1);

    const previous = this.roomStates[room];
    const { state, stateName } = this.calculateRoomState(xInput, yOutputMain, yOutputSub);

    // Keep in-memory state current
    this.roomStates[room] = {
      room,
      state,
      stateName,
      x_input: xInput,
      y_output_main: yOutputMain,
      y_output_sub: yOutputSub,
      timestamp: new Date().toISOString()
    };

    // Change detection: only log/notify/write-db when changed
    const hasChanged = !previous ||
      previous.state !== state ||
      previous.x_input !== xInput ||
      previous.y_output_main !== yOutputMain ||
      previous.y_output_sub !== yOutputSub;

    if (hasChanged) {
      // Persist to SQLite
      try {
        this.updateRoomStateStmt.run({
          room: room.toString(),
          state,
          stateName,
          xInput: xInput ? 1 : 0,
          yOutputMain: yOutputMain ? 1 : 0,
          yOutputSub: yOutputSub ? 1 : 0
        });
      } catch (err) {
        this.logger.error(`Failed to update room state in SQLite for room ${room}: ${err.message}`);
      }

      if (previous && previous.stateName !== stateName) {
        this.handleStateTransition(room, mapping.floor, previous.stateName, stateName);
      }
    }
  }

  handleStateTransition(room, floor, previousStateName, newStateName) {
    try {
      const message = this.notificationService.generateMessage(room, previousStateName, newStateName);

      // Log to history
      this.historyLogger.logStateChange(room, floor, previousStateName, newStateName, message);

      // Send notifications (Telegram, Email, WebSocket)
      this.notificationService.sendNotification(room, previousStateName, newStateName, message);

      this.logger.info(`State transition: Room ${room} ${previousStateName} → ${newStateName}`);
    } catch (error) {
      this.logger.error(`Failed to handle state transition: ${error.message}`);
    }
  }

  getRoomState(room) {
    return this.roomStates[room] || null;
  }

  getAllRoomStates() {
    return this.roomStates;
  }

  updateCoilState(room, relayType, value) {
    const boolValue = !!value;
    const current = this.coilStates[room] || { y_output_main: null, y_output_sub: null };

    const isMainChange = relayType === 'main' && current.y_output_main !== boolValue;
    const isSubChange = relayType === 'sub' && current.y_output_sub !== boolValue;

    if (isMainChange || isSubChange || !this.coilStates[room]) {
      if (!this.coilStates[room]) {
        this.coilStates[room] = { y_output_main: null, y_output_sub: null };
      }

      if (relayType === 'main') {
        this.coilStates[room].y_output_main = boolValue;
        try {
          this.updateMainCoilStmt.run(boolValue ? 1 : 0, room.toString());
        } catch (err) {
          this.logger.error(`Failed to update main coil in SQLite for room ${room}: ${err.message}`);
        }
      } else {
        this.coilStates[room].y_output_sub = boolValue;
        try {
          this.updateSubCoilStmt.run(boolValue ? 1 : 0, room.toString());
        } catch (err) {
          this.logger.error(`Failed to update sub coil in SQLite for room ${room}: ${err.message}`);
        }
      }

      this.coilStates[room].timestamp = new Date().toISOString();
      return true;
    }

    return false;
  }

  getCoilState(room) {
    return this.coilStates[room] || null;
  }

  getAllCoilStates() {
    return this.coilStates;
  }
}
