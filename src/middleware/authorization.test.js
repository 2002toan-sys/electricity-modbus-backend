import assert from 'node:assert/strict';
import test from 'node:test';
import { requireAdmin, requirePermission } from './authorization.js';

function runMiddleware(middleware, user, authType) {
  let nextCalled = false;
  const response = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };

  middleware({ user, authType }, response, () => {
    nextCalled = true;
  });
  return { nextCalled, ...response };
}

test('grants users only their assigned read, notification-mark, and sub-relay permissions', () => {
  const user = { role: 'user' };
  for (const permission of ['monitor:read', 'relay:read', 'relay:sub:control', 'notifications:mark']) {
    assert.equal(runMiddleware(requirePermission(permission), user, 'jwt').nextCalled, true);
  }

  for (const permission of ['relay:main:control', 'config:manage', 'room:state:update', 'notifications:clear']) {
    const result = runMiddleware(requirePermission(permission), user, 'jwt');
    assert.equal(result.nextCalled, false);
    assert.equal(result.statusCode, 403);
  }
});

test('allows configured admin API keys to perform admin permissions', () => {
  const result = runMiddleware(
    requirePermission('room:state:update'),
    { role: 'admin' },
    'api-key'
  );
  assert.equal(result.nextCalled, true);
});

test('requires a JWT admin for account and configuration management', () => {
  assert.equal(
    runMiddleware(requireAdmin, { role: 'admin' }, 'jwt').nextCalled,
    true
  );
  assert.equal(
    runMiddleware(requireAdmin, { role: 'admin' }, 'api-key').statusCode,
    403
  );
  assert.equal(
    runMiddleware(requireAdmin, { role: 'user' }, 'jwt').statusCode,
    403
  );
});

test('returns 401 when a permission check is reached without authentication', () => {
  const result = runMiddleware(requirePermission('monitor:read'), undefined, undefined);
  assert.equal(result.nextCalled, false);
  assert.equal(result.statusCode, 401);
});
