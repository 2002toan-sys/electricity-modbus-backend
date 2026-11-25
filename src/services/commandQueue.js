
import plcManager from './plcManager.js';
import stateManager from './stateManager.js';
import config from '../utils/configLoader.js';
import logger from '../utils/logger.js';

const CONNECTION_ERRORS = [
  'port not open', 'not connected', 'socket destroyed',
  'econnreset', 'econnrefused', 'socket not writable',
  'connection to modbus server closed', 'connection lost', 'connection refused'
];

export class CommandQueue {
  constructor({ plcManager, stateManager, config, logger }) {
    this.plcManager = plcManager;
    this.stateManager = stateManager;
    this.config = config;
    this.logger = logger;
    this.queues = new Map();       // floor_N -> [commands]
    this.isProcessing = new Map(); // floor_N -> boolean
    this.isPaused = new Map();     // floor_N -> boolean
    this.readTimers = new Map();   // floor_N -> timerId

    this.readInterval = this.config.app?.polling_interval || 500;
    this._initFloors();
  }

  // ─── Initialization ────────────────────────────────────────────────────────

  _initFloors() {
    for (const { floor } of this.config.plcs) {
      this.addFloor(floor);
    }
    this.logger.info(`CommandQueue initialized for ${this.config.plcs.length} floors`);
  }

  addFloor(floor) {
    const key = `floor_${floor}`;
    if (this.queues.has(key)) return;
    this.queues.set(key, []);
    this.isProcessing.set(key, false);
    this.isPaused.set(key, false);
  }

  removeFloor(floor) {
    const key = `floor_${floor}`;
    this.stopReadPolling(floor);
    const queue = this.queues.get(key) || [];
    const error = new Error(`Floor ${floor} PLC was removed`);
    for (const command of queue) {
      if (command.type === 'WRITE' && command.callback) command.callback(error);
    }
    queue.length = 0;
    this.queues.delete(key);
    this.isProcessing.delete(key);
    this.isPaused.delete(key);
  }

  // ─── Enqueue READ ──────────────────────────────────────────────────────────

  enqueueReadHoldingRegisters(floor, startAddress = 100, count = 2) {
    const key = `floor_${floor}`;
    const queue = this.queues.get(key);
    if (!queue) return null;

    // Skip if READ already in queue
    if (queue.some(cmd => cmd.type === 'READ')) return null;

    const command = { type: 'READ', floor, registerType: 'holding', startAddress, count };
    queue.push(command);
    this.processQueue(floor);
    return command;
  }

  // ─── Enqueue WRITE ─────────────────────────────────────────────────────────

  enqueueWriteCoil(floor, address, value, callback = null) {
    return this._enqueueWrite(floor, 'writeCoil', address, value, callback);
  }

  enqueueWriteRegister(floor, address, value, callback = null) {
    return this._enqueueWrite(floor, 'writeRegister', address, value, callback);
  }

  _enqueueWrite(floor, commandType, address, value, callback) {
    const key = `floor_${floor}`;

    if (!this.queues.has(key)) {
      const err = new Error(`Floor ${floor} not configured`);
      if (callback) callback(err);
      return null;
    }

    if (this.isPaused.get(key)) {
      const err = new Error(`Floor ${floor}: Queue paused (PLC disconnected)`);
      this.logger.warn(err.message);
      if (callback) callback(err);
      return null;
    }

    const command = { type: 'WRITE', floor, commandType, address, value, callback };
    this.queues.get(key).unshift(command); // Priority: front of queue
    this.processQueue(floor);
    return command;
  }

  // ─── Queue Processing ──────────────────────────────────────────────────────

  async processQueue(floor) {
    const key = `floor_${floor}`;
    if (this.isProcessing.get(key)) return;

    const queue = this.queues.get(key);
    if (!queue?.length) return;

    this.isProcessing.set(key, true);
    this.isPaused.set(key, false);

    try {
      while (queue.length > 0) {
        // Chờ kết nối tối đa 60s
        const connected = await this._waitForConnection(floor, 60000);
        if (!connected) {
          this._handleConnectionTimeout(floor, key, queue);
          break;
        }

        const command = queue.shift();
        try {
          const result = await this._execute(command);
          if (command.type === 'WRITE' && command.callback) {
            command.callback(null, result);
          }
        } catch (error) {
          if (this._handleCommandFailure(command, error, floor, key)) break;
        }
      }

    } finally {
      if (this.queues.has(key)) this.isProcessing.set(key, false);
    }
  }

  _handleConnectionTimeout(floor, key, queue) {
    this.logger.warn(`Floor ${floor}: Connection timeout (60s), pausing queue`);
    if (this.queues.has(key)) this.isPaused.set(key, true);

    const error = new Error(`Floor ${floor} PLC is disconnected (timeout after 60s)`);
    while (queue.length > 0) {
      const command = queue.shift();
      if (command.type === 'WRITE' && command.callback) {
        command.callback(error);
      }
    }
  }

  _handleCommandFailure(command, error, floor, key) {
    this.logger.error(`Floor ${floor}: ${command.type} error: ${error.message}`);

    if (command.type === 'WRITE' && command.callback) {
      command.callback(error);
    }

    if (!this._isConnectionError(error)) return false;

    const entry = this.plcManager.clients?.get(key);
    if (entry) entry.connected = false;
    this.isPaused.set(key, true);
    return true;
  }

