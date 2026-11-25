import express from 'express';
import { setMainRelay, setSubRelay, getMainRelayStatus } from '../controllers/relayController.js';
import { getRoomStates, getPlcStatus, getStateHistory, updateRoomFromApi } from '../controllers/monitorController.js';
import {
  changePassword,
  login,
  logout,
  logoutAll,
  refresh,
  verifyToken
} from '../controllers/authController.js';
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
import {
  authenticate,
  authenticateOptional,
  requireAdmin,
  requireJwt,
  requirePermission
} from '../middleware/auth.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { requireCsrf } from '../middleware/csrf.js';

const router = express.Router();

// Auth endpoints (public)
router.post('/api/auth/login', requireCsrf, authLimiter, login);
router.post('/api/auth/refresh', requireCsrf, refresh);
router.post('/api/auth/logout', requireCsrf, authenticateOptional, logout);

// All remaining API endpoints require authentication unless explicitly marked public.
router.use('/api', authenticate);

router.post('/api/auth/logout-all', requireCsrf, requireJwt, logoutAll);
router.get('/api/auth/me', requireJwt, verifyToken);
router.get('/api/auth/verify', requireJwt, verifyToken);
router.post('/api/auth/change-password', requireCsrf, requireJwt, changePassword);

router.get('/api/relay/main/get', requirePermission('relay:read'), getMainRelayStatus);
router.post('/api/relay/main/set', requirePermission('relay:main:control'), setMainRelay);
router.post('/api/relay/sub/set', requirePermission('relay:sub:control'), setSubRelay);

router.get('/api/monitor/rooms', requirePermission('monitor:read'), getRoomStates);
router.get('/api/monitor/plc-status', requirePermission('monitor:read'), getPlcStatus);
router.get('/api/monitor/history', requirePermission('monitor:read'), getStateHistory);
router.post('/api/monitor/update-room', requirePermission('room:state:update'), updateRoomFromApi);

// Room configuration endpoints (admin only)
router.get('/api/config/rooms', requireAdmin, getRoomsConfig);
router.post('/api/config/rooms', requireAdmin, createRoom);
router.put('/api/config/rooms/:room', requireAdmin, updateRoom);
router.delete('/api/config/rooms/:room', requireAdmin, deleteRoom);
router.get('/api/config/plcs', requireAdmin, getPlcsConfig);
router.post('/api/config/plcs', requireAdmin, createPlc);
router.put('/api/config/plcs', requireAdmin, updatePlc);
router.put('/api/config/plcs/:floor', requireAdmin, updatePlc);
router.delete('/api/config/plcs/:floor', requireAdmin, deletePlc);
router.get('/api/config/settings', requireAdmin, getSystemSettings);
router.put('/api/config/settings', requireAdmin, updateSystemSettings);
router.post('/api/config/test-telegram', requireAdmin, testTelegram);
router.get('/api/users', requireAdmin, getUsers);
router.post('/api/users', requireAdmin, createUser);
router.put('/api/users/:id', requireAdmin, updateUser);
router.delete('/api/users/:id', requireAdmin, deleteUser);

router.get('/api/notifications', requirePermission('notifications:read'), getNotifications);
router.post('/api/notifications/save', requirePermission('notifications:write'), saveNotification);
router.post('/api/notifications/update-read', requirePermission('notifications:mark'), updateNotificationReadStatus);
router.post('/api/notifications/clear-all', requirePermission('notifications:clear'), clearAllNotifications);

export default router;