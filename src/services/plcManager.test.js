import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test, { after } from 'node:test';
import { setupServiceTestDatabase } from '../test/serviceTestSetup.js';

const cleanup = await setupServiceTestDatabase();
const { PLCManager } = await import('./plcManager.js');
after(cleanup);

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.destroyed = false;
    this.writable = true;
    this.connectionOptions = null;
  }

  setKeepAlive() {}

  connect(options) {
    this.connectionOptions = options;
  }

  destroy() {
    this.destroyed = true;
    this.writable = false;
  }
}

const createPLCManager = (configOverrides = {}) => {
  const calls = { sockets: [], modbus: [], logs: [], timers: [], clearedTimers: [] };
  const commandQueue = {
    processedFloors: [],
    processQueue(floor) {
      this.processedFloors.push(floor);
    },
    addFloor() {},
    refreshFloorPolling() {},
    removeFloor() {}
  };
  const config = {
    plcs: [],
    reconnect: { initialDelay: 100, maxDelay: 1000, backoffMultiplier: 2 },
    ...configOverrides
  };
  const manager = new PLCManager({
    createSocket: () => {
      const socket = new FakeSocket();
      calls.sockets.push(socket);
      return socket;
    },
    createModbusClient: (socket, slaveId, timeout) => {
      const client = {
        writeSingleCoil: async (...args) => calls.modbus.push(['writeCoil', ...args]),
        writeSingleRegister: async (...args) => calls.modbus.push(['writeRegister', ...args]),
        readCoils: async (...args) => ({
          response: { body: { valuesAsArray: ['coil', ...args] } }
        }),
        readHoldingRegisters: async (...args) => ({
          response: { body: { valuesAsArray: ['register', ...args] } }
        })
      };
      calls.modbus.push(['createClient', slaveId, timeout]);
      return client;
    },
    config,
    logger: {
      info: (...args) => calls.logs.push(['info', ...args]),
      warn: (...args) => calls.logs.push(['warn', ...args])
    },
    getCommandQueue: async () => commandQueue,
    setTimeoutFn: (callback, delay) => {
      const timer = { callback, delay };
      calls.timers.push(timer);
      return timer;
    },
    clearTimeoutFn: (timer) => calls.clearedTimers.push(timer)
  });

  return { manager, config, commandQueue, calls };
};

test('PLCManager connects a floor and exposes its Modbus client', async () => {
  const plcConfig = { floor: 2, ip: '192.0.2.10', port: 502, slaveId: 1, timeout: 1000 };
  const { manager, commandQueue, calls } = createPLCManager({ plcs: [plcConfig] });

  const initialization = manager.initialize();
  const socket = calls.sockets[0];
  assert.deepEqual(socket.connectionOptions, { host: plcConfig.ip, port: plcConfig.port });
  socket.emit('connect');
  await initialization;

  assert.deepEqual(commandQueue.processedFloors, [2]);
  assert.equal(manager.getConnectionStatus(2).connected, true);
  assert.equal(manager.getClient(2), manager.clients.get('floor_2').client);
  assert.deepEqual(calls.modbus[0], ['createClient', 1, 1000]);
});

test('PLCManager delegates Modbus operations and returns register values', async () => {
  const { manager, calls } = createPLCManager();
  manager.connectPLC({ floor: 2, ip: '192.0.2.10', port: 502, slaveId: 1, timeout: 1000 });
  calls.sockets[0].emit('connect');

  await manager.writeCoil(2, 10, true);
  await manager.writeRegister(2, 100, 4);
  assert.deepEqual(await manager.readCoils(2, 10, 1), ['coil', 10, 1]);
  assert.deepEqual(await manager.readRegisters(2, 100, 2), ['register', 100, 2]);
  assert.deepEqual(calls.modbus.slice(1), [
    ['writeCoil', 10, true],
    ['writeRegister', 100, 4]
  ]);
});

test('PLCManager schedules reconnect with configured backoff on socket close', async () => {
  const { manager, calls } = createPLCManager({
    reconnect: { initialDelay: 100, maxDelay: 500, backoffMultiplier: 2 }
  });
  const plcConfig = { floor: 2, ip: '192.0.2.10', port: 502, slaveId: 1, timeout: 1000 };

  const connection = manager.connectPLC(plcConfig);
  calls.sockets[0].emit('close');
  await connection;

  assert.equal(calls.timers[0].delay, 100);
  assert.equal(manager.getConnectionStatus(2).connected, false);
  assert.equal(manager.getConnectionStatus(2).isReconnecting, true);
  assert.equal(manager.getConnectionStatus(2).reconnectDelay, 200);
  await manager.destroy();
  assert.deepEqual(calls.clearedTimers, [calls.timers[0]]);
});

test('PLCManager rejects client access until a floor is connected', () => {
  const { manager } = createPLCManager();

  assert.throws(() => manager.getClient(2), /Floor 2 not initialized/);

  manager.clients.set('floor_2', {
    client: {},
    connected: false,
    socket: { destroyed: false, writable: true }
  });
  assert.throws(() => manager.getClient(2), /Floor 2 port not open/);
});
