import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from './password.js';

test('bcrypt password hashes verify without exposing plaintext', async () => {
  const hash = await hashPassword('correct horse battery staple');

  assert.notEqual(hash, 'correct horse battery staple');
  assert.equal(await verifyPassword('correct horse battery staple', hash), true);
  assert.equal(await verifyPassword('wrong password', hash), false);
});

test('rejects unsupported legacy and malformed password hashes', async () => {
  assert.equal(await verifyPassword('password', 'old-format$salt$hash'), false);
  assert.equal(await verifyPassword('password', 'not-a-bcrypt-hash'), false);
});
