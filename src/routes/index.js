import express from 'express';
import { setMainRelay, setSubRelay, getMainRelayStatus } from '../controllers/relayController.js';
import { getRoomStates, getPlcStatus, getStateHistory, updateRoomFromApi } from '../controllers/monitorController.js';
import { login, verifyToken, logout } from '../controllers/authController.js';
import { getNotifications, saveNotification, updateNotificationReadStatus, clearAllNotifications } from '../controllers/notificationController.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

// Auth endpoints (public)
router.post('/api/auth/login', login);
router.get('/api/auth/verify', authenticate, verifyToken);
router.post('/api/auth/logout', authenticate, logout);

// Relay control endpoints
// Relay control endpoints (authenticate accepts API Key or session)
router.get('/api/relay/main/get', authenticate, getMainRelayStatus);
router.post('/api/relay/main/set', authenticate, setMainRelay);
router.post('/api/relay/sub/set', authenticate, setSubRelay);


// Monitor endpoints
router.get('/api/monitor/rooms', authenticate, getRoomStates);
router.get('/api/monitor/plc-status', authenticate, getPlcStatus);
router.get('/api/monitor/history', authenticate, getStateHistory);
router.post('/api/monitor/update-room', authenticate, updateRoomFromApi);

// Notification endpoints
router.get('/api/notifications', authenticate, getNotifications);
router.post('/api/notifications/save', authenticate, saveNotification);
router.post('/api/notifications/update-read', authenticate, updateNotificationReadStatus);
router.post('/api/notifications/clear-all', authenticate, clearAllNotifications);

export default router;