import ModbusRTU from 'modbus-serial';
import config from '../config/index.js';
import logger from '../utils/logger.js';

// Dynamic import to avoid circular dependency
let commandQueue = null;
const getCommandQueue = async () => {
  if (!commandQueue) {
    try {
      const module = await import('./commandQueue.js');
      commandQueue = module.default;
    } catch (err) {
      logger.warn('Cannot import commandQueue');
    }
  }
  return commandQueue;
};

/**
 * PLCManager: Manages connections to multiple PLCs with exponential backoff reconnection
 * Ensures that one PLC failure doesn't block others
 */
class PLCManager {
  constructor() {
    if (PLCManager.instance) {
      return PLCManager.instance;
    }

    this.clients = new Map();         // Map of connected ModbusRTU clients
    this.reconnectTimers = new Map(); // Track reconnect timeout IDs per PLC
    this.reconnectDelays = new Map(); // Track current backoff delay per PLC
    this.isReconnecting = new Map();  // Flag to prevent duplicate reconnect scheduling
    
    PLCManager.instance = this;
  }

  /**
   * Initialize all PLCs from config
   */
  async initialize() {
    const connectPromises = config.plcs.map(plcConfig => this.connectPLC(plcConfig));
    await Promise.allSettled(connectPromises);
    logger.info(`All PLCs initialized (${config.plcs.length} configured)`);
  }

  /**
   * Helper: Extract underlying socket from ModbusRTU client
   */
  getSocketFromClient(client) {
    if (!client) return null;
    return client._client || client._sock || client.socket || null;
  }

  /**
   * Helper: Close socket safely
   */
  closeSocket(socket, key) {
    if (!socket) return;
    
    try {
      if (typeof socket.removeAllListeners === 'function') {
        socket.removeAllListeners();
      }

      if (typeof socket.destroy === 'function' && !socket.destroyed) {
        socket.destroy();
        logger.debug(`Destroyed socket for ${key}`);
      }
    } catch (err) {
      logger.warn(`Error closing socket ${key}: ${err.message}`);
    }
  }

  /**
   * Helper: Close ModbusRTU client safely
   */
  closeClient(client, key) {
    if (!client) return;

    try {
      const socket = this.getSocketFromClient(client);
      this.closeSocket(socket, key);

      if (client.isOpen) {
        client.close(() => {
          logger.debug(`Closed client for ${key}`);
        });
      }
    } catch (err) {
      logger.warn(`Error closing client ${key}: ${err.message}`);
    }
  }

  /**
   * Connect to a single PLC
   */
  async connectPLC(plcConfig) {
    const key = `floor_${plcConfig.floor}`;
    
    try {
      // Destroy any existing connection first
      const existingEntry = this.clients.get(key);
      if (existingEntry?.client) {
        this.closeClient(existingEntry.client, key);
      }

      const client = new ModbusRTU();
      client.setID(plcConfig.slaveId);
      client.setTimeout(plcConfig.timeout);
      await client.connectTCP(plcConfig.ip, { port: plcConfig.port });
      
      this.clients.set(key, {
        client,
        config: plcConfig,
        connected: true,
        lastError: null
      });

      // Attach listeners to detect disconnects
      const socket = this.getSocketFromClient(client);
      if (socket?.on) {
        socket.on('close', (hadError) => {
          logger.warn(`Floor ${plcConfig.floor} socket closed (hadError=${hadError})`);
          const entry = this.clients.get(key);
          if (entry) entry.connected = false;
          this.scheduleReconnect(plcConfig);
        });

        socket.on('error', (err) => {
          logger.warn(`Floor ${plcConfig.floor} socket error: ${err.message}`);
          const entry = this.clients.get(key);
          if (entry) {
            entry.connected = false;
            entry.lastError = err.message;
          }
          this.scheduleReconnect(plcConfig);
        });
      }

      logger.info(`Connected to PLC Floor ${plcConfig.floor} (${plcConfig.ip}:${plcConfig.port})`);
      this.reconnectDelays.delete(key);
      
      // Notify queue to resume processing if there are pending commands
      const queue = await getCommandQueue();
      if (queue) {
        queue.processQueue(plcConfig.floor);
      }
    } catch (error) {
      logger.error(`Failed to connect PLC Floor ${plcConfig.floor}: ${error.message}`);
      this.scheduleReconnect(plcConfig);
    }
  }

