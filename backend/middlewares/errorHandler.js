const config = require('../config');

// Central error handler. Translates thrown errors (ApiError, Mongoose errors,
// or anything else) into a consistent JSON response.
const errorHandler = (err, req, res, next) => {
  let status = err.status || err.statusCode || 500;
  let message = err.message || 'Internal Server Error';

  // Mongoose: bad ObjectId
  if (err.name === 'CastError') {
    status = 400;
    message = `Invalid ${err.path}: ${err.value}`;
  }

  // Mongoose: schema validation
  if (err.name === 'ValidationError') {
    status = 400;
    message = Object.values(err.errors)
      .map((e) => e.message)
      .join(', ');
  }

  // MongoDB: duplicate key
  if (err.code === 11000) {
    status = 409;
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    message = `Duplicate value for ${field}`;
  }

  // JWT
  if (err.name === 'JsonWebTokenError') {
    status = 401;
    message = 'Invalid token';
  }
  if (err.name === 'TokenExpiredError') {
    status = 401;
    message = 'Token expired';
  }

  if (status >= 500 && !config.isProd) {
    // Surface unexpected server errors during development.
    console.error(err);
  }

  const response = { success: false, message };
  if (config.isDev && status >= 500) {
    response.stack = err.stack;
  }

  res.status(status).json(response);
};

module.exports = errorHandler;
