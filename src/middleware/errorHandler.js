import logger from '../utils/logger.js';

/**
 * Global Error Handler Middleware
 * Centralizes error logging and standardizes error responses.
 */
export const errorHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err);

  const statusCode = Number.isInteger(err.status) && err.status >= 400 && err.status < 600
    ? err.status
    : 500;
  const responseMessage = statusCode >= 500
    ? 'Internal Server Error'
    : err.message || 'Request failed';
  logger.error(`[${req.method} ${req.path}] ${statusCode}: ${err.message}`);

  res.status(statusCode).json({
    error: responseMessage,
    success: false
  });
};