  async _waitForConnection(floor, maxWait = 60000) {
    const interval = 1000;
    for (let elapsed = 0; elapsed < maxWait; elapsed += interval) {
      if (!this.queues.has(`floor_${floor}`)) return false;
      if (this.plcManager.getConnectionStatus(floor).connected) return true;
      await this._sleep(interval);
    }
    return false;
  }

  _isConnectionError(error) {
    const msg = (error.message || '').toLowerCase();
    return CONNECTION_ERRORS.some(e => msg.includes(e));
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ─── Command Execution ─────────────────────────────────────────────────────

  async _execute(command) {
    if (command.type === 'READ') return this._executeRead(command);
    if (command.type === 'WRITE') return this._executeWrite(command);
    throw new Error(`Unknown command type: ${command.type}`);
  }

  async _executeRead({ floor, registerType, startAddress, count }) {
    let result;
    if (registerType === 'holding') {
      result = await this.plcManager.readRegisters(floor, startAddress, count);
    } else {
      result = await this.plcManager.readCoils(floor, startAddress, count);
    }

    // Update room state from D100/D101 holding registers (O(1) floor lookup)
    if (registerType === 'holding' && startAddress === 100 && result) {
      const [d100, d101] = result;
      const roomsOnFloor = this.config.getRoomsByFloor(floor);

      for (const { room, mapping } of roomsOnFloor) {
        this.stateManager.updateRoomState(room, d100, d101, mapping);
        this.stateManager.updateCoilState(room, 'main', !!((d101 >> mapping.y_output_main) & 1));
        this.stateManager.updateCoilState(room, 'sub', !!((d101 >> mapping.y_output_sub) & 1));
      }
      this.logger.debug(`READ floor ${floor}: D100=${d100}, D101=${d101}`);
    }

    return result;
  }

  async _executeWrite({ floor, commandType, address, value }) {
    try {
      let result;
      if (commandType === 'writeCoil') {
        result = await this.plcManager.writeCoil(floor, address, value);
      } else if (commandType === 'writeRegister') {
        result = await this.plcManager.writeRegister(floor, address, value);
      } else {
        throw new Error(`Unknown write type: ${commandType}`);
      }

      this.logger.info(`WRITE floor ${floor}: ${commandType}(${address})=${value}`);
      return result;
    } catch (error) {
      this.logger.error(`WRITE failed for floor ${floor}: ${error.message}`);
      throw error;
    }
  }

  // ─── Polling ───────────────────────────────────────────────────────────────

  startReadPolling(floor, startAddress = 100, count = 2) {
    const key = `floor_${floor}`;
    if (this.readTimers.has(key)) return;

    this.logger.info(`Starting READ polling for floor ${floor} (${this.readInterval}ms)`);

    const tick = () => {
      this.enqueueReadHoldingRegisters(floor, startAddress, count);
      this.readTimers.set(key, setTimeout(tick, this.readInterval));
    };

    this.enqueueReadHoldingRegisters(floor, startAddress, count);
    this.readTimers.set(key, setTimeout(tick, this.readInterval));
  }

  stopReadPolling(floor) {
    const key = `floor_${floor}`;
    const timer = this.readTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.readTimers.delete(key);
      this.logger.info(`Stopped READ polling for floor ${floor}`);
    }
  }

  refreshFloorPolling(floor) {
    this.stopReadPolling(floor);
    const queue = this.queues.get(`floor_${floor}`);
    if (queue) {
      for (let index = queue.length - 1; index >= 0; index -= 1) {
        if (queue[index].type === 'READ') queue.splice(index, 1);
      }
    }

    const plcConfig = this.config.getPLCConfig(floor);
    if (!plcConfig) return;

    const registers = plcConfig.dataRegisters || { startAddress: 100, count: 2 };
    this.startReadPolling(floor, registers.startAddress, registers.count);
  }

  updatePollingInterval(interval) {
    this.readInterval = interval;
    const floors = [...this.readTimers.keys()]
      .map((key) => Number(key.slice('floor_'.length)));
    for (const floor of floors) {
      this.refreshFloorPolling(floor);
    }
  }

  startAllPolling() {
    for (const { floor, dataRegisters } of this.config.plcs) {
      const reg = dataRegisters || { startAddress: 100, count: 2 };
      this.startReadPolling(floor, reg.startAddress, reg.count);
    }
  }

  stopAllPolling() {
    for (const { floor } of this.config.plcs) this.stopReadPolling(floor);
  }

  // ─── Status & Cleanup ──────────────────────────────────────────────────────

  getQueueStatus() {
    return Object.fromEntries(
      [...this.queues.entries()].map(([key, queue]) => {
        const floor = parseInt(key.split('_')[1]);
        return [key, {
          floor,
          queueLength: queue.length,
          isPaused: this.isPaused.get(key),
          isProcessing: this.isProcessing.get(key),
          tcpConnected: this.plcManager.getConnectionStatus(floor).connected,
          commands: queue.map(c => `${c.type}(${c.address ?? ''})`).join(', ') || 'empty'
        }];
      })
    );
  }

  destroy() {
    for (const timer of this.readTimers.values()) clearTimeout(timer);
    this.readTimers.clear();
    for (const queue of this.queues.values()) queue.length = 0;
    this.queues.clear();
    this.isProcessing.clear();
    this.isPaused.clear();
    this.logger.info('CommandQueue destroyed - all timers and queues cleared');
  }
}

export default new CommandQueue({ plcManager, stateManager, config, logger });
