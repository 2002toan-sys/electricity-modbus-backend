import plcManager from './plcManager.js';
import stateManager from './stateManager.js';
import config from '../config/index.js';
import logger from '../utils/logger.js';

/**
 * CommandQueue: Per-floor queue system for READ/WRITE commands
 * 
 * Architecture:
 * - 6 independent queues (one per floor: 2, 3, 4, 5, 6)
 * - READ commands: scheduled every 500ms per floor (not pushed continuously)
 * - WRITE commands: pushed to FRONT of queue with HIGH priority
 * - Sequential execution: process one command at a time per floor
 * - TCP check before execute: only send if connected
 * - No reconnect trigger: that's PLCManager's job
 * - Memory leak prevention: cleanup timers, clear references
 */
class CommandQueue {
  constructor() {
    this.queues = new Map();        // { floor_2: [...], floor_3: [...] }
    this.isProcessing = new Map();  // Track if floor is processing
    this.isPaused = new Map();      // Track if floor queue is paused (waiting for reconnect)
    this.lastReadTime = new Map();  // Track last time we scheduled a read per floor
    this.readTimers = new Map();    // Store timer IDs for cleanup

    this.readInterval = config.app?.polling_interval || 500; // 500ms default

    this.initializeFloors();
  }

  /**
   * Initialize queues for all configured floors
   */
  initializeFloors() {
    for (const plcConfig of config.plcs) {
      const floorKey = `floor_${plcConfig.floor}`;
      this.queues.set(floorKey, []);
      this.isProcessing.set(floorKey, false);
      this.isPaused.set(floorKey, false);
      this.lastReadTime.set(floorKey, 0);
    }
    logger.info(`CommandQueue initialized for ${config.plcs.length} floors`);
  }

  /**
   * Get floor key
   */
  getFloorKey(floor) {
    return `floor_${floor}`;
  }

  /**
   * Enqueue READ command
   * Called by monitoring system every 500ms
   * But only process if not already in queue (avoid spam)
   */
  enqueueRead(floor, registerType = 'holding', startAddress = 100, count = 2) {
    const floorKey = this.getFloorKey(floor);
    if (!this.queues.has(floorKey)) {
      return null;
    }

    const queue = this.queues.get(floorKey);

    // Check: is there already a READ command in queue?
    const hasReadInQueue = queue.some(cmd => cmd.type === 'READ');
    if (hasReadInQueue) {
      logger.debug(`Floor ${floor}: READ already in queue, skipping duplicate enqueue`);
      return null;
    }

    const command = {
      type: 'READ',
      floor,
      registerType,
      startAddress,
      count,
      timestamp: Date.now()
    };

    queue.push(command);
    logger.debug(`READ command enqueued for floor ${floor} (queue size: ${queue.length})`);

    this.processQueue(floor);
    return command;
  }

  /**
   * Enqueue WRITE command with PRIORITY (goes to front of queue)
   * Returns error immediately if queue is paused
   */
  enqueueWrite(floor, commandType, address, value, callback = null) {
    const floorKey = this.getFloorKey(floor);
    if (!this.queues.has(floorKey)) {
      logger.warn(`Floor ${floor} not configured`);
      if (callback) callback(new Error(`Floor ${floor} not configured`));
      return null;
    }

    // Check if queue is paused
    if (this.isPaused.get(floorKey)) {
      const errorMsg = `Floor ${floor}: Queue paused, waiting for reconnect. Command rejected.`;
      logger.warn(errorMsg);
      if (callback) callback(new Error(errorMsg));
      return null;
    }

    const command = {
      type: 'WRITE',
      floor,
      commandType, // writeCoil, writeRegister
      address,
      value,
      callback,
      timestamp: Date.now()
    };

    const queue = this.queues.get(floorKey);
    queue.unshift(command); // Insert at FRONT for priority

    logger.info(`WRITE enqueued at FRONT for floor ${floor}: ${commandType}(${address})=${value} (queue: ${queue.length})`);

    this.processQueue(floor);
    return command;
  }

