import stateManager from '../services/stateManager.js';
import configService from '../services/configService.js';
import config from '../utils/configLoader.js';
import { parseRoomPayload } from '../utils/configPayload.js';

export const getRoomsConfig = (req, res) => {
  try {
    const rooms = configService.listRooms();
    return res.status(200).json(rooms);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

export const createRoom = (req, res) => {
  try {
    const result = parseRoomPayload(req.body || {});
    if (result.error) return res.status(400).json({ error: result.error });

    const { room } = result;
    if (room.is_active && !configService.hasActivePlc(room.floor)) {
      return res.status(400).json({ error: `No active PLC configured for floor ${room.floor}` });
    }

    configService.createRoom(room);

    config.reload();
    stateManager.loadRoomState(room.room_number);
    return res.status(201).json({ success: true, room: configService.getRoom(room.room_number) });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' || error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'Room number already exists' });
    }
    return res.status(500).json({ error: error.message });
  }
};

export const updateRoom = (req, res) => {
  try {
    const result = parseRoomPayload({ ...req.body, room_number: req.params.room });
    if (result.error) return res.status(400).json({ error: result.error });

    const { room } = result;
    if (!configService.getRoom(room.room_number)) {
      return res.status(404).json({ error: `Room ${room.room_number} not found` });
    }
    if (room.is_active && !configService.hasActivePlc(room.floor)) {
      return res.status(400).json({ error: `No active PLC configured for floor ${room.floor}` });
    }

    configService.updateRoom(room);

    config.reload();
    return res.status(200).json({ success: true, room: configService.getRoom(room.room_number) });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

export const deleteRoom = (req, res) => {
  try {
    const roomNumber = String(req.params.room || '').trim();
    if (!/^[1-9]\d{0,7}$/.test(roomNumber)) {
      return res.status(400).json({ error: 'Invalid room number' });
    }
    const changes = configService.deactivateRoom(roomNumber);
    if (!changes) {
      return res.status(404).json({ error: `Room ${roomNumber} not found` });
    }

    config.reload();
    return res.status(200).json({ success: true, room: configService.getRoom(roomNumber) });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
