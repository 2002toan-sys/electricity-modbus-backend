import commandQueue from './commandQueue.js';
import stateManager from './stateManager.js';
import monitorService from './monitorService.js';
import config from '../config/index.js';
import logger from '../utils/logger.js';
import { EventEmitter } from 'events';

/**
 * RelayService: Handles relay write operations with verification
 * - Uses CommandQueue with PRIORITY (write commands go to front)
 * - Verifies write
 * - Updates persisted coil state
 * - Triggers async interlock events
 */
export const relayEmitter = new EventEmitter();

class RelayService {
  /**
   * Set a relay (main or sub) for a room
   * Uses CommandQueue which prioritizes writes
   * Enforces user permission: User can only control sub if main is ON
   */
  async setRelay(room, relayType, setValue, userRole = 'admin') {
    // Check if write relay is enabled
    if (!config.app?.write_relay_enabled) {
      throw new Error('Write relay functionality is disabled');
    }

    // Check user permissions
    if (userRole !== 'admin') {
      // User role: can only control sub relay if main is ON
      if (relayType === 'sub') {
        const roomState = stateManager.getRoomState(room);
        if (!roomState || !roomState.y_output_main) {
          throw new Error('User can only control sub relay when main relay is ON');
        }
      } else if (relayType === 'main') {
        // User cannot control main relay
        throw new Error('User role cannot control main relay');
      }
    }

    // Validate room and get mapping
    const mapping = config.roomMapping[room];
    if (!mapping) {
      throw new Error(`Room ${room} not in mapping`);
    }

    // Determine which coil to write
    const coilAddress = relayType === 'main' ? mapping.y_main_coil : mapping.y_sub_coil;
    const value = setValue.toLowerCase() === 'on';

    // Enqueue WRITE with priority (goes to FRONT of queue)
    return new Promise((resolve, reject) => {
      const writeCallback = (error, result) => {
        if (error) {
          logger.error(`Relay write failed for room ${room} ${relayType}: ${error.message}`);
          reject(error);
          return;
        }

        try {
          // Update persisted coil state
          stateManager.updateCoilState(room, relayType, value);
          stateManager.saveCoilStates();

          logger.debug(`Relay ${relayType} set to ${setValue} for room ${room}`);
          
          // Broadcast state update immediately
          monitorService.emitStateUpdate();
          
          // Interlock: if main OFF, queue sub OFF
          if (relayType === 'main' && !value && config.app.interlock_enabled) {
            setImmediate(() => {
              relayEmitter.emit('interlockRequired', { room, mapping });
            });
          }

          // Return response
          resolve({
            room,
            status: value ? 'on' : 'off',
            type: relayType,
            floor: mapping.floor,
            time: new Date().toLocaleString("vi-VN", {
              timeZone: "Asia/Ho_Chi_Minh"
            })
          });
        } catch (err) {
          logger.error(`Error processing relay write for room ${room}: ${err.message}`);
          reject(err);
        }
      };

      // Enqueue WRITE command with HIGH priority
      commandQueue.enqueueWrite(
        mapping.floor,
        'writeCoil',
        coilAddress,
        value,
        writeCallback
      );

      logger.debug(`Relay write queued for room ${room} ${relayType} on floor ${mapping.floor}`);
    });
  }
}

export default new RelayService();