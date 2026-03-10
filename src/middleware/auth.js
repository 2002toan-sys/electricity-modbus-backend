import logger from '../utils/logger.js';
import config from '../config/index.js';

/**
 * Check API Key header (for third-party apps)
 * API keys are mapped in config.auth.apiKeys
 */
export const requireApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) {
    logger.warn(`Missing API Key from ${req.ip}`);
    return res.status(401).json({ error: 'Invalid API Key' });
  }

  const entry = config.auth?.apiKeys?.find(a => a.key === apiKey);
  if (!entry) {
    logger.warn(`Invalid API Key from ${req.ip}`);
    return res.status(401).json({ error: 'Invalid API Key' });
  }

  // Attach user info from API key mapping
  req.user = { username: entry.name || 'api-client', role: entry.role || 'admin' };
  next();
};

/**
 * Generic authenticate: accept API Key (third-party) or Session (frontend)
 */
export const authenticate = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];

  // Method 1: API Key (third-party apps)
  if (apiKey) {
    const entry = config.auth?.apiKeys?.find(a => a.key === apiKey);
    if (entry) {
      req.user = { username: entry.name || 'api-client', role: entry.role || 'admin' };
      logger.debug(`API Key authenticated: ${entry.name}`);
      return next();
    }
  }

  // Method 2: Session-based auth (frontend login with user/password)
  if (req.session && req.session.user) {
    req.user = req.session.user;
    logger.debug(`Session authenticated: ${req.session.user.username}`);
    return next();
  }

  logger.warn(`Unauthorized access from ${req.ip}`);
  return res.status(401).json({ error: 'Unauthorized' });
};