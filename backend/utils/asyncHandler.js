// Wraps an async route handler so rejected promises are forwarded to the
// central error handler instead of being swallowed (or needing try/catch).
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

module.exports = asyncHandler;
