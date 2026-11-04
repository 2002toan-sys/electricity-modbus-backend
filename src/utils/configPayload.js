import { isIP } from 'node:net';

const ROOM_FIELDS = [
  'y_main_coil',
  'y_sub_coil',
  'x_input',
  'y_output_main',
  'y_output_sub'
];

export const parseInteger = (value) => {
  if (typeof value !== 'number' && typeof value !== 'string') return NaN;
  if (typeof value === 'string' && value.trim() === '') return NaN;
  return Number(value);
};

export const parseRoomPayload = (body) => {
  const roomNumber = typeof body.room_number === 'string'
    ? body.room_number.trim()
    : String(body.room_number ?? '').trim();
  const floor = parseInteger(body.floor);
  const values = Object.fromEntries(ROOM_FIELDS.map((field) => [field, parseInteger(body[field])]));
  if (body.description !== undefined && typeof body.description !== 'string') {
    return { error: 'Description must be text' };
  }
  const description = body.description?.trim() || '';
  const isActive = body.is_active === undefined ? 1 : Number(body.is_active);
  const showInUi = body.show_in_ui === undefined ? 1 : Number(body.show_in_ui);

  if (!/^[1-9]\d{0,7}$/.test(roomNumber)) {
    return { error: 'Room number must contain 1 to 8 digits and cannot start with 0' };
  }
  if (!Number.isInteger(floor) || floor < 1 || floor > 99) {
    return { error: 'Floor must be an integer between 1 and 99' };
  }
  if (ROOM_FIELDS.some((field) => !Number.isInteger(values[field]))) {
    return { error: 'Modbus mapping values must be integers' };
  }
  if (values.y_main_coil < 0 || values.y_main_coil > 65535 ||
      values.y_sub_coil < 0 || values.y_sub_coil > 65535) {
    return { error: 'Coil addresses must be between 0 and 65535' };
  }
  if (['x_input', 'y_output_main', 'y_output_sub'].some((field) =>
    values[field] < 0 || values[field] > 15
  )) {
    return { error: 'Input and output bit positions must be between 0 and 15' };
  }
  if (description.length > 200) {
    return { error: 'Description cannot exceed 200 characters' };
  }
  if (![0, 1].includes(isActive)) {
    return { error: 'is_active must be 0 or 1' };
  }
  if (![0, 1].includes(showInUi)) {
    return { error: 'show_in_ui must be 0 or 1' };
  }

  return {
    room: {
      room_number: roomNumber,
      floor,
      ...values,
      description,
      is_active: isActive,
      show_in_ui: showInUi
    }
  };
};

export const parsePlcPayload = (body) => {
  const ip = typeof body.ip === 'string' ? body.ip.trim() : '';
  const values = {
    port: parseInteger(body.port),
    slave_id: parseInteger(body.slave_id),
    timeout: parseInteger(body.timeout),
    start_address: parseInteger(body.start_address),
    register_count: parseInteger(body.register_count)
  };

  if (!isIP(ip)) return { error: 'PLC IP must be a valid IPv4 or IPv6 address' };
  if (!Number.isInteger(values.port) || values.port < 1 || values.port > 65535) {
    return { error: 'Port must be an integer between 1 and 65535' };
  }
  if (!Number.isInteger(values.slave_id) || values.slave_id < 1 || values.slave_id > 247) {
    return { error: 'Slave ID must be an integer between 1 and 247' };
  }
  if (!Number.isInteger(values.timeout) || values.timeout < 100 || values.timeout > 60000) {
    return { error: 'Timeout must be an integer between 100 and 60000 ms' };
  }
  if (!Number.isInteger(values.start_address) ||
      values.start_address < 0 || values.start_address > 65535) {
    return { error: 'Start address must be an integer between 0 and 65535' };
  }
  if (!Number.isInteger(values.register_count) ||
      values.register_count < 1 || values.register_count > 125 ||
      values.start_address + values.register_count > 65536) {
    return { error: 'Register count must be between 1 and 125 and fit the address range' };
  }

  return { plc: { ip, ...values } };
};
