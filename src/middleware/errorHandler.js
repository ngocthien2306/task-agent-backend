/**
 * Global error handler middleware
 * @param {Error} err - Error object
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Next function
 */
export const errorHandler = (err, req, res, next) => {
  console.error("🚨 Global error handler:", err);

  // Don't log password in production
  if (process.env.NODE_ENV === 'production') {
    delete err.stack;
  }

  res.status(err.status || 500).json({
    error: {
      message: err.message || 'Internal Server Error',
      ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
    }
  });
};

/**
 * 404 handler middleware
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const notFoundHandler = (req, res) => {
  res.status(404).json({
    error: {
      message: `Route ${req.originalUrl} not found`,
      status: 404
    }
  });
};