import commandQueue from './commandQueue.js';
import monitorService from './monitorService.js';
import stateManager from './stateManager.js';
import RelayService from './relayServiceCore.js';
import config from '../utils/configLoader.js';
import logger from '../utils/logger.js';

export default new RelayService({
  commandQueue,
  stateManager,
  monitorService,
  config,
  logger
});
