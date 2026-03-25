import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import historyLogger from './historyLogger.js';
import notificationService from './notificationService.js';
import config from '../utils/configLoader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * StateManager: Manages room states (input from PLC) and relay coil states (output to PLC)
 * - Room states: Updated from polling D100/D101 registers (read-only in this scope)
 * - Coil states: Updated from write APIs, persisted to disk
 */
class StateManager {
  constructor() {
    this.stateFilePath = join(__dirname, '../../data/state.json');
    this.ensureDataDir();

    // In-memory room states (from PLC input x, output main/sub)
    this.roomStates = {};

    // Persisted coil states (what we sent to PLC)
    this.coilStates = this.loadCoilStates();

    // Generate lookup map for O(1) calculateRoomState: "x-y-ySub" -> { state, stateName }
    this.stateLookup = this._initStateLookup();
  }

  /**
   * Initialize state lookup table from static definitions
   */
  _initStateLookup() {
    const lookup = {};
    const definitions = {
      0: { name: 'Trống', x: false, y: false, ySub: false },
      1: { name: 'Check-in', x: false, y: true, ySub: false },
      2: { name: 'Vào phòng', x: true, y: true, ySub: false },
      3: { name: 'Dùng thẻ', x: true, y: true, ySub: true },
      4: { name: 'Sửa chữa', x: true, y: false, ySub: true }
    };

    for (const [id, s] of Object.entries(definitions)) {
      const key = `${!!s.x}-${!!s.y}-${!!s.ySub}`;
      lookup[key] = { state: parseInt(id), stateName: s.name };
    }
    return lookup;
  }

  ensureDataDir() {
    const dataDir = dirname(this.stateFilePath);
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
  }

  /**
   * Load persisted coil states from disk
   */
   loadCoilStates() {
    try {
      if (existsSync(this.stateFilePath)) {
        const data = readFileSync(this.stateFilePath, 'utf8');
        const parsed = JSON.parse(data);
        return parsed.coils || {};
      }
    } catch (error) {
      logger.error(`Failed to load coil states: ${error.message}`);
    }
    return {};
  }

  /**
   * Save coil states to disk (called after successful write API)
   */
  saveCoilStates() {
    try {
      const payload = { coils: this.coilStates };
      writeFileSync(this.stateFilePath, JSON.stringify(payload, null, 2));
      logger.debug('Coil states saved to disk');
    } catch (error) {
      logger.error(`Failed to save coil states: ${error.message}`);
    }
  }


  /**
   * Calculate room state based on input/output logic (O(1) lookup)
   */
  calculateRoomState(x, y, ySub) {
    const key = `${!!x}-${!!y}-${!!ySub}`;
    return this.stateLookup[key] || { state: -1, stateName: 'Unknown' };
  }

  /**
   * Update room state from PLC register values.
   * - Always updates in-memory state so emitted data is always fresh.
   * - Only triggers logging/notifications when state values actually changed
   *   (file I/O is expensive; broadcast bandwidth is not).
   */
  updateRoomState(room, d100, d101, mapping) {
    const xInput = !!((d100 >> mapping.x_input) & 1);
    const yOutputMain = !!((d101 >> mapping.y_output_main) & 1);
    const yOutputSub = !!((d101 >> mapping.y_output_sub) & 1);

    const previous = this.roomStates[room];
    const { state, stateName } = this.calculateRoomState(xInput, yOutputMain, yOutputSub);

    // Always keep in-memory state current so every emit carries the latest values
    this.roomStates[room] = {
      room,
      state,
      stateName,
      x_input: xInput,
      y_output_main: yOutputMain,
      y_output_sub: yOutputSub,
      timestamp: new Date().toISOString()
    };

    // Change detection: only log/notify/write-file when something actually changed
    const hasChanged = !previous ||
      previous.state !== state ||
      previous.x_input !== xInput ||
      previous.y_output_main !== yOutputMain ||
      previous.y_output_sub !== yOutputSub;

    if (hasChanged && previous && previous.stateName !== stateName) {
      this.handleStateTransition(room, mapping.floor, previous.stateName, stateName);
    }
  }

  /**
   * Handle state transition: log to CSV and send notifications
   */
  handleStateTransition(room, floor, previousStateName, newStateName) {
    try {
      // Generate message
      const message = notificationService.generateMessage(room, previousStateName, newStateName);

      // Log to CSV history
      historyLogger.logStateChange(room, floor, previousStateName, newStateName, message);

      // Send notifications (Telegram, Email, WebSocket)
      notificationService.sendNotification(room, previousStateName, newStateName, message);

      logger.info(`State transition: Room ${room} ${previousStateName} → ${newStateName}`);
    } catch (error) {
      logger.error(`Failed to handle state transition: ${error.message}`);
    }
  }

  /**
   * Get room state (current PLC inputs/outputs)
   */
  getRoomState(room) {
    return this.roomStates[room] || null;
  }

  /**
   * Get all room states
   */
  getAllRoomStates() {
    return this.roomStates;
  }

  /**
   * Update coil state after successful write with change detection
   */
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
      } else {
        this.coilStates[room].y_output_sub = boolValue;
      }

      this.coilStates[room].timestamp = new Date().toISOString();
      this.saveCoilStates();
      return true; // Indicating change
    }

    return false;
  }

  /**
   * Get coil state for a room
   */
  getCoilState(room) {
    return this.coilStates[room] || null;
  }

  /**
   * Get all coil states
   */
  getAllCoilStates() {
    return this.coilStates;
  }
}

export default new StateManager();