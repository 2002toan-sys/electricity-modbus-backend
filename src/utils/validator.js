import config from '../config/index.js';

/**
 * Validate if room exists in mapping
 */
export const validateRoomMapping = (room) => {
  return config.roomMapping[room] !== undefined;
};

/**
 * Validate relay request body
 * Expected format: [{ room: "201", set: "on" }, ...]
 */
export const validateRelayRequest = (data) => {
  // Check if data is array
  if (!Array.isArray(data)) {
    return { valid: false, error: 'Request body must be an array' };
  }

  // Validate each item
  for (const item of data) {
    // Check if item is object
    if (!item || typeof item !== 'object') {
      return { valid: false, error: 'Each item must be an object' };
    }

    // Check required properties
    if (!('room' in item) || !('set' in item)) {
      return { valid: false, error: 'Each item must have room and set properties' };
    }

    // Validate room
    if (!validateRoomMapping(item.room)) {
      return { valid: false, error: `Room ${item.room} not found in mapping` };
    }

    // Validate set value
    if (typeof item.set !== 'string') {
      return { valid: false, error: 'Set value must be a string' };
    }

    if (!['on', 'off'].includes(item.set.toLowerCase())) {
      return { valid: false, error: 'Set value must be "on" or "off"' };
    }
  }

  return { valid: true };
};