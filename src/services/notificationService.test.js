import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { setupServiceTestDatabase } from '../test/serviceTestSetup.js';

const cleanup = await setupServiceTestDatabase();
const { NotificationService } = await import('./notificationService.js');
after(cleanup);

const createNotificationService = (configOverrides = {}) => {
  const calls = { saved: [], events: [], telegram: [], email: [], timers: [], logs: [] };
  const config = {
    notifications: {
      telegram: { enabled: false },
      email: { enabled: false },
      stateTransitions: { 'Trống-Có khách': 'Phòng {room} vừa có khách' }
    },
    ...configOverrides
  };
  const service = new NotificationService({
    axios: {
      post: async (...args) => {
        calls.telegram.push(args);
        return { data: { ok: true } };
      }
    },
    nodemailer: {
      createTransport: (options) => ({
        sendMail: async (mail) => calls.email.push({ options, mail })
      })
    },
    logger: {
      debug: (message) => calls.logs.push(['debug', message]),
      error: (message) => calls.logs.push(['error', message])
    },
    config,
    notificationLogger: {
      saveNotification: (notification) => calls.saved.push(notification)
    },
    getStateManager: async () => ({
      getCoilState: () => ({ y_output_main: true, y_output_sub: false })
    }),
    setTimeoutFn: (callback, delay) => {
      calls.timers.push({ callback, delay });
      return calls.timers.at(-1);
    }
  });
  service.on('state-change', (event) => calls.events.push(event));

  return { service, calls, config };
};

test('generateMessage uses configured templates and retains fallback text', () => {
  const { service } = createNotificationService();

  assert.equal(service.generateMessage('201', 'Trống', 'Có khách'), 'Phòng 201 vừa có khách');
  assert.equal(service.generateMessage('202', 'Có khách', 'Trống'), 'Phòng 202: Có khách → Trống');
});

test('sendNotification persists and emits the same state-change payload', async () => {
  const { service, calls } = createNotificationService();

  await service.sendNotification('201', 'Trống', 'Có khách', 'Phòng 201 vừa có khách');

  assert.equal(calls.saved.length, 1);
  assert.equal(calls.saved[0].room, '201');
  assert.equal(calls.saved[0].stateName, 'Có khách');
  assert.equal(calls.saved[0].read, false);
  assert.equal(calls.events.length, 1);
  assert.equal(calls.events[0].id, calls.saved[0].id);
  assert.equal(calls.events[0].timestamp, calls.saved[0].timestamp);
  assert.equal(calls.events[0].mainStatus, true);
  assert.equal(calls.events[0].subStatus, false);
});

test('sendNotification delivers email when enabled', async () => {
  const { service, calls } = createNotificationService({
    notifications: {
      telegram: { enabled: false },
      email: {
        enabled: true,
        service: 'smtp',
        user: 'sender@example.com',
        password: 'secret',
        to: 'recipient@example.com'
      },
      stateTransitions: {}
    }
  });

  await service.sendNotification('201', 'Trống', 'Có khách', 'Test message');

  assert.equal(calls.email.length, 1);
  assert.equal(calls.email[0].mail.from, 'sender@example.com');
  assert.equal(calls.email[0].mail.to, 'recipient@example.com');
  assert.match(calls.email[0].mail.subject, /201/);
});

test('Telegram queue sends one queued message and waits one second before continuing', async () => {
  const { service, calls } = createNotificationService({
    notifications: {
      telegram: { enabled: true, botToken: 'token', chatId: 'chat' },
      email: { enabled: false },
      stateTransitions: {}
    }
  });

  service.queueTelegram('first');
  service.queueTelegram('second');
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(calls.telegram.length, 1);
  assert.equal(calls.telegram[0][1].text, 'first');
  assert.equal(calls.timers[0].delay, 1000);

  calls.timers[0].callback();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(calls.telegram.length, 2);
  assert.equal(calls.telegram[1][1].text, 'second');
  assert.equal(calls.timers[1].delay, 1000);
});
