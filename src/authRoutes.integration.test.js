import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, before } from 'node:test';
import cors from 'cors';
import express from 'express';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'hotel-auth-integration-'));
const frontendOrigin = 'https://frontend.integration.test';
const adminApiKey = 'integration-admin-api-key-for-tests-only';

process.env.SQLITE_DATABASE_PATH = join(temporaryDirectory, 'auth.db');
process.env.JWT_SECRET = 'integration-test-secret-with-at-least-32-characters';
process.env.JWT_ISSUER = 'hotel-auth-integration-tests';
process.env.JWT_AUDIENCE = 'hotel-auth-integration-client';
process.env.ACCESS_TOKEN_TTL_SECONDS = '900';
process.env.REFRESH_TOKEN_COOKIE_NAME = 'refresh_token';
process.env.REFRESH_TOKEN_COOKIE_SECURE = 'true';
process.env.API_KEY = adminApiKey;
process.env.INITIAL_ADMIN_USERNAME = 'integration-bootstrap-admin';
process.env.INITIAL_ADMIN_PASSWORD = 'integration-bootstrap-password';
process.env.NODE_ENV = 'test';
process.env.LOG_TO_FILE = 'false';
process.env.LOG_LEVEL = 'error';

let app;
let server;
let baseUrl;
let db;
let user;
let admin;