  /**
   * Process queue for a specific floor
   * Waits for TCP connection, then sends command
   * Detects disconnects during execution
   */
  async processQueue(floor) {
    const floorKey = this.getFloorKey(floor);

    // Prevent duplicate processing
    if (this.isProcessing.get(floorKey)) {
      return;
    }

    const queue = this.queues.get(floorKey);
    if (!queue || queue.length === 0) {
      return;
    }

    // Mark as processing and unpause queue (reconnected)
    this.isProcessing.set(floorKey, true);
    this.isPaused.set(floorKey, false);

    try {
      while (queue.length > 0) {
        // Wait for TCP connection (max 60 seconds)
        const maxWaitTime = 60000;
        const checkInterval = 1000;
        let elapsedTime = 0;

        while (elapsedTime < maxWaitTime) {
          const connStatus = plcManager.getConnectionStatus(floor);
          if (connStatus.connected) {
            break; // Connected, proceed
          }

          logger.debug(`Floor ${floor}: waiting for TCP (${elapsedTime}ms/${maxWaitTime}ms)`);
          await this.sleep(checkInterval);
          elapsedTime += checkInterval;
        }

        // Check if connected after waiting
        const connStatus = plcManager.getConnectionStatus(floor);
        if (!connStatus.connected) {
          logger.warn(`Floor ${floor}: TCP timeout, pausing queue (${queue.length} commands buffered)`);
          this.isPaused.set(floorKey, true); // Mark as paused
          break; // Pause queue, keep commands
        }

        // Connection OK, NOW pop command and execute
        const command = queue.shift();
        logger.debug(`Floor ${floor}: send ${command.type} (queue: ${queue.length})`);

        try {
          await this.executeCommand(command);
          await this.sleep(50)
        } catch (error) {
          logger.error(`Floor ${floor}: ${command.type} error: ${error.message}`);

          // Check if "Port Not Open" or network-related error
          const errMsg = error.message || '';
          if (errMsg.toLowerCase().includes('port not open') || 
              errMsg.toLowerCase().includes('not connected') ||
              errMsg.toLowerCase().includes('socket destroyed') ||
              errMsg.toLowerCase().includes('econnreset')) {
            
            logger.warn(`Floor ${floor}: Connection error during ${command.type}: ${errMsg}`);
            
            // Trigger reconnect
            const key = `floor_${floor}`;
            const entry = plcManager.clients?.get(key);
            if (entry) {
              entry.connected = false;
              logger.info(`Floor ${floor}: Triggering immediate reconnect due to connection error`);
              plcManager.scheduleReconnect(entry.config);
            }
            this.isPaused.set(floorKey, true); // Mark as paused
            break; // Stop queue, wait for reconnect
          }

          // Not "port not open" error, just command failed
          // Callback on error for WRITE
          if (command.type === 'WRITE' && command.callback) {
            command.callback(error);
          }

          // Continue with next command
        }
      }
    } finally {
      this.isProcessing.set(floorKey, false);
    }
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Execute a command
   */
  async executeCommand(command) {
    const { type, floor } = command;

    if (type === 'READ') {
      return await this.executeRead(command);
    } else if (type === 'WRITE') {
      return await this.executeWrite(command);
    } else {
      throw new Error(`Unknown command type: ${type}`);
    }
  }

  /**
   * Execute READ command
   * Reads D100/D101 registers, updates state
   */
  async executeRead(command) {
    const { floor, registerType, startAddress, count } = command;

    try {
      let result;
      if (registerType === 'holding') {
        result = await plcManager.readRegisters(floor, startAddress, count);
      } else if (registerType === 'coils') {
        result = await plcManager.readCoils(floor, startAddress, count);
      } else {
        throw new Error(`Unknown register type: ${registerType}`);
      }

      // Process response: update state
      if (registerType === 'holding' && startAddress === 100 && result) {
        const d100 = result[0] || 0;
        const d101 = result[1] || 0;

        for (const [room, mapping] of Object.entries(config.roomMapping || {})) {
          if (mapping.floor === floor) {
            stateManager.updateRoomState(room, d100, d101, mapping);

            const yOutputMain = (d101 >> mapping.y_output_main) & 1;
            const yOutputSub = (d101 >> mapping.y_output_sub) & 1;
            stateManager.updateCoilState(room, 'main', !!yOutputMain);
            stateManager.updateCoilState(room, 'sub', !!yOutputSub);
          }
        }

        logger.debug(`READ processed floor ${floor}: D100=${d100}, D101=${d101}`);
      }

      return result;
    } catch (error) {
      logger.warn(`READ failed for floor ${floor}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Execute WRITE command
   */
  async executeWrite(command) {
    const { floor, commandType, address, value, callback } = command;

    try {
      let result;
      if (commandType === 'writeCoil') {
        result = await plcManager.writeCoil(floor, address, value);
      } else if (commandType === 'writeRegister') {
        result = await plcManager.writeRegister(floor, address, value);
      } else {
        throw new Error(`Unknown command type: ${commandType}`);
      }

      logger.debug(`WRITE executed floor ${floor}: ${commandType}(${address})=${value}`);

      // Callback on success
      if (callback) {
        callback(null, result);
      }

      return result;
    } catch (error) {
      logger.error(`WRITE failed for floor ${floor}: ${Error.message}`);

      // Callback on error
      if (callback) {
        callback(error);
      }

      throw error;
    }
  }

  /**
   * Start periodic READ polling for a floor
   * Schedules READ commands every 500ms
   * Only enqueues if one isn't already in queue
   */
  startReadPolling(floor, registerType = 'holding', startAddress = 100, count = 2) {
    const floorKey = this.getFloorKey(floor);

    // Don't start if already polling
    if (this.readTimers.has(floorKey)) {
      logger.debug(`Floor ${floor} already has read polling scheduled`);
      return;
    }

    logger.info(`Starting READ polling for floor ${floor} (${this.readInterval}ms)`);

    const scheduleRead = () => {
      // Only enqueue if queue doesn't already have a READ
      this.enqueueRead(floor, registerType, startAddress, count);

      // Schedule next read
      const timer = setTimeout(scheduleRead, this.readInterval);
      this.readTimers.set(floorKey, timer);
    };

    // Enqueue first read immediately
    this.enqueueRead(floor, registerType, startAddress, count);

    // Schedule next read
    const timer = setTimeout(scheduleRead, this.readInterval);
    this.readTimers.set(floorKey, timer);
  }

  /**
   * Stop READ polling for a floor
   */
  stopReadPolling(floor) {
    const floorKey = this.getFloorKey(floor);
    const timer = this.readTimers.get(floorKey);

    if (timer) {
      clearTimeout(timer);
      this.readTimers.delete(floorKey);
      logger.info(`Stopped READ polling for floor ${floor}`);
    }
  }

  /**
   * Start polling for all floors
   */
  startAllPolling() {
    for (const plcConfig of config.plcs) {
      const dataReg = plcConfig.dataRegisters || { startAddress: 100, count: 2 };
      this.startReadPolling(plcConfig.floor, 'holding', dataReg.startAddress, dataReg.count);
    }
  }

  /**
   * Stop polling for all floors
   */
  stopAllPolling() {
    for (const plcConfig of config.plcs) {
      this.stopReadPolling(plcConfig.floor);
    }
  }

  /**
   * Get queue status for monitoring/debugging
   */
  getQueueStatus() {
    const status = {};
    for (const [floorKey, queue] of this.queues.entries()) {
      const floor = parseInt(floorKey.split('_')[1]);
      const connStatus = plcManager.getConnectionStatus(floor);
      const commands = queue.map(cmd => `${cmd.type}(${cmd.address || ''})`).join(', ');

      status[floorKey] = {
        floor,
        queueLength: queue.length,
        isPaused: this.isPaused.get(floorKey),
        isProcessing: this.isProcessing.get(floorKey),
        tcpConnected: connStatus.connected,
        commands: commands || 'empty'
      };
    }
    return status;
  }

  /**
   * Cleanup: clear all timers and queues
   */
  destroy() {
    // Clear all read timers
    for (const [floorKey, timer] of this.readTimers.entries()) {
      clearTimeout(timer);
    }
    this.readTimers.clear();

    // Clear all queues
    this.queues.forEach(queue => {
      queue.length = 0; // Clear array
    });
    this.queues.clear();

    // Clear maps
    this.isProcessing.clear();
    this.isPaused.clear();
    this.lastReadTime.clear();

    logger.info('CommandQueue destroyed - all timers and queues cleared');
  }
}

export default new CommandQueue();
