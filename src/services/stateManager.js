import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import historyLogger from './historyLogger.js';
import notificationService from './notificationService.js';
import config from '../config/index.js';

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
   * Calculate room state based on input/output logic
   * Returns state number and state name for UI display
   * 
   * State mapping:
   *  0: Trống (x=0, y_main=0, y_sub=0)
   *  1: Check-in (x=0, y_main=1, y_sub=0)
   *  2: Vào phòng (x=1, y_main=1, y_sub=0)
   *  3: Dùng thẻ (x=1, y_main=1, y_sub=1)
   *  4: Dọn dẹp (x=1, y_main=0, y_sub=1)
   */
  calculateRoomState(xInput, yOutputMain, yOutputSub) {
    // Convert to boolean
    const x = !!xInput;
    const y = !!yOutputMain;
    const ySub = !!yOutputSub;

    // State logic
    if (!x && !y && !ySub) return { state: 0, stateName: 'Trống' };
    if (!x && y && !ySub) return { state: 1, stateName: 'Check-in' };
    if (x && y && !ySub) return { state: 2, stateName: 'Vào phòng' };
    if (x && y && ySub) return { state: 3, stateName: 'Dùng thẻ' };
    if (x && !y && ySub) return { state: 4, stateName: 'Sửa chữa' };
    
    return { state: -1, stateName: 'Unknown' };
  }

  /**
   * Update room state from PLC register values
   * Inputs:
   *  - room: room number (e.g., "201")
   *  - d100: D100 register value (contains x_input bits)
   *  - d101: D101 register value (contains y_output_main, y_output_sub bits)
   *  - mapping: room mapping config
   */
  updateRoomState(room, d100, d101, mapping) {
    const xInput = (d100 >> mapping.x_input) & 1;
    const yOutputMain = (d101 >> mapping.y_output_main) & 1;
    const yOutputSub = (d101 >> mapping.y_output_sub) & 1;
    
    // Get previous state
    const previousState = this.roomStates[room];
    
    // Calculate new state
    const { state, stateName } = this.calculateRoomState(xInput, yOutputMain, yOutputSub);
    
    this.roomStates[room] = {
      room,
      state,
      stateName,
      x_input: !!xInput,
      y_output_main: !!yOutputMain,
      y_output_sub: !!yOutputSub,
      timestamp: new Date().toISOString()
    };

    // Track state transition
    if (previousState && previousState.stateName !== stateName) {
      this.handleStateTransition(room, mapping.floor, previousState.stateName, stateName);
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
   * Update coil state after successful write
   * Called from relayService after verifying write
   */
  updateCoilState(room, relayType, value) {
    if (!this.coilStates[room]) {
      this.coilStates[room] = { y_output_main: null, y_output_sub: null };
    }
    
    if (relayType === 'main') {
      this.coilStates[room].y_output_main = !!value;
    } else if (relayType === 'sub') {
      this.coilStates[room].y_output_sub = !!value;
    }
    
    this.coilStates[room].timestamp = new Date().toISOString();
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