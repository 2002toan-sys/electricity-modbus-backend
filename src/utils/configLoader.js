import logger from './logger.js';
import db from '../database/db.js';

class ConfigLoader {
  constructor() {
    this.config = {
      app: {
        port: 3000,
        polling_interval: 500,
        interlock_enabled: true,
        write_relay_enabled: true,
        http_keep_alive_timeout: 60000,
        cors_origins: ['http://localhost:3000', 'http://localhost:3001']
      },
      rateLimit: { windowMs: 60000, maxRequests: 100 },
      timings: {
        write_verification_wait: 50,
        queue_busy_retry: 100,
        modbus_retry_wait: 500
      },
      reconnect: {
        initialDelay: 2000,
        maxDelay: 30000,
        backoffMultiplier: 1.5
      },
      notifications: {
        telegram: { enabled: false },
        email: { enabled: false },
        stateTransitions: {}
      },
      auth: {}
    };
    this.roomMap = new Map();
    this.floorRoomMap = new Map(); // Floor -> Array of {room, mapping}
    this.plcMap = new Map();
    
    this.load();
  }

  load() {
    try {
      const jwtSecret = process.env.JWT_SECRET;
      if (!jwtSecret || jwtSecret.length < 32) {
        throw new Error('JWT_SECRET must be set to at least 32 characters in the backend .env file');
      }
      if (process.env.API_KEY && process.env.API_KEY.length < 32) {
        throw new Error('API_KEY must be at least 32 characters when enabled');
      }

      this.config.auth.apiKeys = process.env.API_KEY && process.env.API_KEY.length >= 32
        ? [{ key: process.env.API_KEY, name: 'third-party-integration', role: 'admin' }]
        : [];
      this.reload();
    } catch (error) {
      logger.error(`ConfigLoader: failed to load configuration: ${error.message}`);
      throw error;
    }
  }

