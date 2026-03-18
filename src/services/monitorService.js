import commandQueue from './commandQueue.js';
import stateManager from './stateManager.js';
import config from '../utils/configLoader.js';
import logger from '../utils/logger.js';

/**
 * MonitorService: Handles broadcasting states via WebSocket
 * - CommandQueue handles polling (read every 500ms)
 * - MonitorService handles broadcasting to clients
 * - Decoupled: clean separation of concerns
 */
class MonitorService {
  constructor() {
    this.io = null;
    this.broadcastInterval = null;
  }

  /**
   * Set Socket.IO instance for broadcasting
   */
  setSocketIO(io) {
    this.io = io;
  }

  /**
   * Start monitoring and broadcasting
   */
  startMonitoring() {
    logger.info('MonitorService: starting...');

    // Start command queue polling (handles READ commands @ 500ms)
    commandQueue.startAllPolling();

    // Broadcast state every 100ms to clients
    if (!this.broadcastInterval) {
      this.broadcastInterval = setInterval(() => {
        this.emitStateUpdate();
        this.emitConnectionStatus();
      }, 100);
    }

    logger.info('MonitorService: started (CommandQueue polling active)');
  }

  /**
   * Stop monitoring
   */
  stopMonitoring() {
    logger.info('MonitorService: stopping...');

    commandQueue.stopAllPolling();

    if (this.broadcastInterval) {
      clearInterval(this.broadcastInterval);
      this.broadcastInterval = null;
    }

    logger.info('MonitorService: stopped');
  }

  /**
   * Broadcast room states to ALL WebSocket clients on every call.
   * Bandwidth is negligible; always emit ensures frontend is never stale.
   * Change detection is handled upstream (file writes, notifications) — not here.
   */
  emitStateUpdate() {
    if (!this.io) return;

    const currentStates = stateManager.getAllRoomStates();
    const currentCoils = stateManager.getAllCoilStates();
    const queueStatus = commandQueue.getQueueStatus();

    this.io.emit('roomStateUpdate', {
      roomStates: currentStates,
      coilStates: currentCoils,
      queueStatus,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Broadcast PLC connection status only on change
   */
  emitConnectionStatus() {
    if (!this.io) return;

    const statuses = commandQueue.getQueueStatus();
    const statusPayload = JSON.stringify(statuses);

    if (this.lastStatusPayload !== statusPayload) {
      this.io.emit('plcStatus', {
        statuses,
        timestamp: new Date().toISOString()
      });
      this.lastStatusPayload = statusPayload;
    }
  }

  /**
   * Cleanup
   */
  destroy() {
    this.stopMonitoring();
    logger.info('MonitorService: destroyed');
  }
}

export default new MonitorService();