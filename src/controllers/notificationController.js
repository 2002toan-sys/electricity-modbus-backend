import notificationLogger from '../services/notificationLogger.js';
import logger from '../utils/logger.js';

export const getNotifications = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const notifications = notificationLogger.loadNotifications(limit);
    
    // Convert room to integer if possible for frontend consistency
    const formatted = notifications.map(n => ({
      id: n.id,
      room: parseInt(n.room) || n.room,
      message: n.message,
      stateName: n.stateName,
      timestamp: n.timestamp,
      read: Boolean(n.read)
    }));
    
    res.json(formatted);
  } catch (error) {
    logger.error(`Error getting notifications: ${error.message}`);
    res.status(500).json({ error: 'Failed to load notifications' });
  }
};

export const saveNotification = async (req, res) => {
  try {
    const { id, room, message, stateName, timestamp, read } = req.body;
    
    if (!room) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const notification = {
      id: id || Date.now().toString(),
      room,
      message,
      stateName,
      timestamp: timestamp || new Date().toISOString(),
      read: Boolean(read)
    };
    
    const saved = notificationLogger.saveNotification(notification);
    res.json({ success: true, notification: saved });
  } catch (error) {
    logger.error(`Error saving notification: ${error.message}`);
    res.status(500).json({ error: 'Failed to save notification' });
  }
};

export const updateNotificationReadStatus = async (req, res) => {
  try {
    const { id, read } = req.body;
    
    if (!id || typeof read !== 'boolean') {
      return res.status(400).json({ error: 'Missing required fields (id, read)' });
    }
    
    const success = notificationLogger.updateNotificationReadStatus(id, read);
    res.json({ success });
  } catch (error) {
    logger.error(`Error updating notification: ${error.message}`);
    res.status(500).json({ error: 'Failed to update notification' });
  }
};

export const clearAllNotifications = async (req, res) => {
  try {
    const success = notificationLogger.clearAllNotifications();
    res.json({ success });
  } catch (error) {
    logger.error(`Error clearing notifications: ${error.message}`);
    res.status(500).json({ error: 'Failed to clear notifications' });
  }
};
