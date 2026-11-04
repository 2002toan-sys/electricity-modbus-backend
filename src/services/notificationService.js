import axios from 'axios';
import nodemailer from 'nodemailer';
import logger from '../utils/logger.js';
import config from '../utils/configLoader.js';
import notificationLogger from './notificationLogger.js';
import NotificationService from './notificationServiceCore.js';

const getStateManager = async () => (await import('./stateManager.js')).default;

export default new NotificationService({
  axios,
  nodemailer,
  logger,
  config,
  notificationLogger,
  getStateManager
});
