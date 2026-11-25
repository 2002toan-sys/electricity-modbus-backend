import monitorService from '../services/monitorService.js';
import plcManager from '../services/plcManager.js';
import stateManager from '../services/stateManager.js';
import historyLogger from '../services/historyLogger.js';
import config from '../utils/configLoader.js';

/**
 * GET /api/monitor/rooms - Get all room states with calculated state
 */
export const getRoomStates = (req, res) => {
  try {
    let roomStates = stateManager.getAllRoomStates();
    let coilStates = stateManager.getAllCoilStates();

    // If no room states exist yet, initialize from config
    if (Object.keys(roomStates).length === 0) {
      config.roomMap.forEach((mapping, roomId) => {
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
    const formattedRooms = [...config.roomMap.entries()].map(([roomId, mapping]) => {
      const roomState = roomStates[roomId] || {
        state: 0,
        stateName: 'Trống',
        x_input: false,
        timestamp: new Date().toISOString()
      };
      const coilState = coilStates[roomId] || {};
      return {
        room: parseInt(roomId) || roomId,
        floor: mapping.floor,
        show_in_ui: mapping.show_in_ui,
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
 * GET /api/monitor/history - Get state history with filtering and pagination
 * Query params:
 *   - room: optional room number to filter
 *   - state: optional new state to filter
 *   - search: optional text search across room, state names, message, and source
 *   - startDate: optional ISO date string
 *   - endDate: optional ISO date string
 *   - page: page number (default 1)
 *   - limit: number of records per page (default 20)
 */
export const getStateHistory = (req, res) => {
  try {
    const { room, limit = 20, page = 1, startDate, endDate, state, search } = req.query;
    if (typeof search === 'string' && search.length > 100) {
      return res.status(400).json({ error: 'Search query cannot exceed 100 characters' });
    }
    const isValidDate = (value) => {
      if (typeof value !== 'string') return false;
      const datePart = value.slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return false;
      const parsedDate = new Date(`${datePart}T00:00:00.000Z`);
      return !Number.isNaN(parsedDate.getTime()) &&
        parsedDate.toISOString().slice(0, 10) === datePart &&
        (value.length === 10 || !Number.isNaN(Date.parse(value)));
    };
    if ((startDate && !isValidDate(startDate)) || (endDate && !isValidDate(endDate))) {
      return res.status(400).json({ error: 'Invalid history date filter' });
    }
    if (startDate && endDate && startDate.slice(0, 10) > endDate.slice(0, 10)) {
      return res.status(400).json({ error: 'Start date must not be after end date' });
    }

    const result = historyLogger.getHistory({
      room,
      startDate,
      endDate,
      state,
      search,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20
    });

    res.status(200).json({
      success: true,
      data: result.records,
      pagination: result.pagination,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * POST /api/monitor/update-room
 */
export const updateRoomFromApi = (req, res) => {
  try {
    const { room, d100, d101, xInput, yMain, ySub } = req.body || {};
    if (!room) return res.status(400).json({ error: 'Missing room in request body' });

    const roomId = room.toString();
    const mapping = config.getRoomMapping(roomId);
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
