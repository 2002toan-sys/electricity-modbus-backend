import Database from 'better-sqlite3';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { seedDatabase } from './seed.js';
import { hashPassword, isPasswordHashed } from '../utils/password.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_DIR = join(__dirname, '../../data');
const DB_PATH = join(DATA_DIR, 'hotel.db');
const SCHEMA_PATH = join(__dirname, 'schema.sql');

if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
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

  const roomColumns = db.prepare('PRAGMA table_info(rooms)').all();
  if (!roomColumns.some(({ name }) => name === 'show_in_ui')) {
    db.exec('ALTER TABLE rooms ADD COLUMN show_in_ui INTEGER NOT NULL DEFAULT 1');
  }
  
  // Tự động seed dữ liệu ban đầu
  seedDatabase(db);
  db.prepare("DELETE FROM api_keys WHERE key = 'your-secret-api-key-here'").run();

  const legacyUsers = db.prepare('SELECT id, password_hash FROM users').all();
  const updatePassword = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');
  const migratePasswords = db.transaction(() => {
    for (const user of legacyUsers) {
      if (!isPasswordHashed(user.password_hash)) {
        updatePassword.run(hashPassword(user.password_hash), user.id);
      }
    }
  });
  migratePasswords();
  
  logger.info(`SQLite Database connected at ${DB_PATH} (WAL mode enabled)`);
} catch (error) {
  logger.error(`Failed to initialize SQLite Database: ${error.message}`);
  throw error;
}

export default db;
