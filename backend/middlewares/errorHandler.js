const config = require('../config');

// Postgres SQLSTATE codes surfaced as client errors instead of 500s.
const PG_ERRORS = {
  '22P02': [400, 'Invalid identifier or value'],
  '22003': [400, 'Numeric value out of range'],
  '23502': [400, 'A required field is missing'],
  '23503': [400, 'Referenced record does not exist'],
  '23505': [409, 'Duplicate value'],
  '23514': [400, 'Value failed validation'],
};

// Central error handler. Translates thrown errors (ApiError, Postgres errors,
// or anything else) into a consistent JSON response.
const errorHandler = (err, req, res, next) => {
  let status = err.status || err.statusCode || 500;
  let message = err.message || 'Internal Server Error';

  if (err.name === 'PostgresError' && PG_ERRORS[err.code]) {
    [status, message] = PG_ERRORS[err.code];
    if (err.code === '23505' && err.constraint_name) {
      message = `Duplicate value (${err.constraint_name})`;
    }
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
