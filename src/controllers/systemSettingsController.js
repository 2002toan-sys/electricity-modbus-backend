import commandQueue from '../services/commandQueue.js';
import notificationService from '../services/notificationService.js';
import configService from '../services/configService.js';
import config from '../utils/configLoader.js';
import { parseInteger } from '../utils/configPayload.js';

const SYSTEM_SETTINGS = {
  port: { key: 'app.port', category: 'app', description: 'Cổng HTTP Server' },
  polling_interval: {
    key: 'app.polling_interval',
    category: 'app',
    description: 'Tần suất đọc Modbus PLC (ms)'
  },
  interlock_enabled: {
    key: 'app.interlock_enabled',
    category: 'app',
    description: 'Tự động tắt relay phụ khi relay chính tắt'
  },
  write_relay_enabled: {
    key: 'app.write_relay_enabled',
    category: 'app',
    description: 'Cho phép lệnh ghi relay'
  },
  http_keep_alive_timeout: {
    key: 'app.http_keep_alive_timeout',
    category: 'app',
    description: 'HTTP keep-alive timeout (ms)'
  },
  cors_origins: {
    key: 'app.cors_origins',
    category: 'app',
    description: 'Danh sách CORS origins được phép'
  },
  rate_limit_window_ms: {
    key: 'rateLimit.windowMs',
    category: 'rateLimit',
    description: 'Cửa sổ giới hạn request (ms)'
  },
  rate_limit_max_requests: {
    key: 'rateLimit.maxRequests',
    category: 'rateLimit',
    description: 'Số request tối đa trong cửa sổ'
  },
  reconnect_initial_delay: {
    key: 'reconnect.initialDelay',
    category: 'reconnect',
    description: 'Thời gian chờ reconnect ban đầu (ms)'
  },
  reconnect_max_delay: {
    key: 'reconnect.maxDelay',
    category: 'reconnect',
    description: 'Thời gian chờ reconnect tối đa (ms)'
  },
  reconnect_backoff_multiplier: {
    key: 'reconnect.backoffMultiplier',
    category: 'reconnect',
    description: 'Hệ số tăng thời gian reconnect'
  },
  telegram_enabled: {
    key: 'notifications.telegram.enabled',
    category: 'telegram',
    description: 'Kích hoạt thông báo Telegram'
  },
  telegram_bot_token: {
    key: 'notifications.telegram.bot_token',
    category: 'telegram',
    description: 'Token Bot Telegram'
  },
  telegram_chat_id: {
    key: 'notifications.telegram.chat_id',
    category: 'telegram',
    description: 'ID Chat Telegram'
  },
  email_enabled: {
    key: 'notifications.email.enabled',
    category: 'email',
    description: 'Kích hoạt thông báo Email'
  },
  email_service: {
    key: 'notifications.email.service',
    category: 'email',
    description: 'Dịch vụ SMTP email'
  },
  email_user: {
    key: 'notifications.email.user',
    category: 'email',
    description: 'Tài khoản email gửi'
  },
  email_password: {
    key: 'notifications.email.password',
    category: 'email',
    description: 'Mật khẩu ứng dụng email'
  },
  email_to: {
    key: 'notifications.email.to',
    category: 'email',
    description: 'Địa chỉ email nhận'
  }
};

const isEnabled = (value) => value === true || value === 'true' || value === '1';

const readSettings = () => {
  const rows = configService.getAllSystemConfigs();
  const settings = Object.fromEntries(rows.map(({ key, value }) => [key, value]));
  const token = settings[SYSTEM_SETTINGS.telegram_bot_token.key] ??
    config.notifications?.telegram?.botToken ?? '';
  const emailPassword = settings['notifications.email.password'] ??
    config.notifications?.email?.password ?? '';
  const stateTransitions = Object.fromEntries(
    Object.entries(config.notifications?.stateTransitions || {}).map(([transition, message]) => [
      transition,
      settings[`notifications.stateTransitions.${transition}`] ?? message
    ])
  );

  return {
    port: Number(settings[SYSTEM_SETTINGS.port.key] ?? config.app.port),
    polling_interval: Number(
      settings[SYSTEM_SETTINGS.polling_interval.key] ?? config.app.polling_interval
    ),
    interlock_enabled: isEnabled(settings[SYSTEM_SETTINGS.interlock_enabled.key] ??
      config.app.interlock_enabled),
    write_relay_enabled: isEnabled(settings[SYSTEM_SETTINGS.write_relay_enabled.key] ??
      config.app.write_relay_enabled),
    http_keep_alive_timeout: Number(
      settings[SYSTEM_SETTINGS.http_keep_alive_timeout.key] ?? config.app.http_keep_alive_timeout
    ),
    cors_origins: (() => {
      const rawOrigins = settings[SYSTEM_SETTINGS.cors_origins.key];
      return rawOrigins === undefined
        ? config.app.cors_origins || []
        : JSON.parse(rawOrigins);
    })(),
    rate_limit_window_ms: Number(
      settings[SYSTEM_SETTINGS.rate_limit_window_ms.key] ?? config.rateLimit.windowMs
    ),
    rate_limit_max_requests: Number(
      settings[SYSTEM_SETTINGS.rate_limit_max_requests.key] ?? config.rateLimit.maxRequests
    ),
    reconnect_initial_delay: Number(
      settings[SYSTEM_SETTINGS.reconnect_initial_delay.key] ?? config.reconnect.initialDelay
    ),
    reconnect_max_delay: Number(
      settings[SYSTEM_SETTINGS.reconnect_max_delay.key] ?? config.reconnect.maxDelay
    ),
    reconnect_backoff_multiplier: Number(
      settings[SYSTEM_SETTINGS.reconnect_backoff_multiplier.key] ?? config.reconnect.backoffMultiplier
    ),
    telegram_enabled: isEnabled(settings[SYSTEM_SETTINGS.telegram_enabled.key] ??
      config.notifications?.telegram?.enabled),
    telegram_bot_token: token ? `${'*'.repeat(Math.max(0, token.length - 4))}${token.slice(-4)}` : '',
    telegram_token_configured: Boolean(token),
    telegram_chat_id: settings[SYSTEM_SETTINGS.telegram_chat_id.key] ??
      config.notifications?.telegram?.chatId ?? '',
    email_enabled: isEnabled(settings['notifications.email.enabled'] ??
      config.notifications?.email?.enabled),
    email_service: settings['notifications.email.service'] ??
      config.notifications?.email?.service ?? 'gmail',
    email_user: settings['notifications.email.user'] ??
      config.notifications?.email?.user ?? '',
    email_password_configured: Boolean(emailPassword),
    email_to: settings['notifications.email.to'] ??
      config.notifications?.email?.to ?? '',
    state_transitions: stateTransitions
  };
};

