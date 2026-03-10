import notificationLogger from '../services/notificationLogger.js';
import logger from '../utils/logger.js';

export const getNotifications = async (req, res) => {
  try {
    const notifications = notificationLogger.loadNotifications();
    
    // Convert string values to appropriate types
    const formatted = notifications.map(n => ({
      id: n.id,
      room: parseInt(n.room),
      message: n.message,
      stateName: n.stateName,
      timestamp: n.timestamp,
      read: n.read
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
    
    if (!id || !room) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const notification = {
      id,
      room,
      message,
      stateName,
      timestamp,
      read: read || false
    };
    
    notificationLogger.saveNotification(notification);
    res.json({ success: true, notification });
  } catch (error) {
    logger.error(`Error saving notification: ${error.message}`);
    res.status(500).json({ error: 'Failed to save notification' });
  }
};

export const updateNotificationReadStatus = async (req, res) => {
  try {
    const { id, read } = req.body;
    
    if (!id || typeof read !== 'boolean') {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    notificationLogger.updateNotificationReadStatus(id, read);
    res.json({ success: true });
  } catch (error) {
    logger.error(`Error updating notification: ${error.message}`);
    res.status(500).json({ error: 'Failed to update notification' });
  }
};

export const clearAllNotifications = async (req, res) => {
  try {
    notificationLogger.clearAllNotifications();
    res.json({ success: true });
  } catch (error) {
    logger.error(`Error clearing notifications: ${error.message}`);
    res.status(500).json({ error: 'Failed to clear notifications' });
  }
};
