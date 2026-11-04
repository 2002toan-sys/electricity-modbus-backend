import logger from '../utils/logger.js';
import db from '../database/db.js';
import HistoryLogger from './historyLoggerCore.js';

export default new HistoryLogger({ logger, db });
