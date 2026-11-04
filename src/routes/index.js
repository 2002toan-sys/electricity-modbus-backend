import express from 'express';
import { setMainRelay, setSubRelay, getMainRelayStatus } from '../controllers/relayController.js';
import { getRoomStates, getPlcStatus, getStateHistory, updateRoomFromApi } from '../controllers/monitorController.js';
import { changePassword, login, recordActivity, verifyToken, logout } from '../controllers/authController.js';
import { createUser, deleteUser, getUsers, updateUser } from '../controllers/userController.js';
import { getNotifications, saveNotification, updateNotificationReadStatus, clearAllNotifications } from '../controllers/notificationController.js';
import {
  createRoom,
  deleteRoom,
  createPlc,
  deletePlc,
  getPlcsConfig,
  getRoomsConfig,
  getSystemSettings,
  testTelegram,
  updatePlc,
  updateRoom,
  updateSystemSettings
} from '../controllers/configController.js';
import { authenticate, requireAdmin, requireJwt } from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimit.js';

const router = express.Router();

// Auth endpoints (public)
router.post('/api/auth/login', authLimiter, login);
router.get('/api/auth/verify', authenticate, requireJwt, verifyToken);
router.post('/api/auth/activity', authenticate, requireJwt, recordActivity);
router.post('/api/auth/logout', authenticate, requireJwt, logout);
router.post('/api/auth/change-password', authenticate, requireJwt, changePassword);

// Relay control endpoints
// Relay control endpoints (authenticate accepts a JWT or API key)
router.get('/api/relay/main/get', authenticate, getMainRelayStatus);
router.post('/api/relay/main/set', authenticate, setMainRelay);
router.post('/api/relay/sub/set', authenticate, setSubRelay);


// Monitor endpoints
router.get('/api/monitor/rooms', authenticate, getRoomStates);
router.get('/api/monitor/plc-status', authenticate, getPlcStatus);
router.get('/api/monitor/history', authenticate, getStateHistory);
router.post('/api/monitor/update-room', authenticate, updateRoomFromApi);

// Room configuration endpoints (admin only)
router.get('/api/config/rooms', authenticate, requireAdmin, getRoomsConfig);
router.post('/api/config/rooms', authenticate, requireAdmin, createRoom);
router.put('/api/config/rooms/:room', authenticate, requireAdmin, updateRoom);
router.delete('/api/config/rooms/:room', authenticate, requireAdmin, deleteRoom);
router.get('/api/config/plcs', authenticate, requireAdmin, getPlcsConfig);
router.post('/api/config/plcs', authenticate, requireAdmin, createPlc);
router.put('/api/config/plcs', authenticate, requireAdmin, updatePlc);
router.put('/api/config/plcs/:floor', authenticate, requireAdmin, updatePlc);
router.delete('/api/config/plcs/:floor', authenticate, requireAdmin, deletePlc);
router.get('/api/config/settings', authenticate, requireAdmin, getSystemSettings);
router.put('/api/config/settings', authenticate, requireAdmin, updateSystemSettings);
router.post('/api/config/test-telegram', authenticate, requireAdmin, testTelegram);
router.get('/api/users', authenticate, requireAdmin, getUsers);
router.post('/api/users', authenticate, requireAdmin, createUser);
router.put('/api/users/:id', authenticate, requireAdmin, updateUser);
router.delete('/api/users/:id', authenticate, requireAdmin, deleteUser);

// Notification endpoints
router.get('/api/notifications', authenticate, getNotifications);
router.post('/api/notifications/save', authenticate, saveNotification);
router.post('/api/notifications/update-read', authenticate, updateNotificationReadStatus);
router.post('/api/notifications/clear-all', authenticate, clearAllNotifications);

export default router;