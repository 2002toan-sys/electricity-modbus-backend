import logger from '../utils/logger.js';

/**
 * Global Error Handler Middleware
 * Centralizes error logging and standardizes error responses.
 */
export const errorHandler = (err, req, res, next) => {
  // Log the error once centrally
  logger.error(`[${req.method} ${req.originalUrl}] ${err.message}`);

  // Send standard response
  const statusCode = err.status || 500;
  res.status(statusCode).json({
    error: err.message || 'Internal Server Error',
    success: false
  });
};
