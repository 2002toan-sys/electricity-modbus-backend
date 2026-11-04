import plcManager from './plcManager.js';
import stateManager from './stateManager.js';
import config from '../utils/configLoader.js';
import logger from '../utils/logger.js';
import CommandQueue from './commandQueueCore.js';

export default new CommandQueue({ plcManager, stateManager, config, logger });
