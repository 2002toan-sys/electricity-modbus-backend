import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { setupServiceTestDatabase } from '../test/serviceTestSetup.js';

const cleanup = await setupServiceTestDatabase();
const { StateManager } = await import('./stateManager.js');
after(cleanup);

const createStateManager = (initialRows = []) => {
  const calls = { roomUpdates: [], mainCoilUpdates: [], subCoilUpdates: [], histories: [], notifications: [], logs: [] };
  const db = {
    prepare(sql) {
      if (sql.includes('UPDATE room_current_states') && sql.includes('SET state =')) {
        return { run: (values) => calls.roomUpdates.push(values) };
      }
      if (sql.includes('SET main_relay_status')) {
        return { run: (...values) => calls.mainCoilUpdates.push(values) };
      }
      if (sql.includes('SET sub_relay_status')) {
        return { run: (...values) => calls.subCoilUpdates.push(values) };
      }
      if (sql.includes('SELECT * FROM room_current_states WHERE')) {
        return { get: (room) => initialRows.find((row) => row.room_number === room) };
      }
      return { all: () => initialRows };
    }
  };
  const logger = {
    info: (message) => calls.logs.push(['info', message]),
    error: (message) => calls.logs.push(['error', message])
  };
  const notificationService = {
    generateMessage: (room, previous, next) => `${room}:${previous}->${next}`,
    sendNotification: (...args) => calls.notifications.push(args)
  };
  const historyLogger = {
    logStateChange: (...args) => calls.histories.push(args)
  };

  return {
    stateManager: new StateManager({ logger, historyLogger, notificationService, db }),
    calls
  };
};

test('StateManager maps PLC bits to known room states and persists changes', () => {
  const initialRows = [{
    room_number: '201',
    state: 0,
    state_name: 'Trống',
    x_input: 0,
    y_output_main: 0,
    y_output_sub: 0,
    main_relay_status: 0,
    sub_relay_status: 0,
    last_updated: '2026-01-01T00:00:00.000Z'
  }];
  const { stateManager, calls } = createStateManager(initialRows);

  stateManager.updateRoomState('201', 0, 1, {
    floor: 2,
    x_input: 0,
    y_output_main: 0,
    y_output_sub: 1
  });

  assert.equal(stateManager.getRoomState('201').state, 1);
  assert.equal(stateManager.getRoomState('201').stateName, 'Chờ khách');
  assert.equal(stateManager.getRoomState('201').y_output_main, true);
  assert.equal(calls.roomUpdates.length, 1);
  assert.deepEqual(calls.histories[0], ['201', 2, 'Trống', 'Chờ khách', '201:Trống->Chờ khách']);
  assert.deepEqual(calls.notifications[0], ['201', 'Trống', 'Chờ khách', '201:Trống->Chờ khách']);
});

test('StateManager only persists and notifies when calculated room state changes', () => {
  const initialRows = [{
    room_number: '201',
    state: 1,
    state_name: 'Chờ khách',
    x_input: 0,
    y_output_main: 1,
    y_output_sub: 0,
    main_relay_status: 1,
    sub_relay_status: 0
  }];
  const { stateManager, calls } = createStateManager(initialRows);

  stateManager.updateRoomState('201', 0, 1, {
    floor: 2,
    x_input: 0,
    y_output_main: 0,
    y_output_sub: 1
  });

  assert.equal(calls.roomUpdates.length, 0);
  assert.equal(calls.histories.length, 0);
  assert.equal(calls.notifications.length, 0);
});

test('StateManager updates and persists relay coil states with change detection', () => {
  const { stateManager, calls } = createStateManager();

  assert.equal(stateManager.updateCoilState('201', 'main', true), true);
  assert.equal(stateManager.updateCoilState('201', 'main', true), false);
  assert.equal(stateManager.updateCoilState('201', 'sub', false), true);

  assert.deepEqual(calls.mainCoilUpdates, [[1, '201']]);
  assert.deepEqual(calls.subCoilUpdates, [[0, '201']]);
  assert.deepEqual(stateManager.getCoilState('201'), {
    y_output_main: true,
    y_output_sub: false,
    timestamp: stateManager.getCoilState('201').timestamp
  });
});

test('StateManager loads a single room and rejects unknown rooms', () => {
  const rows = [{
    room_number: '201',
    state: 2,
    state_name: 'Có khách',
    x_input: 1,
    y_output_main: 1,
    y_output_sub: 0,
    main_relay_status: 1,
    sub_relay_status: 0
  }];
  const { stateManager } = createStateManager(rows);

  stateManager.loadRoomState(201);
  assert.equal(stateManager.getRoomState('201').stateName, 'Có khách');
  assert.throws(() => stateManager.loadRoomState(999), /Room state not found for room 999/);
});
