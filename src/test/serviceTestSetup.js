import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function setupServiceTestDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'hotel-service-test-'));
  process.env.SQLITE_DATABASE_PATH = join(directory, 'service.db');
  process.env.JWT_SECRET = 'service-tests-only-secret-with-at-least-32-characters';
  process.env.JWT_ISSUER = 'hotel-service-tests';
  process.env.JWT_AUDIENCE = 'hotel-service-test-client';
  process.env.ACCESS_TOKEN_TTL_SECONDS = '900';
  process.env.REFRESH_TOKEN_COOKIE_NAME = 'refresh_token';
  process.env.REFRESH_TOKEN_COOKIE_SECURE = 'false';
  process.env.INITIAL_ADMIN_USERNAME = 'service-test-admin';
  process.env.INITIAL_ADMIN_PASSWORD = 'service-test-admin-password';
  process.env.NODE_ENV = 'test';
  process.env.API_KEY = '';
  process.env.LOG_TO_FILE = 'false';
  process.env.LOG_LEVEL = 'error';

  const { default: db } = await import('../database/db.js');
  return () => {
    if (db.open) db.close();
    rmSync(directory, { recursive: true, force: true });
  };
}
