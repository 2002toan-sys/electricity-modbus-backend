import Database from 'better-sqlite3';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import { seedDatabase } from './seed.js';

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
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  
  // Khởi tạo schema nếu chưa có
  if (existsSync(SCHEMA_PATH)) {
    const schemaSql = readFileSync(SCHEMA_PATH, 'utf8');
    db.exec(schemaSql);
  }
  
  // Tự động seed dữ liệu ban đầu
  seedDatabase(db);
  
  logger.info(`SQLite Database connected at ${DB_PATH} (WAL mode enabled)`);
} catch (error) {
  logger.error(`Failed to initialize SQLite Database: ${error.message}`);
  throw error;
}

export default db;
