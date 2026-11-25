import { z } from 'zod';
import config from '../utils/configLoader.js';

const cookieConfigSchema = z.object({
  REFRESH_TOKEN_COOKIE_NAME: z.string().min(1),
  REFRESH_TOKEN_COOKIE_SECURE: z.enum(['true', 'false'])
});

const parsedCookieConfig = cookieConfigSchema.safeParse(process.env);
if (!parsedCookieConfig.success) {
  throw new Error('Invalid refresh-token cookie configuration.');
}
if (process.env.NODE_ENV === 'production' &&
    parsedCookieConfig.data.REFRESH_TOKEN_COOKIE_SECURE === 'false') {
  throw new Error('REFRESH_TOKEN_COOKIE_SECURE must not be false in production.');
}

export const refreshCookieConfig = Object.freeze({
  name: parsedCookieConfig.data.REFRESH_TOKEN_COOKIE_NAME,
  path: '/api/auth',
  sameSite: 'strict',
  secure: parsedCookieConfig.data.REFRESH_TOKEN_COOKIE_SECURE === 'true'
});

export function requireCsrf(req, res, next) {
  const origin = req.get('origin');
  const allowedOrigins = config.app?.cors_origins || [];
  const requestOrigin = `${req.protocol}://${req.get('host')}`;
  if (!origin ||
      (origin !== requestOrigin && !allowedOrigins.includes(origin)) ||
      req.get('x-csrf-protection') !== '1') {
    return res.status(403).json({ error: 'CSRF validation failed' });
  }
  return next();
}
