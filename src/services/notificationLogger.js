import { appendFileSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class NotificationLogger {
  constructor() {
    this.notificationsFile = join(__dirname, '../../data/notifications.csv');
    this.ensureDataDir();
    this.initCSVHeader();
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
   * Save notification to CSV
   */
  saveNotification(notification) {
    try {
      const { id, room, message, stateName, timestamp, read } = notification;
      
      // Escape quotes in message
      const escapedMessage = (message || '').replace(/"/g, '""');
      const escapedStatus = (stateName || '').replace(/"/g, '""');
      
      const row = `${id},"${room}","${escapedMessage}","${escapedStatus}","${timestamp}",${read ? 1 : 0}\n`;
      
      appendFileSync(this.notificationsFile, row);
      logger.debug(`Notification saved: Room ${room}`);
    } catch (error) {
      logger.error(`Failed to save notification: ${error.message}`);
    }
  }

  /**
   * Load all notifications from CSV
   */
  loadNotifications() {
    try {
      if (!existsSync(this.notificationsFile)) {
        return [];
      }

      const data = readFileSync(this.notificationsFile, 'utf8');
      const lines = data.trim().split('\n');
      
      // Skip header
      const notifications = lines.slice(1).map(line => {
        const match = line.match(/^(.+?),"(.+?)","(.+?)","(.+?)","(.+?)",(\d)/);
        if (!match) return null;
        
        return {
          id: match[1],
          room: match[2],
          message: match[3],
          stateName: match[4],
          timestamp: match[5],
          read: match[6] === '1'
        };
      }).filter(notif => notif !== null);

      return notifications;
    } catch (error) {
      logger.error(`Failed to load notifications: ${error.message}`);
      return [];
    }
  }

  /**
   * Update notification read status in CSV
   */
  updateNotificationReadStatus(notificationId, read) {
    try {
      const notifications = this.loadNotifications();
      const updated = notifications.map(n => 
        n.id === notificationId ? { ...n, read } : n
      );
      
      // Rewrite entire file
      this.rewriteNotifications(updated);
      logger.debug(`Notification ${notificationId} updated`);
    } catch (error) {
      logger.error(`Failed to update notification: ${error.message}`);
    }
  }

  /**
   * Clear all notifications
   */
  clearAllNotifications() {
    try {
      this.initCSVHeader(); // Reset with just header
      logger.debug('All notifications cleared');
    } catch (error) {
      logger.error(`Failed to clear notifications: ${error.message}`);
    }
  }

  /**
   * Rewrite entire notifications file
   */
  rewriteNotifications(notifications) {
    try {
      let content = 'id,room,message,stateName,timestamp,read\n';
      
      notifications.forEach(notif => {
        const escapedMessage = (notif.message || '').replace(/"/g, '""');
        const escapedStatus = (notif.stateName || '').replace(/"/g, '""');
        content += `${notif.id},"${notif.room}","${escapedMessage}","${escapedStatus}","${notif.timestamp}",${notif.read ? 1 : 0}\n`;
      });
      
      writeFileSync(this.notificationsFile, content);
      logger.debug('Notifications file rewritten');
    } catch (error) {
      logger.error(`Failed to rewrite notifications: ${error.message}`);
    }
  }
}

export default new NotificationLogger();
