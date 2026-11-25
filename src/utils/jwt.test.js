import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'unit-test-secret-that-is-long-enough-for-zod';
process.env.JWT_ISSUER = 'hotel-modbus-test';
process.env.JWT_AUDIENCE = 'hotel-modbus-test-client';
process.env.ACCESS_TOKEN_TTL_SECONDS = '900';

const { createAccessToken, verifyAccessToken } = await import('./jwt.js');

const user = {
  id: 7,
  username: 'test-user',
  role: 'user',
  token_version: 3
};

test('access tokens contain the required claims and verify', () => {
  const token = createAccessToken(user, 'test-jti');
  const claims = verifyAccessToken(token);

  assert.equal(claims.sub, '7');
  assert.equal(claims.userId, 7);
  assert.equal(claims.username, 'test-user');
  assert.equal(claims.role, 'user');
  assert.equal(claims.tv, 3);
  assert.equal(claims.jti, 'test-jti');
  assert.ok(Number.isInteger(claims.iat));
  assert.ok(Number.isInteger(claims.exp));
});

test('expired, tampered, and non-HS256 tokens are rejected', () => {
  const token = createAccessToken(user, 'test-jti', Date.now() - 901_000);
  const tampered = `${createAccessToken(user, 'test-jti')}.tampered`;
  const unsigned = jwt.sign({
    userId: user.id,
    username: user.username,
    role: user.role,
    tv: user.token_version,
    jti: 'unsigned',
    iss: process.env.JWT_ISSUER,
    aud: process.env.JWT_AUDIENCE,
    sub: String(user.id)
  }, null, { algorithm: 'none', expiresIn: 60 });

  assert.equal(verifyAccessToken(token), null);
  assert.equal(verifyAccessToken(tampered), null);
  assert.equal(verifyAccessToken(unsigned), null);
});

test('tokens signed for a different issuer or audience are rejected', () => {
  const baseClaims = {
    userId: user.id,
    username: user.username,
    role: user.role,
    tv: user.token_version,
    jti: 'wrong-scope',
    sub: String(user.id)
  };
  const wrongIssuer = jwt.sign(baseClaims, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    issuer: 'other-issuer',
    audience: process.env.JWT_AUDIENCE,
    expiresIn: 60
  });
  const wrongAudience = jwt.sign(baseClaims, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    issuer: process.env.JWT_ISSUER,
    audience: 'other-audience',
    expiresIn: 60
  });

  assert.equal(verifyAccessToken(wrongIssuer), null);
  assert.equal(verifyAccessToken(wrongAudience), null);
});
