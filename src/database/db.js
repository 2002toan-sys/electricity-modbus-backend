import Database from 'better-sqlite3';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { seedDatabase } from './seed.js';
import { bootstrapAdminAccount } from './accountBootstrap.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const defaultDatabasePath = join(__dirname, '../../data/hotel.db');
const DB_PATH = process.env.NODE_ENV === 'test' && process.env.SQLITE_DATABASE_PATH
  ? resolve(process.env.SQLITE_DATABASE_PATH)
  : defaultDatabasePath;
const SCHEMA_PATH = join(__dirname, 'schema.sql');

if (!existsSync(dirname(DB_PATH))) {
  mkdirSync(dirname(DB_PATH), { recursive: true });
}

let db = null;

try {
  db = new Database(DB_PATH);
  
  // Tối ưu hiệu năng và an toàn dữ liệu
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL');
  db.pragma('foreign_keys = ON');
  
  // Khởi tạo schema nếu chưa có
  if (existsSync(SCHEMA_PATH)) {
    const schemaSql = readFileSync(SCHEMA_PATH, 'utf8');
    db.exec(schemaSql);
  }

  const userColumns = db.prepare('PRAGMA table_info(users)').all();
  if (!userColumns.some(({ name }) => name === 'status')) {
    db.exec("ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
  }
  if (!userColumns.some(({ name }) => name === 'token_version')) {
    db.exec('ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0');
  }
  if (!userColumns.some(({ name }) => name === 'updated_at')) {
    db.exec("ALTER TABLE users ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''");
    db.exec("UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE updated_at = ''");
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      family_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      revoked_at INTEGER,
      replaced_by_token_id TEXT,
      created_at INTEGER NOT NULL,
      ip TEXT,
      user_agent TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (replaced_by_token_id) REFERENCES refresh_tokens(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family ON refresh_tokens(family_id);
    CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expiry ON refresh_tokens(expires_at);
  `);

  const roomColumns = db.prepare('PRAGMA table_info(rooms)').all();
  if (!roomColumns.some(({ name }) => name === 'show_in_ui')) {
    db.exec('ALTER TABLE rooms ADD COLUMN show_in_ui INTEGER NOT NULL DEFAULT 1');
  }
  
  // Tự động seed dữ liệu ban đầu
  await seedDatabase(db);
  db.prepare("DELETE FROM api_keys WHERE key = 'your-secret-api-key-here'").run();
  await bootstrapAdminAccount(db, process.env);
  
  logger.info(`SQLite Database connected at ${DB_PATH} (WAL mode enabled)`);
} catch (error) {
  if (db?.open) db.close();
  logger.error(`Failed to initialize SQLite Database: ${error.message}`);
  throw error;
}

export default db;
