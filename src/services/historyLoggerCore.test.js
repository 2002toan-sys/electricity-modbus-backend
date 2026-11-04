import assert from 'node:assert/strict';
import test from 'node:test';
import HistoryLogger from './historyLoggerCore.js';

const createHistoryLogger = (overrides = {}) => {
  const calls = { prepared: [], inserted: [], queryParams: [], loggedErrors: [] };
  const rows = [
    { id: 1, room: '201', message: 'Guest arrived' },
    { id: 2, room: '202', message: 'Room cleaned' }
  ];
  const db = {
    prepare(sql) {
      calls.prepared.push(sql);
      if (sql.includes('COUNT(*)')) {
        return {
          get: (...params) => {
            calls.queryParams.push(params);
            return { total: rows.length };
          }
        };
      }
      if (sql.includes('INSERT INTO room_history')) {
        return { run: (record) => calls.inserted.push(record) };
      }
      return {
        all: (...params) => {
          calls.queryParams.push(params);
          if (overrides.queryError) throw overrides.queryError;
          return rows.slice(0, params.at(-2));
        }
      };
    }
  };
  const logger = {
    debug: () => {},
    error: (message) => calls.loggedErrors.push(message)
  };

  return { history: new HistoryLogger({ db, logger }), calls };
};

test('getHistory retains filtering, search, pagination, and response shape', () => {
  const { history, calls } = createHistoryLogger();

  const result = history.getHistory({
    room: 201,
    startDate: '2026-01-01',
    endDate: '2026-01-31',
    state: 'Có khách',
    search: 'guest 201',
    page: 2,
    limit: 1
  });

  assert.deepEqual(result, {
    records: [{ id: 1, room: '201', message: 'Guest arrived' }],
    pagination: { page: 2, limit: 1, total: 2, totalPages: 2 }
  });
  assert.deepEqual(calls.queryParams[0], [
    '201',
    '2026-01-01T00:00:00.000Z',
    '2026-01-31T00:00:00.000Z',
    'Có khách',
    'guest',
    '201'
  ]);
  assert.deepEqual(calls.queryParams[1].slice(-2), [1, 1]);
  assert.match(calls.prepared[1], /room_number = \?/);
  assert.match(calls.prepared[1], /instr\(lower/);
});

test('getHistory preserves legacy room/limit form and clamps page limits', () => {
  const { history, calls } = createHistoryLogger();

  const result = history.getHistory('201', 1000);
  assert.equal(result.pagination.limit, 500);
  assert.equal(calls.queryParams[0][0], '201');

  const beyondLastPage = history.getHistory({ page: 99, limit: 1 });
  assert.equal(beyondLastPage.pagination.page, 2);
});

test('getHistory returns the established empty result when the database query fails', () => {
  const { history, calls } = createHistoryLogger({ queryError: new Error('query failed') });

  const result = history.getHistory({ limit: 10 });

  assert.deepEqual(result, {
    records: [],
    pagination: { page: 1, limit: 10, total: 0, totalPages: 1 }
  });
  assert.match(calls.loggedErrors[0], /query failed/);
});

test('logStateChange keeps the existing persisted record fields and defaults', () => {
  const { history, calls } = createHistoryLogger();

  history.logStateChange(null, 'not-a-floor', null, 'Có khách', null);

  const { timestamp, ...record } = calls.inserted[0];
  assert.equal(Number.isNaN(Date.parse(timestamp)), false);
  assert.deepEqual(record, {
    room_number: '',
    floor: 0,
    previous_state: 'Unknown',
    new_state: 'Có khách',
    message: '',
    trigger_source: 'modbus'
  });
});