before(async () => {
  const { default: database } = await import('./database/db.js');
  db = database;
  const { default: config } = await import('./utils/configLoader.js');
  config.app.cors_origins = [frontendOrigin];
  const { default: routes } = await import('./routes/index.js');
  const { errorHandler } = await import('./middleware/errorHandler.js');
  const { corsOrigin } = await import('./middleware/corsPolicy.js');
  const { hashPassword } = await import('./utils/password.js');

  const passwordHash = await hashPassword('integration-password');
  const userResult = db.prepare(`
    INSERT INTO users (username, password_hash, role)
    VALUES (?, ?, 'user')
  `).run('integration-user', passwordHash);
  const adminResult = db.prepare(`
    INSERT INTO users (username, password_hash, role)
    VALUES (?, ?, 'admin')
  `).run('integration-admin', passwordHash);
  user = { id: Number(userResult.lastInsertRowid), username: 'integration-user' };
  admin = { id: Number(adminResult.lastInsertRowid), username: 'integration-admin' };

  app = express();
  app.set('trust proxy', 1);
  app.use(cors({
    origin: corsOrigin,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-CSRF-Protection'],
    credentials: true
  }));
  app.use(express.json({ limit: '10kb' }));
  app.get('/api/status', (req, res) => res.status(200).json({ status: 'ok' }));
  app.use(routes);
  app.use(errorHandler);

  server = createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server?.listening) {
    await new Promise((resolve) => server.close(resolve));
  }
  db?.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

function refreshCookie(response) {
  const setCookie = response.headers.get('set-cookie');
  assert.ok(setCookie, 'expected a refresh-token cookie');
  return setCookie.split(';', 1)[0];
}

function tokenHash(cookie) {
  const rawToken = cookie.slice(cookie.indexOf('=') + 1);
  return createHash('sha256').update(rawToken).digest('hex');
}

async function request(path, {
  method = 'GET',
  token,
  cookie,
  apiKey,
  origin = frontendOrigin,
  csrf = false,
  body
} = {}) {
  const headers = {};
  if (origin) headers.Origin = origin;
  if (token) headers.Authorization = `Bearer ${token}`;
  if (cookie) headers.Cookie = cookie;
  if (apiKey) headers['X-API-Key'] = apiKey;
  if (csrf) headers['X-CSRF-Protection'] = '1';
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

async function login(username, password = 'integration-password') {
  const response = await request('/api/auth/login', {
    method: 'POST',
    csrf: true,
    body: { username, password }
  });
  const session = await response.json();
  return { response, session, cookie: response.ok ? refreshCookie(response) : null };
}

test('auth routes enforce cookies, refresh rotation, CSRF, RBAC, logout and brute-force limits', async () => {
  const health = await request('/api/status');
  assert.equal(health.status, 200);

  const allowedPreflight = await fetch(`${baseUrl}/api/status`, {
    method: 'OPTIONS',
    headers: {
      Origin: frontendOrigin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'X-CSRF-Protection'
    }
  });
  assert.equal(allowedPreflight.headers.get('access-control-allow-origin'), frontendOrigin);
  assert.equal(allowedPreflight.headers.get('access-control-allow-credentials'), 'true');

  const deniedPreflight = await fetch(`${baseUrl}/api/status`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://untrusted.integration.test',
      'Access-Control-Request-Method': 'POST'
    }
  });
  assert.equal(deniedPreflight.headers.get('access-control-allow-origin'), null);

  const invalidOrigin = await request('/api/auth/login', {
    method: 'POST',
    origin: 'https://untrusted.integration.test',
    csrf: true,
    body: { username: user.username, password: 'integration-password' }
  });
  assert.equal(invalidOrigin.status, 403);
  const missingCsrf = await request('/api/auth/login', {
    method: 'POST',
    csrf: false,
    body: { username: user.username, password: 'integration-password' }
  });
  assert.equal(missingCsrf.status, 403);

  const sameOriginLoginResponse = await request('/api/auth/login', {
    method: 'POST',
    origin: baseUrl,
    csrf: true,
    body: { username: user.username, password: 'integration-password' }
  });
  assert.equal(sameOriginLoginResponse.status, 200);
  const sameOriginCookie = refreshCookie(sameOriginLoginResponse);
  assert.equal((await request('/api/auth/logout', {
    method: 'POST',
    origin: baseUrl,
    cookie: sameOriginCookie,
    csrf: true
  })).status, 200);

  const userLogin = await login(user.username);
  assert.equal(userLogin.response.status, 200);
  assert.equal(userLogin.session.user.role, 'user');
  assert.equal(Object.hasOwn(userLogin.session, 'refreshToken'), false);
  assert.match(userLogin.response.headers.get('set-cookie'), /HttpOnly/i);
  assert.match(userLogin.response.headers.get('set-cookie'), /Secure/i);
  assert.match(userLogin.response.headers.get('set-cookie'), /SameSite=Strict/i);
  assert.match(userLogin.response.headers.get('set-cookie'), /Path=\/api\/auth/i);

  const userMe = await request('/api/auth/me', { token: userLogin.session.accessToken });
  assert.equal(userMe.status, 200);
  assert.equal((await userMe.json()).user.id, user.id);
  assert.equal(
    (await request('/api/config/rooms', { token: userLogin.session.accessToken })).status,
    403
  );
  assert.equal(
    (await request(`/api/users/${admin.id}`, {
      method: 'PUT',
      token: userLogin.session.accessToken,
      body: { username: admin.username, role: 'admin' }
    })).status,
    403
  );
  assert.equal(
    (await request('/api/relay/main/set', {
      method: 'POST',
      token: userLogin.session.accessToken,
      body: [{ room: '201', set: 'on' }]
    })).status,
    403
  );
  assert.equal(
    (await request('/api/monitor/update-room', {
      method: 'POST',
      token: userLogin.session.accessToken,
      body: { room: '201' }
    })).status,
    403
  );
  assert.equal(
    (await request('/api/notifications/clear-all', {
      method: 'POST',
      token: userLogin.session.accessToken
    })).status,
    403
  );
  assert.equal((await request('/api/notifications/update-read', {
    method: 'POST',
    token: userLogin.session.accessToken,
    body: { id: 'nonexistent-notification', read: true }
  })).status, 200);

  const originalCookie = userLogin.cookie;
  const originalHash = tokenHash(originalCookie);
  const oldRefreshRecord = db.prepare(
    'SELECT id, revoked_at, replaced_by_token_id FROM refresh_tokens WHERE token_hash = ?'
  ).get(originalHash);
  assert.ok(oldRefreshRecord);

  const refreshResponse = await request('/api/auth/refresh', {
    method: 'POST',
    cookie: originalCookie,
    csrf: true
  });
  assert.equal(refreshResponse.status, 200);
  const rotatedSession = await refreshResponse.json();
  const rotatedCookie = refreshCookie(refreshResponse);
  assert.notEqual(rotatedCookie, originalCookie);
  const rotatedRecord = db.prepare(
    'SELECT id, revoked_at FROM refresh_tokens WHERE token_hash = ?'
  ).get(tokenHash(rotatedCookie));
  assert.ok(rotatedRecord);
  assert.ok(db.prepare(
    'SELECT revoked_at, replaced_by_token_id FROM refresh_tokens WHERE id = ?'
  ).get(oldRefreshRecord.id).revoked_at);
  assert.equal(
    db.prepare('SELECT replaced_by_token_id FROM refresh_tokens WHERE id = ?')
      .get(oldRefreshRecord.id).replaced_by_token_id,
    rotatedRecord.id
  );

  const reuseResponse = await request('/api/auth/refresh', {
    method: 'POST',
    cookie: originalCookie,
    csrf: true
  });
  assert.equal(reuseResponse.status, 401);
  const remainingFamilyTokens = db.prepare(`
    SELECT revoked_at FROM refresh_tokens WHERE family_id = (
      SELECT family_id FROM refresh_tokens WHERE id = ?
    )
  `).all(oldRefreshRecord.id);
  assert.ok(remainingFamilyTokens.length >= 2);
  assert.ok(remainingFamilyTokens.every(({ revoked_at }) => revoked_at !== null));
  assert.equal((await request('/api/auth/me', { token: rotatedSession.accessToken })).status, 200);

  const logoutLogin = await login(user.username);
  assert.equal(logoutLogin.response.status, 200);
  const logoutCookie = logoutLogin.cookie;
  const logoutResponse = await request('/api/auth/logout', {
    method: 'POST',
    cookie: logoutCookie,
    csrf: true
  });
  assert.equal(logoutResponse.status, 200);
  assert.match(logoutResponse.headers.get('set-cookie'), /Max-Age=0/i);
  assert.ok(db.prepare('SELECT revoked_at FROM refresh_tokens WHERE token_hash = ?')
    .get(tokenHash(logoutCookie)).revoked_at);

  const adminLogin = await login(admin.username);
  assert.equal(adminLogin.response.status, 200);
  assert.equal(
    (await request('/api/users', { token: adminLogin.session.accessToken })).status,
    200
  );
  assert.equal(
    (await request('/api/monitor/update-room', {
      method: 'POST',
      apiKey: adminApiKey,
      body: {}
    })).status,
    400
  );
  assert.equal(
    (await request('/api/users', { apiKey: adminApiKey })).status,
    403
  );

  const logoutAllLogin = await login(admin.username);
  const logoutAllResponse = await request('/api/auth/logout-all', {
    method: 'POST',
    token: logoutAllLogin.session.accessToken,
    cookie: logoutAllLogin.cookie,
    csrf: true
  });
  assert.equal(logoutAllResponse.status, 200);
  assert.equal(
    (await request('/api/auth/me', { token: logoutAllLogin.session.accessToken })).status,
    401
  );
  assert.equal(
    (await request('/api/auth/refresh', {
      method: 'POST',
      cookie: logoutAllLogin.cookie,
      csrf: true
    })).status,
    401
  );

  const passwordLogin = await login(user.username);
  const passwordChange = await request('/api/auth/change-password', {
    method: 'POST',
    token: passwordLogin.session.accessToken,
    cookie: passwordLogin.cookie,
    csrf: true,
    body: { currentPassword: 'integration-password', newPassword: 'new-integration-password' }
  });
  assert.equal(passwordChange.status, 200);
  assert.equal(
    (await request('/api/auth/me', { token: passwordLogin.session.accessToken })).status,
    401
  );
  assert.equal((await login(user.username, 'integration-password')).response.status, 401);
  assert.equal((await login(user.username, 'new-integration-password')).response.status, 200);

  let rateLimited = false;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const failedLogin = await login('missing-integration-user', 'invalid-password');
    if (failedLogin.response.status === 429) {
      rateLimited = true;
      break;
    }
    assert.equal(failedLogin.response.status, 401);
    assert.deepEqual(failedLogin.session, { error: 'Invalid credentials' });
  }
  assert.equal(rateLimited, true);
});
