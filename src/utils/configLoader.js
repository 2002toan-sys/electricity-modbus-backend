import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import logger from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class ConfigLoader {
  constructor() {
    this.configPath = join(__dirname, '../config/appsettings.json');
    this.config = {};
    this.roomMap = new Map();
    this.floorRoomMap = new Map(); // Floor -> Array of {room, mapping}
    this.plcMap = new Map();
    
    this.load();
  }

  load() {
    try {
      const rawData = readFileSync(this.configPath, 'utf8');
      this.config = JSON.parse(rawData);
      
      // Build Room Lookup Map (Room -> Mapping)
      if (this.config.roomMapping) {
        for (const [room, mapping] of Object.entries(this.config.roomMapping)) {
          this.roomMap.set(room, mapping);
          
          // Build Floor -> Rooms map
          const floor = mapping.floor;
          if (!this.floorRoomMap.has(floor)) {
            this.floorRoomMap.set(floor, []);
          }
          this.floorRoomMap.get(floor).push({ room, mapping });
        }
      }

      // Build PLC Lookup Map (Floor -> Config)
      if (this.config.plcs) {
        for (const plcConfig of this.config.plcs) {
          this.plcMap.set(plcConfig.floor, plcConfig);
        }
      }

      logger.info('ConfigLoader: configuration and lookup maps initialized');
    } catch (error) {
      logger.error(`ConfigLoader: failed to load configuration: ${error.message}`);
      throw error;
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
