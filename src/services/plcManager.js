import Modbus from 'jsmodbus';
import net from 'net';
import config from '../utils/configLoader.js';
import logger from '../utils/logger.js';

// Lazy import to avoid circular dependency with commandQueue
let _commandQueue = null;
async function getCommandQueue() {
  if (!_commandQueue) {
    try {
      _commandQueue = (await import('./commandQueue.js')).default;
    } catch {
      logger.warn('PLCManager: cannot import commandQueue');
    }
  }
  return _commandQueue;
}

class PLCManager {
  constructor() {
    if (PLCManager.instance) return PLCManager.instance;

    this.clients = new Map();         // floor_N -> { socket, client, config, connected, lastError }
    this.reconnectTimers = new Map(); // floor_N -> timerId
    this.reconnectDelays = new Map(); // floor_N -> current backoff delay (ms)
    this.isReconnecting = new Map();  // floor_N -> boolean

    PLCManager.instance = this;
  }

  // ─── Initialization ────────────────────────────────────────────────────────

  async initialize() {
    await Promise.allSettled(config.plcs.map(plcConfig => this.connectPLC(plcConfig)));
    logger.info(`All PLCs initialized (${config.plcs.length} configured)`);
  }

  // ─── Connection Management ─────────────────────────────────────────────────

  connectPLC(plcConfig) {
    return new Promise(resolve => {
      const key = `floor_${plcConfig.floor}`;

      // Tear down existing socket if any
      const existing = this.clients.get(key);
      if (existing?.socket) this._destroySocket(existing.socket);

      const socket = new net.Socket();
      const client = new Modbus.client.TCP(socket, plcConfig.slaveId, plcConfig.timeout);

      this.clients.set(key, { socket, client, config: plcConfig, connected: false, lastError: null });

      socket.setKeepAlive(true, 10000);

      socket.once('connect', async () => {
        this.clients.get(key).connected = true;
        this.reconnectDelays.delete(key);
        logger.info(`Connected to PLC Floor ${plcConfig.floor} (${plcConfig.ip}:${plcConfig.port})`);
        const q = await getCommandQueue();
        q?.processQueue(plcConfig.floor);
        resolve();
      });

      socket.on('error', err => {
        const entry = this.clients.get(key);
        if (entry) { entry.connected = false; entry.lastError = err.message; }
        logger.warn(`Floor ${plcConfig.floor} socket error: ${err.message}`);
      });

      socket.once('close', () => {
        const entry = this.clients.get(key);
        if (entry) entry.connected = false;
        logger.warn(`Floor ${plcConfig.floor} socket closed`);
        this.scheduleReconnect(plcConfig);
        resolve(); // resolve in case connection never succeeded
      });

      socket.on('timeout', () => {
        logger.warn(`Floor ${plcConfig.floor} socket timeout`);
        socket.destroy();
      });

      socket.connect({ host: plcConfig.ip, port: plcConfig.port });
    });
  }

  scheduleReconnect(plcConfig) {
    const key = `floor_${plcConfig.floor}`;
    if (this.isReconnecting.get(key) || this.reconnectTimers.has(key)) return;

    this.isReconnecting.set(key, true);

    const { initialDelay = 2000, maxDelay = 30000, backoffMultiplier = 1.5 } = config.reconnect || {};
    const delay = this.reconnectDelays.get(key) || initialDelay;
    this.reconnectDelays.set(key, Math.min(delay * backoffMultiplier, maxDelay));

    logger.warn(`Floor ${plcConfig.floor}: Reconnecting in ${delay}ms`);

    const timer = setTimeout(async () => {
      this.reconnectTimers.delete(key);
      this.isReconnecting.delete(key);
      logger.info(`Reconnect attempt: Floor ${plcConfig.floor}`);
      await this.connectPLC(plcConfig);
    }, delay);

    this.reconnectTimers.set(key, timer);
  }

  async reconfigurePLC(plcConfig) {
    const key = `floor_${plcConfig.floor}`;
    const reconnectTimer = this.reconnectTimers.get(key);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    this.reconnectTimers.delete(key);
    this.isReconnecting.delete(key);
    this.reconnectDelays.delete(key);

    const existing = this.clients.get(key);
    if (existing?.socket) this._destroySocket(existing.socket);
    this.clients.delete(key);

    const queue = await getCommandQueue();
    queue?.addFloor(plcConfig.floor);
    queue?.refreshFloorPolling(plcConfig.floor);

    logger.info(`PLC Floor ${plcConfig.floor}: applying updated connection settings`);
    this.connectPLC(plcConfig);
    return { floor: plcConfig.floor, status: 'reconnecting' };
  }

  async disconnectPLC(floor) {
    const key = `floor_${floor}`;
    const reconnectTimer = this.reconnectTimers.get(key);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    this.reconnectTimers.delete(key);
    this.isReconnecting.delete(key);
    this.reconnectDelays.delete(key);

    const existing = this.clients.get(key);
    if (existing?.socket) this._destroySocket(existing.socket);
    this.clients.delete(key);

    const queue = await getCommandQueue();
    queue?.removeFloor(floor);
  }

  _destroySocket(socket) {
    try {
      socket.removeAllListeners();
      if (!socket.destroyed) socket.destroy();
    } catch { /* ignore */ }
  }

  // ─── Client Access ─────────────────────────────────────────────────────────

  getClient(floor) {
    const entry = this.clients.get(`floor_${floor}`);
    if (!entry?.client) throw new Error(`Floor ${floor} not initialized`);
    if (!entry.connected || entry.socket.destroyed || !entry.socket.writable) {
      entry.connected = false;
      throw new Error(`Floor ${floor} port not open`);
    }
    return entry.client;
  }

  // ─── Modbus Operations ─────────────────────────────────────────────────────

  async writeCoil(floor, address, value) {
    await this.getClient(floor).writeSingleCoil(address, value);
    return true;
  }

  async writeRegister(floor, address, value) {
    await this.getClient(floor).writeSingleRegister(address, value);
    return true;
  }

  async readCoils(floor, startAddress, count) {
    const resp = await this.getClient(floor).readCoils(startAddress, count);
    return resp.response.body.valuesAsArray;
  }

  async readRegisters(floor, startAddress, count) {
    const resp = await this.getClient(floor).readHoldingRegisters(startAddress, count);
    return resp.response.body.valuesAsArray;
  }

  // ─── Status ────────────────────────────────────────────────────────────────

  getConnectionStatus(floor) {
    const key = `floor_${floor}`;
    const entry = this.clients.get(key);
    if (!entry) {
      return { floor, connected: false, status: 'Not initialized', isReconnecting: false, reconnectDelay: null, lastError: null };
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

  getAllConnectionStatus() {
    return config.plcs.map(({ floor }) => this.getConnectionStatus(floor));
  }

  // ─── Cleanup ───────────────────────────────────────────────────────────────

  async destroy() {
    for (const { socket } of this.clients.values()) this._destroySocket(socket);
    for (const timer of this.reconnectTimers.values()) clearTimeout(timer);
    this.reconnectTimers.clear();
    this.reconnectDelays.clear();
    this.isReconnecting.clear();
    logger.info('All PLC connections closed and cleaned up');
  }
}

export default new PLCManager();