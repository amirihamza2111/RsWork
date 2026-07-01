const rateLimit = require('express-rate-limit');

// Allow tests to disable rate limiting deterministically.
const skip = () => process.env.DISABLE_RATE_LIMIT === 'true';

// General API limiter.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip,
});

// Stricter limiter for auth endpoints to slow down credential brute-forcing.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, message: 'Too many attempts, please try again later' },
  skip,
});

module.exports = { apiLimiter, authLimiter };
