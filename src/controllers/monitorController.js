import monitorService from '../services/monitorService.js';
import plcManager from '../services/plcManager.js';
import stateManager from '../services/stateManager.js';
import historyLogger from '../services/historyLogger.js';
import config from '../config/index.js';

/**
 * GET /api/monitor/rooms - Get all room states with calculated state
 */
export const getRoomStates = (req, res) => {
  try {
    let roomStates = stateManager.getAllRoomStates();
    let coilStates = stateManager.getAllCoilStates();
    
    // If no room states exist yet, initialize from config
    if (Object.keys(roomStates).length === 0) {
      Object.keys(config.roomMapping || {}).forEach((roomId) => {
        if (!roomStates[roomId]) {
          roomStates[roomId] = {
            room: roomId,
            state: 0,
            stateName: 'Trống',
            x_input: false,
            y_output_main: false,
            y_output_sub: false,
            timestamp: new Date().toISOString()
          };
        }
        if (!coilStates[roomId]) {
          coilStates[roomId] = {
            y_output_main: false,
            y_output_sub: false,
            timestamp: new Date().toISOString()
          };
        }
      });
    }
    
    // Format data for frontend: map room numbers to mainStatus and subStatus
    const formattedRooms = Object.entries(roomStates).map(([roomId, roomState]) => {
      const coilState = coilStates[roomId] || {};
      return {
        room: parseInt(roomId) || roomId,
        mainStatus: coilState.y_output_main || false,
        subStatus: coilState.y_output_sub || false,
        state: roomState.state,
        stateName: roomState.stateName || 'Không xác định',
        x_input: roomState.x_input,
        timestamp: roomState.timestamp
      };
    });

    res.status(200).json(formattedRooms);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * GET /api/monitor/plc-status - Get PLC connection status
 */
export const getPlcStatus = (req, res) => {
  try {
    const statuses = plcManager.getAllConnectionStatus();
    res.status(200).json({
      success: true,
      data: statuses,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * GET /api/monitor/history - Get state history
 * Query params:
 *   - room: optional room number to filter
 *   - limit: number of records (default 100)
 *   - startDate: optional ISO date string
 *   - endDate: optional ISO date string
 */
export const getStateHistory = (req, res) => {
  try {
    const { room, limit = 100, startDate, endDate } = req.query;
    
    let history;
    if (startDate && endDate) {
      history = historyLogger.getHistoryByDateRange(room, startDate, endDate);
    } else {
      history = historyLogger.getHistory(room, parseInt(limit));
    }

    res.status(200).json({
      success: true,
      data: history,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * POST /api/monitor/update-room
 * Body options:
 *  - room: required (string or number)
 *  - d100, d101: optional numeric register values
 *  - xInput, yMain, ySub: optional booleans/0|1 to set individual bits
 *
 * This endpoint allows a client to push a simulated/actual input change for a room.
 * It will update the server-side room state via `stateManager.updateRoomState` and
 * then broadcast the new state to connected Socket.IO clients using monitorService.
 */
export const updateRoomFromApi = (req, res) => {
  try {
    const { room, d100, d101, xInput, yMain, ySub } = req.body || {};
    if (!room) return res.status(400).json({ error: 'Missing room in request body' });

    const roomId = room.toString();
    const mapping = config.roomMapping[roomId] || config.roomMapping[parseInt(roomId)];
    if (!mapping) return res.status(400).json({ error: `Room ${roomId} not found in mapping` });

    // If registers provided, use them directly
    if (typeof d100 !== 'undefined' && typeof d101 !== 'undefined') {
      stateManager.updateRoomState(roomId, Number(d100), Number(d101), mapping);
    } else {
      // Build registers from bit values (default 0)
      const x = xInput ? 1 : 0;
      const ym = yMain ? 1 : 0;
      const ys = ySub ? 1 : 0;
      const regD100 = x << mapping.x_input;
      const regD101 = (ym << mapping.y_output_main) | (ys << mapping.y_output_sub);
      stateManager.updateRoomState(roomId, regD100, regD101, mapping);
    }

    // Broadcast to connected clients
    monitorService.emitStateUpdate();

    const updated = stateManager.getRoomState(roomId) || {};
    const coil = stateManager.getCoilState(roomId) || {};

    return res.status(200).json({ success: true, room: roomId, state: updated, coil, timestamp: new Date().toISOString() });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};