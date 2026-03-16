import axios from 'axios';
import nodemailer from 'nodemailer';
import logger from '../utils/logger.js';
import config from '../config/index.js';
import { EventEmitter } from 'events';

class NotificationService extends EventEmitter {
  constructor() {
    super();
    this.stateTransitionMessages = config.notifications?.stateTransitions || {};
    this.initTelegram();
    this.initEmail();
    // Initialize Telegram queue (1 message per second)
    this.telegramQueue = [];
    this.isSendingTelegram = false;
  }

  initTelegram() {
    const tgConfig = config.notifications?.telegram;
    this.telegramEnabled = tgConfig?.enabled || false;
    this.telegramBotToken = tgConfig?.botToken;
    this.telegramChatId = tgConfig?.chatId;
  }

  initEmail() {
    const emailConfig = config.notifications?.email;
    this.emailEnabled = emailConfig?.enabled || false;
    if (this.emailEnabled) {
      this.transporter = nodemailer.createTransport({
        service: emailConfig?.service || 'gmail',
        auth: {
          user: emailConfig?.user,
          pass: emailConfig?.password
        }
      });
    }
  }

  /**
   * Generate notification message based on state transition
   */
  generateMessage(room, previousStateName, newStateName) {
    const key = `${previousStateName}-${newStateName}`;
    let message = this.stateTransitionMessages[key];

    if (!message) {
      message = `Phòng ${room}: ${previousStateName} → ${newStateName}`;
    } else {
      message = message.replace('{room}', room);
    }

    return message;
  }

  /**
   * Send notification via multiple channels
   */
  async sendNotification(room, previousState, newState, message) {
    try {
      logger.debug(`Notification: Room ${room} - ${message}`);

      // Get current coil states for payload
      const stateManager = (await import('./stateManager.js')).default;
      const coilState = stateManager.getCoilState(room) || {};

      // Broadcast via WebSocket
      this.emit('state-change', {
        room,
        previousState,
        newState,
        message,
        mainStatus: coilState.y_output_main || false,
        subStatus: coilState.y_output_sub || false,
        timestamp: new Date().toISOString()
      });

      // Queue Telegram message (1 per second)
      if (this.telegramEnabled) {
        this.queueTelegram(message);
      }

      // Send email
      if (this.emailEnabled) {
        await this.sendEmail(room, message);
      }
    } catch (error) {
      logger.error(`Failed to send notification: ${error.message}`);
    }
  }

  /**
   * Add message to Telegram queue
   */
  queueTelegram(message) {
    this.telegramQueue.push(message);
    this.processTelegramQueue();
  }

  /**
   * Process Telegram queue (send 1 message per second)
   */
  async processTelegramQueue() {
    if (this.isSendingTelegram || this.telegramQueue.length === 0) {
      return;
    }

    this.isSendingTelegram = true;
    const message = this.telegramQueue.shift();

    try {
      await this.sendTelegram(message);
    } catch (error) {
      logger.error(`Failed to send Telegram from queue: ${error.message}`);
    }

    // Wait 1 second before processing next message
    setTimeout(() => {
      this.isSendingTelegram = false;
      this.processTelegramQueue();
    }, 1000);
  }

  /**
   * Send message to Telegram
   */
  async sendTelegram(message) {
    try {
      const url = `https://api.telegram.org/bot${this.telegramBotToken}/sendMessage`;
      await axios.post(url, {
        chat_id: this.telegramChatId,
        text: message
      });
      logger.debug('Telegram notification sent');
    } catch (error) {
      logger.error(`Telegram send failed: ${error.message}`);
    }
  }

  /**
   * Send email notification
   */
  async sendEmail(room, message) {
    try {
      const mailOptions = {
        from: config.notifications?.email?.user,
        to: config.notifications?.email?.to,
        subject: `Thông báo trạng thái phòng ${room}`,
        html: `
          <h3>Thông báo tự động từ hệ thống quản lý phòng</h3>
          <p><strong>Phòng:</strong> ${room}</p>
          <p><strong>Thông báo:</strong> ${message}</p>
          <p><strong>Thời gian:</strong> ${new Date().toLocaleString('vi-VN')}</p>
        `
      };

      await this.transporter.sendMail(mailOptions);
      logger.debug('Email notification sent');
    } catch (error) {
      logger.error(`Email send failed: ${error.message}`);
    }
  }
}

export default new NotificationService();