const parseSystemSettings = (body) => {
  const settings = {};
  const entries = [
    ['port', 1, 65535],
    ['polling_interval', 50, 60000],
    ['http_keep_alive_timeout', 1000, 300000],
    ['rate_limit_window_ms', 1000, 3600000],
    ['rate_limit_max_requests', 1, 100000],
    ['reconnect_initial_delay', 100, 300000],
    ['reconnect_max_delay', 100, 3600000]
  ];

  for (const [field, min, max] of entries) {
    if (body[field] === undefined) continue;
    const value = parseInteger(body[field]);
    if (!Number.isInteger(value) || value < min || value > max) {
      return { error: `${field} must be an integer between ${min} and ${max}` };
    }
    settings[field] = String(value);
  }

  const reconnectInitialDelay = Number(
    settings.reconnect_initial_delay ?? config.reconnect.initialDelay
  );
  const reconnectMaxDelay = Number(
    settings.reconnect_max_delay ?? config.reconnect.maxDelay
  );
  if (reconnectMaxDelay < reconnectInitialDelay) {
    return { error: 'reconnect_max_delay must be greater than or equal to reconnect_initial_delay' };
  }

  if (body.reconnect_backoff_multiplier !== undefined) {
    const value = Number(body.reconnect_backoff_multiplier);
    if (!Number.isFinite(value) || value < 1 || value > 10) {
      return { error: 'reconnect_backoff_multiplier must be between 1 and 10' };
    }
    settings.reconnect_backoff_multiplier = String(value);
  }

  for (const field of [
    'interlock_enabled',
    'write_relay_enabled',
    'telegram_enabled',
    'email_enabled'
  ]) {
    if (body[field] === undefined) continue;
    if (typeof body[field] !== 'boolean') {
      return { error: `${field} must be a boolean` };
    }
    settings[field] = String(body[field]);
  }

  if (body.cors_origins !== undefined) {
    if (!Array.isArray(body.cors_origins) ||
        body.cors_origins.some((origin) => typeof origin !== 'string')) {
      return { error: 'cors_origins must be an array of URLs' };
    }
    const origins = [...new Set(body.cors_origins.map((origin) => origin.trim()).filter(Boolean))];
    if (origins.some((origin) => {
      try {
        const parsed = new URL(origin);
        return !['http:', 'https:'].includes(parsed.protocol) ||
          parsed.origin !== origin || parsed.username || parsed.password;
      } catch {
        return true;
      }
    })) {
      return { error: 'Each CORS origin must be a valid HTTP or HTTPS origin without a path' };
    }
    settings.cors_origins = JSON.stringify(origins);
  }

  if (body.telegram_bot_token !== undefined) {
    if (typeof body.telegram_bot_token !== 'string') {
      return { error: 'telegram_bot_token must be text' };
    }
    const token = body.telegram_bot_token.trim();
    if (token && !/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) {
      return { error: 'Telegram bot token format is invalid' };
    }
    if (token) settings.telegram_bot_token = token;
  }

  const telegramEnabled = body.telegram_enabled ?? config.notifications?.telegram?.enabled;
  if (body.telegram_chat_id !== undefined) {
    if (typeof body.telegram_chat_id !== 'string' ||
        body.telegram_chat_id.trim().length > 128 ||
        (telegramEnabled && !body.telegram_chat_id.trim())) {
      return { error: 'Telegram chat ID must contain 1 to 128 characters' };
    }
    if (body.telegram_chat_id.trim()) settings.telegram_chat_id = body.telegram_chat_id.trim();
  }

  const telegramToken = body.telegram_bot_token?.trim() ||
    config.notifications?.telegram?.botToken ||
    configService.getSystemConfigValue('notifications.telegram.bot_token');
  const telegramChatId = body.telegram_chat_id?.trim() ||
    config.notifications?.telegram?.chatId ||
    configService.getSystemConfigValue('notifications.telegram.chat_id');
  if (telegramEnabled && (!telegramToken || !telegramChatId)) {
    return { error: 'Configure Telegram bot token and chat ID before enabling Telegram' };
  }

  const emailEnabled = body.email_enabled ?? config.notifications?.email?.enabled;
  const emailTextFields = ['email_service', 'email_user', 'email_to', 'email_password'];
  for (const field of emailTextFields) {
    if (body[field] === undefined) continue;
    if (typeof body[field] !== 'string') return { error: `${field} must be text` };
    const value = body[field].trim();
    if (value.length > 255) return { error: `${field} cannot exceed 255 characters` };
    if (field !== 'email_password' && !value && emailEnabled) {
      return { error: `${field} cannot be empty` };
    }
    if (['email_user', 'email_to'].includes(field) &&
        value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return { error: `${field} must be a valid email address` };
    }
    if (value) settings[field] = value;
  }

  const emailPassword = body.email_password?.trim() ||
    config.notifications?.email?.password ||
    configService.getSystemConfigValue('notifications.email.password');
  const emailService = body.email_service ??
    config.notifications?.email?.service ??
    configService.getSystemConfigValue('notifications.email.service');
  const emailUser = body.email_user ?? config.notifications?.email?.user;
  const emailRecipient = body.email_to ?? config.notifications?.email?.to;
  if (emailEnabled && (!emailService || !emailPassword || !emailUser || !emailRecipient)) {
    return { error: 'Configure email service, sender, application password, and recipient before enabling email' };
  }

  if (body.state_transitions !== undefined) {
    if (!body.state_transitions || typeof body.state_transitions !== 'object' ||
        Array.isArray(body.state_transitions)) {
      return { error: 'state_transitions must be an object' };
    }
    const knownTransitions = config.notifications?.stateTransitions || {};
    for (const [transition, message] of Object.entries(body.state_transitions)) {
      if (!Object.hasOwn(knownTransitions, transition)) {
        return { error: `Unknown state transition: ${transition}` };
      }
      if (typeof message !== 'string' || message.length > 500) {
        return { error: `Message for ${transition} must be text up to 500 characters` };
      }
      settings[`state_transition:${transition}`] = message.trim();
    }
  }

  return { settings };
};

