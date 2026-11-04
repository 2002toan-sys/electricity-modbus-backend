import logger from '../utils/logger.js';
import historyLogger from './historyLogger.js';
import notificationService from './notificationService.js';
import db from '../database/db.js';
import StateManager from './stateManagerCore.js';

export default new StateManager({
  logger,
  historyLogger,
  notificationService,
  db
});
