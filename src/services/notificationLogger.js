import { writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';
import db from '../database/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class NotificationLogger {
  constructor() {
    this.notificationsFile = join(__dirname, '../../data/notifications.csv');
    this.ensureDataDir();
    this.initCSVHeader();
    this._initPreparedStatements();
  }

  _initPreparedStatements() {
    try {
      this.insertStmt = db.prepare(`
        INSERT OR REPLACE INTO notifications (id, room_number, message, state_name, timestamp, is_read)
        VALUES (@id, @room_number, @message, @state_name, @timestamp, @is_read)
      `);

      this.selectAllStmt = db.prepare(`
        SELECT id, room_number, message, state_name, timestamp, is_read
        FROM notifications
        ORDER BY timestamp DESC
        LIMIT ?
      `);

      this.updateReadStmt = db.prepare(`
        UPDATE notifications
        SET is_read = ?
        WHERE id = ?
      `);

      this.deleteAllStmt = db.prepare(`
        DELETE FROM notifications
      `);
    } catch (err) {
      logger.error(`NotificationLogger prepared statements error: ${err.message}`);
    }
  }

  ensureDataDir() {
    const dataDir = dirname(this.notificationsFile);
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
  }

  initCSVHeader() {
    if (!existsSync(this.notificationsFile)) {
      const header = 'id,room,message,stateName,timestamp,read\n';
      writeFileSync(this.notificationsFile, header);
      logger.debug('Notifications CSV initialized');
    }
  }

  /**
   * Save notification to SQLite (and CSV fallback)
   */
  saveNotification(notification) {
    try {
      const { id, room, message, stateName, timestamp, read } = notification;
      const notifId = id ? id.toString() : Date.now().toString();
      const time = timestamp || new Date().toISOString();
      const isRead = read ? 1 : 0;
      const roomStr = (room || '').toString();

      // 1. Lưu vào SQLite
      this.insertStmt.run({
        id: notifId,
        room_number: roomStr,
        message: message || '',
        state_name: stateName || '',
        timestamp: time,
        is_read: isRead
      });

      // 2. Lưu vào file CSV (fallback)
      try {
        const escapedMessage = (message || '').replace(/"/g, '""');
        const escapedStatus = (stateName || '').replace(/"/g, '""');
        const row = `${notifId},"${roomStr}","${escapedMessage}","${escapedStatus}","${time}",${isRead}\n`;
        appendFileSync(this.notificationsFile, row);
      } catch { /* ignore csv error */ }

      logger.debug(`Notification saved to SQLite: Room ${room}`);
      return { id: notifId, room: roomStr, message, stateName, timestamp: time, read: Boolean(isRead) };
    } catch (error) {
      logger.error(`Failed to save notification: ${error.message}`);
      return null;
    }
  }

  /**
   * Load notifications from SQLite
   */
  loadNotifications(limit = 100) {
    try {
      const rows = this.selectAllStmt.all(limit);
      return rows.map(r => ({
        id: r.id,
        room: r.room_number,
        message: r.message,
        stateName: r.state_name,
        timestamp: r.timestamp,
        read: Boolean(r.is_read)
      }));
    } catch (error) {
      logger.error(`Failed to load notifications from SQLite: ${error.message}`);
      return [];
    }
  }

  /**
   * Update notification read status in SQLite
   */
  updateNotificationReadStatus(notificationId, read) {
    try {
      this.updateReadStmt.run(read ? 1 : 0, notificationId.toString());
      logger.debug(`Notification ${notificationId} updated in SQLite (read: ${read})`);
      return true;
    } catch (error) {
      logger.error(`Failed to update notification in SQLite: ${error.message}`);
      return false;
    }
  }

  /**
   * Clear all notifications in SQLite and CSV
   */
  clearAllNotifications() {
    try {
      this.deleteAllStmt.run();
      
      // Reset CSV file
      const header = 'id,room,message,stateName,timestamp,read\n';
      writeFileSync(this.notificationsFile, header);

      logger.info('All notifications cleared from SQLite & CSV');
      return true;
    } catch (error) {
      logger.error(`Failed to clear notifications: ${error.message}`);
      return false;
    }
  }
}

export default new NotificationLogger();
