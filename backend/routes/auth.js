const express = require('express');
const router = express.Router();
const {
  register,
  getMe,
  registerRestaurant,
  forgotPassword,
  resendVerification,
} = require('../controllers/authController');
const { protect } = require('../middlewares/auth');
const { authLimiter } = require('../middlewares/rateLimiters');
const { registerValidator, registerRestaurantValidator } = require('../middlewares/validators');
const validate = require('../middlewares/validate');

// Login, logout, OTP verification, password change and reset completion are
// handled client-side by Supabase Auth.
router.post('/register', authLimiter, registerValidator, validate, register);
router.post(
  '/register-restaurant',
  authLimiter,
  registerRestaurantValidator,
  validate,
  registerRestaurant
);
router.get('/me', protect, getMe);
router.post('/forgot-password', authLimiter, forgotPassword);
router.post('/resend-verification', authLimiter, resendVerification);

module.exports = router;
