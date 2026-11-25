import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'hotel-db-migration-'));
const databasePath = join(temporaryDirectory, 'legacy.db');

process.env.SQLITE_DATABASE_PATH = databasePath;
process.env.JWT_SECRET = 'migration-test-secret-with-at-least-32-characters';
process.env.JWT_ISSUER = 'hotel-migration-tests';
process.env.JWT_AUDIENCE = 'hotel-migration-test-client';
process.env.ACCESS_TOKEN_TTL_SECONDS = '900';
process.env.API_KEY = '';
process.env.REFRESH_TOKEN_COOKIE_NAME = 'refresh_token';
process.env.REFRESH_TOKEN_COOKIE_SECURE = 'false';
process.env.INITIAL_ADMIN_USERNAME = 'migration-admin';
process.env.INITIAL_ADMIN_PASSWORD = 'migration-bootstrap-password';
process.env.NODE_ENV = 'test';
process.env.LOG_TO_FILE = 'false';
process.env.LOG_LEVEL = 'error';

const legacyDatabase = new Database(databasePath);
legacyDatabase.exec(`
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    full_name TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  INSERT INTO users (username, password_hash, role)
  VALUES ('legacy-user', 'legacy-plaintext-password', 'user');
`);
legacyDatabase.close();

const { default: db } = await import('./db.js');
const { verifyPassword, hashPassword } = await import('../utils/password.js');
const { bootstrapAdminAccount } = await import('./accountBootstrap.js');

after(() => {
  db.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

test('resets existing accounts once and seeds one bcrypt admin from environment', async () => {
  const columns = db.prepare('PRAGMA table_info(users)').all().map(({ name }) => name);
  assert.ok(columns.includes('status'));
  assert.ok(columns.includes('token_version'));
  assert.ok(columns.includes('updated_at'));

  const users = db.prepare(`
    SELECT username, role, password_hash, status, token_version, updated_at
    FROM users
  `).all();
  assert.equal(users.length, 1);
  assert.equal(users[0].username, 'migration-admin');
  assert.equal(users[0].role, 'admin');
  assert.match(users[0].password_hash, /^\$2[aby]\$/);
  assert.equal(await verifyPassword('migration-bootstrap-password', users[0].password_hash), true);
  assert.equal(users[0].status, 'active');
  assert.equal(users[0].token_version, 0);
  assert.ok(users[0].updated_at);

  db.prepare(`
    INSERT INTO users (username, password_hash, role)
    VALUES (?, ?, 'user')
  `).run('later-user', await hashPassword('later-user-password'));
  assert.equal(await bootstrapAdminAccount(db, {}), false);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM users').get().count, 2);

  const refreshTable = db.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'refresh_tokens'
  `).get();
  assert.ok(refreshTable);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
});
