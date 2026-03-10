import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class HistoryLogger {
  constructor() {
    this.historyFile = join(__dirname, '../../data/state-history.csv');
    this.ensureDataDir();
    this.initCSVHeader();
  }

  ensureDataDir() {
    const dataDir = dirname(this.historyFile);
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
  }

  initCSVHeader() {
    if (!existsSync(this.historyFile)) {
      const header = 'timestamp,room,floor,previous_state,new_state,message\n';
      appendFileSync(this.historyFile, header);
      logger.debug('State history CSV initialized');
    }
  }

  /**
   * Log state change to CSV
   */
  logStateChange(room, floor, previousStateName, newStateName, message) {
    try {
      const timestamp = new Date().toISOString();
      const prevState = previousStateName || 'Unknown';
      const newState = newStateName || 'Unknown';
      
      // Escape commas in message
      const escapedMessage = (message || '').replace(/"/g, '""');
      
      const row = `${timestamp},"${room}","${floor}","${prevState}","${newState}","${escapedMessage}"\n`;
      
      appendFileSync(this.historyFile, row);
      logger.debug(`State history logged: Room ${room} ${prevState} → ${newState}`);
    } catch (error) {
      logger.error(`Failed to log state history: ${error.message}`);
    }
  }

  /**
   * Get history for a room (or all rooms if room is null)
   */
  getHistory(room = null, limit = 100) {
    try {
      if (!existsSync(this.historyFile)) {
        return [];
      }

      const data = readFileSync(this.historyFile, 'utf8');
      const lines = data.trim().split('\n');
      
      // Skip header
      const records = lines.slice(1).map(line => {
        const match = line.match(/^(.+?),"(.+?)","(.+?)","(.+?)","(.+?)","(.*)"/);
        if (!match) return null;
        
        return {
          timestamp: match[1],
          room: match[2],
          floor: match[3],
          previous_state: match[4],
          new_state: match[5],
          message: match[6]
        };
      }).filter(record => record !== null);

      // Filter by room if specified
      let filtered = records;
      if (room) {
        filtered = records.filter(r => r.room === room);
      }

      // Return latest N records
      return filtered.slice(-limit).reverse();
    } catch (error) {
      logger.error(`Failed to read history: ${error.message}`);
      return [];
    }
  }

  /**
   * Get history for a room within a date range
   */
  getHistoryByDateRange(room, startDate, endDate) {
    try {
      const history = this.getHistory(room, 10000); // Get all records first
      
      const start = new Date(startDate);
      const end = new Date(endDate);

      return history.filter(record => {
        const recordDate = new Date(record.timestamp);
        return recordDate >= start && recordDate <= end;
      });
    } catch (error) {
      logger.error(`Failed to filter by date range: ${error.message}`);
      return [];
    }
  }
}

export default new HistoryLogger();
