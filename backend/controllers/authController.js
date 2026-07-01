const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Restaurant = require('../models/Restaurant');
const config = require('../config');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { ok, created } = require('../utils/apiResponse');

const generateToken = (id) =>
  jwt.sign({ id }, config.jwt.secret, { expiresIn: config.jwt.expiresIn });

const publicUser = (user) => {
  const obj = user.toObject();
  delete obj.password;
  return obj;
};

// @desc   Register a new account
// @route  POST /api/auth/register
exports.register = asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    throw ApiError.badRequest('Please provide name, email, and password');
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) {
    throw ApiError.badRequest('User already exists');
  }

  // Self-registration always creates a client. Staff accounts (waiter, cook,
  // cashier, manager) are created by a manager/superadmin via /api/users.
  const user = await User.create({
    name,
    email: normalizedEmail,
    password,
    role: 'client',
  });

  return created(res, { token: generateToken(user._id), user: publicUser(user) }, 'Registered');
});

// @desc   Log in
// @route  POST /api/auth/login
exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    throw ApiError.badRequest('Please provide email and password');
  }

  const user = await User.findOne({ email: String(email).trim().toLowerCase() }).select(
    '+password'
  );
  if (!user || !(await user.comparePassword(password))) {
    throw ApiError.unauthorized('Invalid credentials');
  }

  if (!user.isActive) {
    throw ApiError.unauthorized('Account is deactivated');
  }

  return ok(res, { token: generateToken(user._id), user: publicUser(user) }, 'Logged in');
});

// @desc   Current user
// @route  GET /api/auth/me
exports.getMe = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) {
    throw ApiError.notFound('User not found');
  }
  return ok(res, { user: publicUser(user) });
});

// @desc   Onboard a new restaurant together with its first manager account
// @route  POST /api/auth/register-restaurant
// @access Public
exports.registerRestaurant = asyncHandler(async (req, res) => {
  const { restaurantName, name, email, password, type, address, phone, currency, language } =
    req.body;

  if (!restaurantName || !name || !email || !password) {
    throw ApiError.badRequest('Please provide restaurantName, name, email, and password');
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  if (await User.findOne({ email: normalizedEmail })) {
    throw ApiError.badRequest('User already exists');
  }

  const restaurant = await Restaurant.create({
    name: restaurantName,
    type: type || 'restaurant',
    address,
    phone,
    settings: { currency: currency || 'TND', language: language || 'fr' },
  });

  let user;
  try {
    user = await User.create({
      name,
      email: normalizedEmail,
      password,
      role: 'manager',
      restaurant: restaurant._id,
    });
  } catch (err) {
    // Compensate so we never leave an orphaned restaurant behind.
    await Restaurant.deleteOne({ _id: restaurant._id });
    if (err?.code === 11000) throw ApiError.badRequest('User already exists');
    throw err;
  }

  restaurant.owner = user._id;
  await restaurant.save();

  return created(
    res,
    { token: generateToken(user._id), user: publicUser(user), restaurant },
    'Restaurant registered'
  );
});

// @desc   Change the authenticated user's password
// @route  POST /api/auth/change-password
// @access Private
exports.changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    throw ApiError.badRequest('Please provide currentPassword and newPassword');
  }
  if (String(newPassword).length < 6) {
    throw ApiError.badRequest('New password must be at least 6 characters');
  }

  const user = await User.findById(req.user.id).select('+password');
  if (!user || !(await user.comparePassword(currentPassword))) {
    throw ApiError.unauthorized('Current password is incorrect');
  }

  user.password = newPassword; // hashed by the pre-save hook
  await user.save();
  return ok(res, null, 'Password changed');
});

// @desc   Begin a password reset (issues a reset token)
// @route  POST /api/auth/forgot-password
// @access Public
exports.forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) throw ApiError.badRequest('Please provide email');

  const user = await User.findOne({ email: String(email).trim().toLowerCase() });

  // Always respond the same way so we don't reveal which emails exist.
  const message = 'If that account exists, a reset token has been issued';
  if (!user) return ok(res, null, message);

  const rawToken = user.createPasswordResetToken();
  await user.save();

  // TODO: deliver the token by email once the email feature is enabled.
  // Until then, expose it in non-production so the flow is testable.
  const data = config.isProd ? null : { resetToken: rawToken };
  return ok(res, data, message);
});

// @desc   Complete a password reset using a token
// @route  POST /api/auth/reset-password
// @access Public
exports.resetPassword = asyncHandler(async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) {
    throw ApiError.badRequest('Please provide token and newPassword');
  }
  if (String(newPassword).length < 6) {
    throw ApiError.badRequest('New password must be at least 6 characters');
  }

  const user = await User.findOne({
    resetPasswordToken: User.hashResetToken(token),
    resetPasswordExpires: { $gt: Date.now() },
  }).select('+password');

  if (!user) {
    throw ApiError.badRequest('Invalid or expired reset token');
  }

  user.password = newPassword;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpires = undefined;
  await user.save();

  return ok(res, { token: generateToken(user._id) }, 'Password reset');
});
