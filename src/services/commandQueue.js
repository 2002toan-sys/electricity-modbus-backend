import plcManager from './plcManager.js';
import stateManager from './stateManager.js';
import config from '../utils/configLoader.js';
import logger from '../utils/logger.js';

const CONNECTION_ERRORS = [
  'port not open', 'not connected', 'socket destroyed',
  'econnreset', 'econnrefused', 'socket not writable',
  'connection to modbus server closed', 'connection lost', 'connection refused'
];

class CommandQueue {
  constructor() {
    this.queues = new Map();       // floor_N -> [commands]
    this.isProcessing = new Map(); // floor_N -> boolean
    this.isPaused = new Map();     // floor_N -> boolean
    this.readTimers = new Map();   // floor_N -> timerId

    this.readInterval = config.app?.polling_interval || 500;
    this._initFloors();
  }

  // ─── Initialization ────────────────────────────────────────────────────────

  _initFloors() {
    for (const { floor } of config.plcs) {
      const key = `floor_${floor}`;
      this.queues.set(key, []);
      this.isProcessing.set(key, false);
      this.isPaused.set(key, false);
    }
    logger.info(`CommandQueue initialized for ${config.plcs.length} floors`);
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
      logger.warn(err.message);
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
          logger.warn(`Floor ${floor}: Connection timeout (60s), pausing queue`);
          this.isPaused.set(key, true);
          
          // Trả lỗi ngay lập tức cho các lệnh WRITE đang chờ trong queue để client không bị treo
          while (queue.length > 0) {
            const cmd = queue.shift();
            if (cmd.type === 'WRITE' && cmd.callback) {
              cmd.callback(new Error(`Floor ${floor} PLC is disconnected (timeout after 60s)`));
            }
          }
          break;
        }

        const command = queue.shift();
        try {
          const result = await this._execute(command);
          if (command.type === 'WRITE' && command.callback) {
            command.callback(null, result);
          }
        } catch (error) {
          logger.error(`Floor ${floor}: ${command.type} error: ${error.message}`);

          // Đảm bảo callback của lệnh WRITE luôn được gọi khi có lỗi
          if (command.type === 'WRITE' && command.callback) {
            command.callback(error);
          }

          if (this._isConnectionError(error)) {
            const entry = plcManager.clients?.get(key);
            if (entry) entry.connected = false;
            this.isPaused.set(key, true);
            break;
          }
        }
      }
    } finally {
      this.isProcessing.set(key, false);
    }
  }

  async _waitForConnection(floor, maxWait = 60000) {
    const interval = 1000;
    for (let elapsed = 0; elapsed < maxWait; elapsed += interval) {
      if (plcManager.getConnectionStatus(floor).connected) return true;
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
    try {
      let result;
      if (registerType === 'holding') {
        result = await plcManager.readRegisters(floor, startAddress, count);
      } else {
        result = await plcManager.readCoils(floor, startAddress, count);
      }

      // Update room state from D100/D101 holding registers (O(1) floor lookup)
      if (registerType === 'holding' && startAddress === 100 && result) {
        const [d100, d101] = result;
        const roomsOnFloor = config.getRoomsByFloor(floor);

        for (const { room, mapping } of roomsOnFloor) {
          stateManager.updateRoomState(room, d100, d101, mapping);
          stateManager.updateCoilState(room, 'main', !!((d101 >> mapping.y_output_main) & 1));
          stateManager.updateCoilState(room, 'sub', !!((d101 >> mapping.y_output_sub) & 1));
        }
        logger.debug(`READ floor ${floor}: D100=${d100}, D101=${d101}`);
      }

      return result;
    } catch (error) {
      throw error;
    }
  }

  async _executeWrite({ floor, commandType, address, value }) {
    try {
      let result;
      if (commandType === 'writeCoil') {
        result = await plcManager.writeCoil(floor, address, value);
      } else if (commandType === 'writeRegister') {
        result = await plcManager.writeRegister(floor, address, value);
      } else {
        throw new Error(`Unknown write type: ${commandType}`);
      }

      logger.info(`WRITE floor ${floor}: ${commandType}(${address})=${value}`);
      return result;
    } catch (error) {
      logger.error(`WRITE failed for floor ${floor}: ${error.message}`);
      throw error;
    }
  }

  // ─── Polling ───────────────────────────────────────────────────────────────

  startReadPolling(floor, startAddress = 100, count = 2) {
    const key = `floor_${floor}`;
    if (this.readTimers.has(key)) return;

    logger.info(`Starting READ polling for floor ${floor} (${this.readInterval}ms)`);

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
      logger.info(`Stopped READ polling for floor ${floor}`);
    }
  }

  startAllPolling() {
    for (const { floor, dataRegisters } of config.plcs) {
      const reg = dataRegisters || { startAddress: 100, count: 2 };
      this.startReadPolling(floor, reg.startAddress, reg.count);
    }
  }

  stopAllPolling() {
    for (const { floor } of config.plcs) this.stopReadPolling(floor);
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
          tcpConnected: plcManager.getConnectionStatus(floor).connected,
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
    logger.info('CommandQueue destroyed - all timers and queues cleared');
  }
}

export default new CommandQueue();
