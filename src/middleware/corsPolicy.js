import config from '../utils/configLoader.js';

export function corsOrigin(origin, callback) {
  if (!origin) return callback(null, true);
  const allowedOrigins = config.app?.cors_origins || [];
  return callback(null, allowedOrigins.includes(origin));
}
