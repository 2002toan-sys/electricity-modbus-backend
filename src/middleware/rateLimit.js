import rateLimit from 'express-rate-limit';
import config from '../config/index.js';

export const limiter = rateLimit({
  windowMs: config.rateLimit?.windowMs || 60 * 1000,
  max: config.rateLimit?.maxRequests || 100,
  message: 'Too many requests, please try again later'
});