  reload() {
    const systemConfigs = Object.fromEntries(db.prepare(`
      SELECT key, value
      FROM system_configs
    `).all().map(({ key, value }) => [key, value]));
    const plcs = db.prepare(`
      SELECT floor, ip, port, slave_id, timeout, start_address, register_count
      FROM plcs
      WHERE is_active = 1
      ORDER BY floor
    `).all();
    const rooms = db.prepare(`
      SELECT room_number, floor, y_main_coil, y_sub_coil, x_input,
             y_output_main, y_output_sub, show_in_ui
      FROM rooms
      WHERE is_active = 1
      ORDER BY floor, room_number
    `).all();

    this.roomMap.clear();
    this.floorRoomMap.clear();
    this.plcMap.clear();
    this.config.plcs = plcs.map((plc) => ({
      floor: plc.floor,
      ip: plc.ip,
      port: plc.port,
      slaveId: plc.slave_id,
      timeout: plc.timeout,
      dataRegisters: {
        startAddress: plc.start_address,
        count: plc.register_count
      }
    }));
    this.config.roomMapping = Object.fromEntries(rooms.map((room) => [
      room.room_number,
      {
        floor: room.floor,
        y_main_coil: room.y_main_coil,
        y_sub_coil: room.y_sub_coil,
        x_input: room.x_input,
        y_output_main: room.y_output_main,
        y_output_sub: room.y_output_sub,
        show_in_ui: room.show_in_ui
      }
    ]));

    for (const [room, mapping] of Object.entries(this.config.roomMapping)) {
      this.roomMap.set(room, mapping);
      if (!this.floorRoomMap.has(mapping.floor)) {
        this.floorRoomMap.set(mapping.floor, []);
      }
      this.floorRoomMap.get(mapping.floor).push({ room, mapping });
    }

    for (const plcConfig of this.config.plcs) {
      this.plcMap.set(plcConfig.floor, plcConfig);
    }

    this.config.app.port = this._numberConfig(systemConfigs, 'app.port', this.config.app.port);
    this.config.app.polling_interval = this._numberConfig(
      systemConfigs,
      'app.polling_interval',
      this.config.app.polling_interval
    );
    this.config.app.interlock_enabled = this._booleanConfig(
      systemConfigs,
      'app.interlock_enabled',
      this.config.app.interlock_enabled
    );
    this.config.app.write_relay_enabled = this._booleanConfig(
      systemConfigs,
      'app.write_relay_enabled',
      this.config.app.write_relay_enabled
    );
    this.config.app.http_keep_alive_timeout = this._numberConfig(
      systemConfigs,
      'app.http_keep_alive_timeout',
      this.config.app.http_keep_alive_timeout
    );
    this.config.app.cors_origins = this._jsonConfig(
      systemConfigs,
      'app.cors_origins',
      this.config.app.cors_origins
    );
    this.config.rateLimit = this.config.rateLimit || {};
    this.config.rateLimit.windowMs = this._numberConfig(
      systemConfigs,
      'rateLimit.windowMs',
      this.config.rateLimit.windowMs
    );
    this.config.rateLimit.maxRequests = this._numberConfig(
      systemConfigs,
      'rateLimit.maxRequests',
      this.config.rateLimit.maxRequests
    );
    this.config.reconnect = this.config.reconnect || {};
    this.config.reconnect.initialDelay = this._numberConfig(
      systemConfigs,
      'reconnect.initialDelay',
      this.config.reconnect.initialDelay
    );
    this.config.reconnect.maxDelay = this._numberConfig(
      systemConfigs,
      'reconnect.maxDelay',
      this.config.reconnect.maxDelay
    );
    this.config.reconnect.backoffMultiplier = this._numberConfig(
      systemConfigs,
      'reconnect.backoffMultiplier',
      this.config.reconnect.backoffMultiplier
    );
    this.config.notifications = this.config.notifications || {};
    this.config.notifications.telegram = this.config.notifications.telegram || {};
    this.config.notifications.telegram.enabled = this._booleanConfig(
      systemConfigs,
      'notifications.telegram.enabled',
      this.config.notifications.telegram.enabled
    );
    this.config.notifications.telegram.botToken =
      systemConfigs['notifications.telegram.bot_token'] ??
      this.config.notifications.telegram.botToken;
    this.config.notifications.telegram.chatId =
      systemConfigs['notifications.telegram.chat_id'] ??
      this.config.notifications.telegram.chatId;
    this.config.notifications.email = this.config.notifications.email || {};
    this.config.notifications.email.enabled = this._booleanConfig(
      systemConfigs,
      'notifications.email.enabled',
      this.config.notifications.email.enabled
    );
    for (const field of ['service', 'user', 'password', 'to']) {
      const key = `notifications.email.${field}`;
      this.config.notifications.email[field] = systemConfigs[key] ??
        this.config.notifications.email[field];
    }
    this.config.notifications.stateTransitions = {
      ...(this.config.notifications.stateTransitions || {})
    };
    for (const [key, value] of Object.entries(systemConfigs)) {
      const prefix = 'notifications.stateTransitions.';
      if (key.startsWith(prefix)) {
        this.config.notifications.stateTransitions[key.slice(prefix.length)] = value;
      }
    }

    logger.info(`ConfigLoader: reloaded ${rooms.length} active rooms and lookup maps`);
  }

  _numberConfig(configs, key, fallback) {
    if (configs[key] === undefined) return fallback;
    const value = Number(configs[key]);
    return Number.isFinite(value) ? value : fallback;
  }

  _booleanConfig(configs, key, fallback) {
    if (configs[key] === undefined) return fallback;
    return configs[key] === 'true' || configs[key] === '1';
  }

  _jsonConfig(configs, key, fallback) {
    if (configs[key] === undefined) return fallback;
    try {
      return JSON.parse(configs[key]);
    } catch (error) {
      throw new Error(`Invalid JSON system config "${key}": ${error.message}`);
    }
  }

  get(key) {
    return this.config[key];
  }

  getRoomMapping(room) {
    return this.roomMap.get(room);
  }

  getPLCConfig(floor) {
    return this.plcMap.get(floor);
  }

  getRoomsByFloor(floor) {
    return this.floorRoomMap.get(floor) || [];
  }

  get plcs() {
    return this.config.plcs || [];
  }

  get app() {
    return this.config.app || {};
  }

  get timings() {
    return this.config.timings || {};
  }

  get reconnect() {
    return this.config.reconnect || {};
  }

  get notifications() {
    return this.config.notifications || {};
  }

  get auth() {
    return this.config.auth || {};
  }

  get rateLimit() {
    return this.config.rateLimit || {};
  }

  get roomMapping() {
    return this.config.roomMapping || {};
  }
}

export default new ConfigLoader();
