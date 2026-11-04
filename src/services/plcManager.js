import Modbus from 'jsmodbus';
import net from 'node:net';
import config from '../utils/configLoader.js';
import logger from '../utils/logger.js';
import PLCManager from './plcManagerCore.js';

let commandQueue;

async function getCommandQueue() {
  if (!commandQueue) {
    try {
      commandQueue = (await import('./commandQueue.js')).default;
    } catch {
      logger.warn('PLCManager: cannot import commandQueue');
    }
  }
  return commandQueue;
}

export default new PLCManager({
  createSocket: () => new net.Socket(),
  createModbusClient: (socket, slaveId, timeout) => (
    new Modbus.client.TCP(socket, slaveId, timeout)
  ),
  config,
  logger,
  getCommandQueue
});
