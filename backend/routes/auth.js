const express = require('express');
const router = express.Router();
const {
  register,
  login,
  getMe,
  registerRestaurant,
  changePassword,
  forgotPassword,
  resetPassword,
  verifyEmail,
  resendVerification,
} = require('../controllers/authController');
const { protect } = require('../middlewares/auth');
const { authLimiter } = require('../middlewares/rateLimiters');
const {
  registerValidator,
  loginValidator,
  registerRestaurantValidator,
} = require('../middlewares/validators');
const validate = require('../middlewares/validate');

router.post('/register', authLimiter, registerValidator, validate, register);
router.post(
  '/register-restaurant',
  authLimiter,
  registerRestaurantValidator,
  validate,
  registerRestaurant
);
router.post('/login', authLimiter, loginValidator, validate, login);
router.get('/me', protect, getMe);

router.post('/change-password', protect, changePassword);
router.post('/forgot-password', authLimiter, forgotPassword);
router.post('/reset-password', authLimiter, resetPassword);

// 6-digit OTPs need brute-force protection.
router.get('/verify-email', authLimiter, verifyEmail);
router.post('/verify-email', authLimiter, verifyEmail);
router.post('/resend-verification', authLimiter, resendVerification);

module.exports = router;
