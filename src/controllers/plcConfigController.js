import plcManager from '../services/plcManager.js';
import configService from '../services/configService.js';
import config from '../utils/configLoader.js';
import { parseInteger, parsePlcPayload } from '../utils/configPayload.js';

export const getPlcsConfig = (req, res) => {
  try {
    const plcs = configService.listPlcs().map((plc) => ({
      ...plc,
      ...plcManager.getConnectionStatus(plc.floor)
    }));
    return res.status(200).json(plcs);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

export const createPlc = async (req, res) => {
  try {
    const floor = parseInteger(req.body?.floor);
    if (!Number.isInteger(floor) || floor < 1 || floor > 99) {
      return res.status(400).json({ error: 'PLC floor must be an integer between 1 and 99' });
    }

    const result = parsePlcPayload(req.body || {});
    if (result.error) return res.status(400).json({ error: result.error });
    if (configService.hasPlc(floor)) {
      return res.status(409).json({ error: `PLC for floor ${floor} already exists` });
    }

    configService.createPlc(floor, result.plc);
    config.reload();
    const connection = await plcManager.reconfigurePLC(config.getPLCConfig(floor));
    const plc = configService.getPlc(floor);
    return res.status(201).json({ success: true, plc, connection });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
        error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'A PLC is already configured for this floor' });
    }
    return res.status(500).json({ error: error.message });
  }
};

export const updatePlc = async (req, res) => {
  try {
    const floor = parseInteger(req.params.floor ?? req.body?.floor);
    if (!Number.isInteger(floor) || floor < 1 || floor > 99) {
      return res.status(400).json({ error: 'Invalid PLC floor' });
    }

    const result = parsePlcPayload(req.body || {});
    if (result.error) return res.status(400).json({ error: result.error });

    if (!configService.hasPlc(floor)) {
      return res.status(404).json({ error: `PLC for floor ${floor} not found` });
    }

    configService.updatePlc(floor, result.plc);

    config.reload();
    const connection = await plcManager.reconfigurePLC(config.getPLCConfig(floor));
    const plc = configService.getPlc(floor);
    return res.status(200).json({ success: true, plc, connection });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

export const deletePlc = async (req, res) => {
  try {
    const floor = parseInteger(req.params.floor);
    if (!Number.isInteger(floor) || floor < 1 || floor > 99) {
      return res.status(400).json({ error: 'Invalid PLC floor' });
    }
    if (!configService.hasPlc(floor)) {
      return res.status(404).json({ error: `PLC for floor ${floor} not found` });
    }

    const roomCount = configService.countRoomsOnFloor(floor);
    if (roomCount > 0) {
      return res.status(409).json({
        error: `Cannot delete PLC for floor ${floor} while ${roomCount} room(s) are assigned to it`
      });
    }

    configService.deletePlc(floor);
    config.reload();
    await plcManager.disconnectPLC(floor);
    return res.status(200).json({ success: true, floor });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
