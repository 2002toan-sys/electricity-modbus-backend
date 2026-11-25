import { hashPassword } from '../utils/password.js';

const ACCOUNT_RESET_MIGRATION = 'reset-users-to-single-admin-v1';
const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,32}$/;

export async function bootstrapAdminAccount(db, env) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      migration_id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const migrationApplied = () => db.prepare(
    'SELECT 1 FROM schema_migrations WHERE migration_id = ?'
  ).get(ACCOUNT_RESET_MIGRATION);
  if (migrationApplied()) return false;

  const username = env.INITIAL_ADMIN_USERNAME?.trim();
  const password = env.INITIAL_ADMIN_PASSWORD;
  if (!username || !USERNAME_PATTERN.test(username)) {
    throw new Error('INITIAL_ADMIN_USERNAME must be 3-32 valid username characters.');
  }
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
    throw new Error('INITIAL_ADMIN_PASSWORD must be between 12 and 128 characters.');
  }

  const passwordHash = await hashPassword(password);
  const resetAccounts = db.transaction(() => {
    if (migrationApplied()) return false;

    db.prepare('DELETE FROM users').run();
    db.prepare(`
      INSERT INTO users (username, password_hash, role, full_name, updated_at)
      VALUES (?, ?, 'admin', 'Quản trị viên', CURRENT_TIMESTAMP)
    `).run(username, passwordHash);
    db.prepare('INSERT INTO schema_migrations (migration_id) VALUES (?)')
      .run(ACCOUNT_RESET_MIGRATION);
    return true;
  });

  return resetAccounts();
}
