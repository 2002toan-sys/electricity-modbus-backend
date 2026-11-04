import { timingSafeEqual } from 'node:crypto';
import logger from '../utils/logger.js';
import config from '../utils/configLoader.js';
import authService from '../services/authService.js';

function isMatchingApiKey(candidate, configured) {
  if (typeof candidate !== 'string' || typeof configured !== 'string') return false;
  const candidateBuffer = Buffer.from(candidate);
  const configuredBuffer = Buffer.from(configured);
  return candidateBuffer.length === configuredBuffer.length &&
    timingSafeEqual(candidateBuffer, configuredBuffer);
}

function findApiKeyEntry(apiKey) {
  return config.auth?.apiKeys?.find(entry => isMatchingApiKey(apiKey, entry.key));
}

/**
 * Check API Key header (for third-party apps)
 * API keys are loaded from the optional API_KEY environment variable.
 */
export const requireApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) {
    logger.warn(`Missing API Key from ${req.ip}`);
    return res.status(401).json({ error: 'Invalid API Key' });
  }

  const entry = findApiKeyEntry(apiKey);
  if (!entry) {
    logger.warn(`Invalid API Key from ${req.ip}`);
    return res.status(401).json({ error: 'Invalid API Key' });
  }

  // Attach user info from API key mapping
  req.user = { username: entry.name || 'api-client', role: entry.role || 'admin' };
  req.authType = 'api-key';
  next();
};

/**
 * Accept a dedicated API key for integrations or a JWT for frontend users.
 */
export const authenticate = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];

  if (apiKey) {
    const entry = findApiKeyEntry(apiKey);
    if (entry) {
      req.user = { username: entry.name || 'api-client', role: entry.role || 'admin' };
      req.authType = 'api-key';
      logger.debug(`API Key authenticated: ${entry.name}`);
      return next();
    }
  }

  const authorization = req.headers.authorization || '';
  const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
  const authentication = tokenMatch && authService.authenticateToken(tokenMatch[1], {
    updateActivity: req.path !== '/api/auth/verify' && req.path !== '/api/auth/logout'
  });
  if (authentication) {
    req.user = authentication.user;
    req.authTokenId = authentication.tokenId;
    req.authType = 'jwt';
    logger.debug(`JWT authenticated: ${req.user.username}`);
    return next();
  }

  logger.warn(`Unauthorized access from ${req.ip}`);
  return res.status(401).json({ error: 'Unauthorized or token expired' });
};

export const requireJwt = (req, res, next) => {
  if (req.authType !== 'jwt') {
    return res.status(401).json({ error: 'JWT authentication required' });
  }
  return next();
};

export const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin' || req.authType !== 'jwt') {
    return res.status(403).json({ error: 'Admin role required' });
  }
  return next();
};