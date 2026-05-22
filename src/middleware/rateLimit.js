import rateLimit from 'express-rate-limit';
import config from '../utils/configLoader.js';

export const limiter = rateLimit({
  windowMs: config.rateLimit?.windowMs || 60 * 1000,
  max: config.rateLimit?.maxRequests || 100,
  message: 'Too many requests, please try again later'
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 login requests per windowMs
  message: { error: 'Quá nhiều yêu cầu đăng nhập. Vui lòng thử lại sau 15 phút.' },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});