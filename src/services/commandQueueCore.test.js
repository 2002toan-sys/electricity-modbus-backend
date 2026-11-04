import assert from 'node:assert/strict';
import test from 'node:test';
import CommandQueue from './commandQueueCore.js';

const createQueue = (overrides = {}) => {
  const calls = { writes: [], logs: [] };
  const dependencies = {
    plcManager: {
      clients: new Map([['floor_2', { connected: true }]]),
      getConnectionStatus: () => ({ connected: true }),
      writeCoil: async (...args) => {
        calls.writes.push(['coil', ...args]);
        return true;
      },
      writeRegister: async (...args) => {
        calls.writes.push(['register', ...args]);
        return true;
      },
      readRegisters: async () => [0, 0],
      readCoils: async () => [false]
    },
    stateManager: {
      updateRoomState: () => {},
      updateCoilState: () => {}
    },
    config: {
      app: { polling_interval: 500 },
      plcs: [{ floor: 2, dataRegisters: { startAddress: 100, count: 2 } }],
      getRoomsByFloor: () => [],
      getPLCConfig: () => undefined
    },
    logger: {
      info: (...args) => calls.logs.push(['info', ...args]),
      warn: (...args) => calls.logs.push(['warn', ...args]),
      error: (...args) => calls.logs.push(['error', ...args]),
      debug: (...args) => calls.logs.push(['debug', ...args])
    },
    ...overrides
  };

  return { queue: new CommandQueue(dependencies), dependencies, calls };
};

const enqueueAndWait = (queue, method, ...args) => new Promise((resolve, reject) => {
  queue[method](...args, (error, result) => {
    if (error) reject(error);
    else resolve(result);
  });
});

test('CommandQueue executes queued writes and calls back with the result', async () => {
  const { queue, calls } = createQueue();
  const result = await enqueueAndWait(queue, 'enqueueWriteCoil', 2, 14, true);

  assert.equal(result, true);
  assert.deepEqual(calls.writes, [['coil', 2, 14, true]]);
  queue.destroy();
});

test('CommandQueue reports missing floor and paused queue errors through callback', async () => {
  const { queue } = createQueue();

  await assert.rejects(
    enqueueAndWait(queue, 'enqueueWriteCoil', 3, 14, true),
    /Floor 3 not configured/
  );

  queue.isPaused.set('floor_2', true);
  await assert.rejects(
    enqueueAndWait(queue, 'enqueueWriteCoil', 2, 14, true),
    /Queue paused \(PLC disconnected\)/
  );
  queue.destroy();
});

test('CommandQueue prioritizes writes and avoids duplicate reads', () => {
  const { queue } = createQueue();
  queue.isProcessing.set('floor_2', true);

  const readCommand = queue.enqueueReadHoldingRegisters(2);
  assert.equal(queue.enqueueReadHoldingRegisters(2), null);
  const writeCommand = queue.enqueueWriteCoil(2, 14, true);
  const queued = queue.queues.get('floor_2');

  assert.equal(queued[0], writeCommand);
  assert.equal(queued[1], readCommand);
  queue.destroy();
});

test('CommandQueue marks the floor paused when a write loses PLC connection', async () => {
  const error = new Error('connection refused');
  const { queue, dependencies } = createQueue();
  dependencies.plcManager.writeCoil = async () => {
    throw error;
  };

  await assert.rejects(
    enqueueAndWait(queue, 'enqueueWriteCoil', 2, 14, true),
    /connection refused/
  );

  assert.equal(queue.isPaused.get('floor_2'), true);
  queue.destroy();
});