export const getSystemSettings = (req, res) => {
  try {
    return res.status(200).json(readSettings());
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

export const updateSystemSettings = (req, res) => {
  try {
    const result = parseSystemSettings(req.body || {});
    if (result.error) return res.status(400).json({ error: result.error });

    const previousRestartSettings = {
      port: config.app.port,
      keepAliveTimeout: config.app.http_keep_alive_timeout,
      rateLimitWindowMs: config.rateLimit.windowMs,
      rateLimitMaxRequests: config.rateLimit.maxRequests
    };
    const configEntries = Object.entries(result.settings).map(([field, value]) => {
      const transition = field.startsWith('state_transition:')
        ? field.slice('state_transition:'.length)
        : null;
      const definition = transition
        ? {
          key: `notifications.stateTransitions.${transition}`,
          category: 'stateTransitions',
          description: `Thông báo chuyển trạng thái ${transition}`
        }
        : SYSTEM_SETTINGS[field];
      return {
          key: definition.key,
          value,
          category: definition.category,
          description: definition.description
      };
    });
    configService.upsertSystemConfigs(configEntries);

    config.reload();
    if (result.settings.polling_interval !== undefined) {
      commandQueue.updatePollingInterval(config.app.polling_interval);
    }
    if ([
      'telegram_enabled',
      'telegram_bot_token',
      'telegram_chat_id',
      'email_enabled',
      'email_service',
      'email_user',
      'email_password',
      'email_to'
    ].some((field) => result.settings[field] !== undefined)) {
      notificationService.reloadTelegramConfig();
      notificationService.reloadEmailConfig();
    }
    if (Object.keys(result.settings).some((field) => field.startsWith('state_transition:'))) {
      notificationService.reloadStateTransitionMessages();
    }

    return res.status(200).json({
      success: true,
      settings: readSettings(),
      restartRequired:
        config.app.port !== previousRestartSettings.port ||
        config.app.http_keep_alive_timeout !== previousRestartSettings.keepAliveTimeout ||
        config.rateLimit.windowMs !== previousRestartSettings.rateLimitWindowMs ||
        config.rateLimit.maxRequests !== previousRestartSettings.rateLimitMaxRequests
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

export const testTelegram = async (req, res) => {
  try {
    await notificationService.testTelegram();
    return res.status(200).json({ success: true, message: 'Telegram test message sent' });
  } catch (error) {
    return res.status(502).json({ error: error.message });
  }
};
