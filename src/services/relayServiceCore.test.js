import assert from 'node:assert/strict';
import test from 'node:test';
import RelayService from './relayServiceCore.js';

const createRelayService = (overrides = {}) => {
  const calls = {
    writes: [],
    coilUpdates: [],
    stateUpdates: 0,
    logs: []
  };
  const dependencies = {
    commandQueue: {
      enqueueWriteCoil: (...args) => {
        calls.writes.push(args);
        args[3]?.(null, true);
      }
    },
    stateManager: {
      getRoomState: () => ({ y_output_main: true }),
      updateCoilState: (...args) => {
        calls.coilUpdates.push(args);
        return true;
      }
    },
    monitorService: {
      emitStateUpdate: () => {
        calls.stateUpdates += 1;
      }
    },
    config: {
      app: { write_relay_enabled: true, interlock_enabled: true },
      getRoomMapping: () => ({
        floor: 2,
        y_main_coil: 10,
        y_sub_coil: 11
      })
    },
    logger: {
      error: (message) => calls.logs.push(['error', message]),
      info: (message) => calls.logs.push(['info', message]),
      debug: (message) => calls.logs.push(['debug', message])
    },
    ...overrides
  };

  return { service: new RelayService(dependencies), calls, dependencies };
};

test('setRelay writes the requested relay and returns the established result shape', async () => {
  const { service, calls } = createRelayService();

  const result = await service.setRelay('201', 'main', 'on');

  assert.deepEqual(calls.writes[0].slice(0, 3), [2, 10, true]);
  assert.deepEqual(calls.coilUpdates, [['201', 'main', true]]);
  assert.equal(calls.stateUpdates, 1);
  assert.deepEqual(
    { room: result.room, status: result.status, type: result.type, floor: result.floor },
    { room: '201', status: 'on', type: 'main', floor: 2 }
  );
  assert.equal(Number.isNaN(Date.parse(result.timestamp)), false);
});

test('setRelay preserves user relay permission checks', async () => {
  const { service } = createRelayService();

  await assert.rejects(
    service.setRelay('201', 'main', 'off', 'user'),
    /User role cannot control main relay/
  );

  const { service: subService, dependencies } = createRelayService();
  dependencies.stateManager.getRoomState = () => ({ y_output_main: false });
  await assert.rejects(
    subService.setRelay('201', 'sub', 'on', 'user'),
    /User can only control sub relay when main relay is ON/
  );
});

test('setRelay rejects when relay writes are disabled or room mapping is missing', async () => {
  const { service, dependencies } = createRelayService();
  dependencies.config.app.write_relay_enabled = false;
  await assert.rejects(service.setRelay('201', 'main', 'on'), /functionality is disabled/);

  dependencies.config.app.write_relay_enabled = true;
  dependencies.config.getRoomMapping = () => undefined;
  await assert.rejects(service.setRelay('201', 'main', 'on'), /Room 201 not in mapping/);
});

test('setRelay rejects failed writes and does not update local state', async () => {
  const { service, dependencies, calls } = createRelayService();
  dependencies.commandQueue.enqueueWriteCoil = (...args) => {
    calls.writes.push(args);
    args[3](new Error('PLC write failed'));
  };

  await assert.rejects(service.setRelay('201', 'main', 'off'), /PLC write failed/);
  assert.deepEqual(calls.coilUpdates, []);
  assert.equal(calls.logs[0][0], 'error');
});

test('turning off main queues sub off when the interlock is enabled', async () => {
  const { service, calls } = createRelayService();

  await service.setRelay('201', 'main', 'off');

  assert.deepEqual(calls.writes[1].slice(0, 3), [2, 11, false]);
  assert.equal(calls.writes[1].length, 3);
});

test('turning off main does not queue sub when the interlock is disabled', async () => {
  const { service, calls, dependencies } = createRelayService();
  dependencies.config.app.interlock_enabled = false;

  await service.setRelay('201', 'main', 'off');

  assert.equal(calls.writes.length, 1);
});

test('setRelay broadcasts only when the persisted relay state changes', async () => {
  const { service, calls, dependencies } = createRelayService();
  dependencies.stateManager.updateCoilState = () => false;

  await service.setRelay('201', 'sub', 'on');

  assert.equal(calls.stateUpdates, 0);
});