  /**
   * Schedule reconnection with exponential backoff
   * Prevents multiple simultaneous reconnect attempts per PLC
   */
  scheduleReconnect(plcConfig) {
    const key = `floor_${plcConfig.floor}`;
    
    if (this.isReconnecting.get(key) || this.reconnectTimers.has(key)) {
      return;
    }

    this.isReconnecting.set(key, true);

    const cfg = config.reconnect || { initialDelay: 2000, maxDelay: 30000, backoffMultiplier: 1.5 };
    const currentDelay = this.reconnectDelays.get(key) || cfg.initialDelay;
    const nextDelay = Math.min(currentDelay * cfg.backoffMultiplier, cfg.maxDelay);
    this.reconnectDelays.set(key, nextDelay);

    logger.warn(`Floor ${plcConfig.floor}: Reconnecting in ${currentDelay}ms`);

    const timer = setTimeout(async () => {
      logger.info(`Reconnect attempt: Floor ${plcConfig.floor}`);
      this.reconnectTimers.delete(key);
      this.isReconnecting.delete(key);
      await this.connectPLC(plcConfig);
    }, currentDelay);

    this.reconnectTimers.set(key, timer);
  }

  /**
   * Get client for a floor, throws if not connected
   */
  getClient(floor) {
    const key = `floor_${floor}`;
    const entry = this.clients.get(key);
    
    if (!entry?.connected) {
      throw new Error(`Floor ${floor} not connected`);
    }

    const socket = this.getSocketFromClient(entry.client);
    if (socket?.destroyed) {
      entry.connected = false;
      throw new Error(`Floor ${floor} socket destroyed`);
    }
    
    return entry.client;
  }

  /**
   * Write coil
   * Retries handled by CommandQueue at higher level
   */
  async writeCoil(floor, coilAddress, value) {
    try {
      const client = this.getClient(floor);
      await client.writeCoil(coilAddress, value);
      logger.info(`Write coil success: Floor ${floor}, Coil ${coilAddress}, Value ${value}`);
      return true;
    } catch (error) {
      logger.error(`Write coil error: Floor ${floor}, Coil ${coilAddress}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Read coil
   * Retries handled by CommandQueue at higher level
   */
  async readCoil(floor, coilAddress) {
    try {
      const client = this.getClient(floor);
      const result = await client.readCoils(coilAddress, 1);
      return result.data[0];
    } catch (error) {
      logger.error(`Read coil error: Floor ${floor}, Coil ${coilAddress}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Read multiple coils
   * Retries handled by CommandQueue at higher level
   */
  async readCoils(floor, startAddress, count) {
    try {
      const client = this.getClient(floor);
      const result = await client.readCoils(startAddress, count);
      return result.data;
    } catch (error) {
      logger.error(`Read coils error: Floor ${floor}, Address ${startAddress}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Write register
   * Retries handled by CommandQueue at higher level
   */
  async writeRegister(floor, registerAddress, value) {
    try {
      const client = this.getClient(floor);
      await client.writeRegister(registerAddress, value);
      logger.info(`Write register success: Floor ${floor}, Register ${registerAddress}, Value ${value}`);
      return true;
    } catch (error) {
      logger.error(`Write register error: Floor ${floor}, Register ${registerAddress}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Read registers
   * Retries handled by CommandQueue at higher level
   */
  async readRegisters(floor, startAddress, count) {
    try {
      const client = this.getClient(floor);
      const result = await client.readHoldingRegisters(startAddress, count);
      return result.data;
    } catch (error) {
      logger.error(`Read registers error: Floor ${floor}, Address ${startAddress}: ${error.message}`);
      throw error;
    }
  }

 

  /**
   * Get connection status for a single PLC
   */
  getConnectionStatus(floor) {
    const key = `floor_${floor}`;
    const entry = this.clients.get(key);
    
    if (!entry) {
      return {
        floor,
        connected: false,
        status: 'Not initialized',
        isReconnecting: false,
        reconnectDelay: null,
        lastError: null
      };
    }

    return {
      floor,
      connected: entry.connected,
      status: entry.connected ? 'Connected' : 'Disconnected',
      isReconnecting: this.isReconnecting.get(key) || false,
      reconnectDelay: this.reconnectDelays.get(key) || null,
      lastError: entry.lastError
    };
  }

  /**
   * Get connection status for all PLCs
   */
  getAllConnectionStatus() {
    return config.plcs.map(plc => this.getConnectionStatus(plc.floor));
  }

  /**
   * Cleanup: close all connections and clear timers
   */
  async destroy() {
    for (const [key, entry] of this.clients.entries()) {
      if (entry.client) {
        this.closeClient(entry.client, key);
      }
    }
    
    for (const timer of this.reconnectTimers.values()) {
      clearTimeout(timer);
    }
    
    this.reconnectTimers.clear();
    this.reconnectDelays.clear();
    this.isReconnecting.clear();
    logger.info('All PLC connections closed and cleaned up');
  }
}

export default new PLCManager();