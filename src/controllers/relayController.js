import relayService from '../services/relayService.js';
import { validateRelayRequest, validateRoomsList } from '../utils/validator.js';
import logger from '../utils/logger.js';
import config from '../utils/configLoader.js';
import stateManager from '../services/stateManager.js';

/**
 * POST /api/relay/main/set - Set main relay for rooms
 * Body: [{ room: "201", set: "on" }, ...]
 * Response: [{ room: "201", status: "on", type: "main", time: "..." }, ...]
 */
export const setMainRelay = async (req, res) => {
  try {
    // Check if write relay is enabled
    if (!config.app?.write_relay_enabled) {
      return res.status(503).json({ error: 'Write relay functionality is currently disabled' });
    }

    const validation = validateRelayRequest(req.body);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    const userRole = req.user?.role || 'admin';
    const results = [];
    for (const item of req.body) {
      try {
        const result = await relayService.setRelay(item.room, 'main', item.set, userRole);
        results.push(result);
      } catch (error) {
        logger.error(`Failed to set main relay for room ${item.room}: ${error.message}`);
        throw error; // Fail fast on first error
      }
    }

    res.status(200).json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * POST /api/relay/sub/set - Set sub relay for rooms
 * B// Check if write relay is enabled
    if (!config.app?.write_relay_enabled) {
      return res.status(503).json({ error: 'Write relay functionality is currently disabled' });
    }

    ody: [{ room: "201", set: "on" }, ...]
 * Response: [{ room: "201", status: "on", type: "sub", time: "..." }, ...]
 */
export const setSubRelay = async (req, res) => {
  try {
    const validation = validateRelayRequest(req.body);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    const userRole = req.user?.role || 'admin';
    const results = [];
    for (const item of req.body) {
      try {
        const result = await relayService.setRelay(item.room, 'sub', item.set, userRole);
        results.push(result);
      } catch (error) {
        logger.error(`Failed to set sub relay for room ${item.room}: ${error.message}`);
        throw error; // Fail fast on first error
      }
    }

    res.status(200).json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

/**
 * GET /api/relay/main/get - Get main relay status for 1, many or all rooms
 * Query: ?rooms=201,202 (optional)
 */
export const getMainRelayStatus = (req, res) => {
  try {
    const validation = validateRoomsList(req.query);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    const { rooms } = validation;
    const allRoomStates = stateManager.getAllRoomStates();
    const result = {};

    if (rooms.length === 0) {
      // Lấy tất cả
      Object.keys(allRoomStates).forEach(roomId => {
        result[roomId] = allRoomStates[roomId].y_output_main ? 'on' : 'off';
      });
    } else {
      // Lấy theo danh sách phòng yêu cầu
      rooms.forEach(roomId => {
        result[roomId] = allRoomStates[roomId]?.y_output_main ? 'on' : 'off';
      });
    }

    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};