import winston from 'winston';
import dotenv from 'dotenv';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../../.env'), quiet: true });

const logToFile = (process.env.LOG_TO_FILE || 'true').toLowerCase();
if (logToFile !== 'true' && logToFile !== 'false') {
  throw new Error('LOG_TO_FILE must be either true or false');
}

const logLevel = process.env.LOG_LEVEL || 'info';
if (winston.config.npm.levels[logLevel] === undefined) {
  throw new Error(`Invalid LOG_LEVEL: ${logLevel}`);
}

const transports = [new winston.transports.Console()];
if (logToFile === 'true') {
  const logDirectory = join(process.cwd(), 'logs');
  mkdirSync(logDirectory, { recursive: true });
  transports.push(
    new winston.transports.File({
      filename: join(logDirectory, 'error.log'),
      level: 'error',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 3
    }),
    new winston.transports.File({
      filename: join(logDirectory, 'combined.log'),
      maxsize: 10 * 1024 * 1024,
      maxFiles: 3
    })
  );
}

const logger = winston.createLogger({
  level: logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level.toUpperCase()}]: ${message}`;
    })
  ),
  transports
});

export default logger;