import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePlcPayload, parseRoomPayload } from './configPayload.js';

test('parseRoomPayload returns normalized room configuration', () => {
  assert.deepEqual(parseRoomPayload({
    room_number: ' 201 ',
    floor: '2',
    y_main_coil: '10',
    y_sub_coil: 11,
    x_input: 0,
    y_output_main: 1,
    y_output_sub: 2,
    description: '  Suite  '
  }), {
    room: {
      room_number: '201',
      floor: 2,
      y_main_coil: 10,
      y_sub_coil: 11,
      x_input: 0,
      y_output_main: 1,
      y_output_sub: 2,
      description: 'Suite',
      is_active: 1,
      show_in_ui: 1
    }
  });
});

test('parseRoomPayload preserves validation errors', () => {
  assert.deepEqual(parseRoomPayload({ room_number: '0201' }), {
    error: 'Room number must contain 1 to 8 digits and cannot start with 0'
  });
  assert.deepEqual(parseRoomPayload({
    room_number: '201',
    floor: 2,
    y_main_coil: 10,
    y_sub_coil: 11,
    x_input: 0,
    y_output_main: 1,
    y_output_sub: 16
  }), { error: 'Input and output bit positions must be between 0 and 15' });
});

test('parsePlcPayload returns normalized PLC configuration', () => {
  assert.deepEqual(parsePlcPayload({
    ip: ' 192.168.1.20 ',
    port: '502',
    slave_id: 1,
    timeout: '1000',
    start_address: 100,
    register_count: '2'
  }), {
    plc: {
      ip: '192.168.1.20',
      port: 502,
      slave_id: 1,
      timeout: 1000,
      start_address: 100,
      register_count: 2
    }
  });
});

test('parsePlcPayload preserves validation errors', () => {
  assert.deepEqual(parsePlcPayload({
    ip: '192.168.1.20',
    port: 502,
    slave_id: 1,
    timeout: 1000,
    start_address: 65535,
    register_count: 2
  }), {
    error: 'Register count must be between 1 and 125 and fit the address range'
  });
});
