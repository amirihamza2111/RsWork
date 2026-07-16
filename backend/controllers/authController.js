const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Restaurant = require('../models/Restaurant');
const config = require('../config');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { ok, created } = require('../utils/apiResponse');
const { sendEmailSafe } = require('../services/emailService');
const { verificationEmail, passwordResetEmail } = require('../services/emailTemplates');

const resetUrl = (rawToken) => `${config.clientUrl}/reset-password?token=${rawToken}`;

// Issues a 6-digit email verification code, saves its hash, and emails the code.
const issueEmailVerification = async (user) => {
  const code = user.createEmailVerificationToken();
  await user.save();
  await sendEmailSafe({ to: user.email, ...verificationEmail(user.name, code) });
  return code;
};

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

  const rawVerifyToken = await issueEmailVerification(user);
  const payload = { token: generateToken(user._id), user: publicUser(user) };
  if (!config.isProd) payload.verifyToken = rawVerifyToken; // testable without email

  return created(res, payload, 'Registered — check your email to verify your account');
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
  const {
    restaurantName,
    name,
    email,
    password,
    confirmPassword,
    type,
    address,
    phone,
    currency,
    language,
  } = req.body;

  if (!restaurantName || !name || !email || !password) {
    throw ApiError.badRequest('Please provide restaurantName, name, email, and password');
  }

  // confirmPassword is optional in the body (older clients still work), but if
  // sent it must match — this prevents password typos during onboarding.
  if (confirmPassword !== undefined && confirmPassword !== password) {
    throw ApiError.badRequest('Passwords do not match');
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

  const rawVerifyToken = await issueEmailVerification(user);
  const payload = { token: generateToken(user._id), user: publicUser(user), restaurant };
  if (!config.isProd) payload.verifyToken = rawVerifyToken;

  return created(res, payload, 'Restaurant registered — check your email to verify');
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
  // The save bumps passwordChangedAt, which would invalidate the caller's
  // current token — so issue a fresh one to keep this session alive.
  return ok(res, { token: generateToken(user._id) }, 'Password changed');
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

  await sendEmailSafe({ to: user.email, ...passwordResetEmail(user.name, resetUrl(rawToken)) });

  // Also expose the token in non-production so the flow is testable without email.
  const data = config.isProd ? null : { resetToken: rawToken };
  return ok(res, data, message);
});

// @desc   Verify a user's email using a token
// @route  GET/POST /api/auth/verify-email
// @access Public
exports.verifyEmail = asyncHandler(async (req, res) => {
  const token = req.query.token || req.body.token;
  if (!token) throw ApiError.badRequest('Verification token is required');

  const user = await User.findOne({
    emailVerificationToken: User.hashResetToken(token),
    emailVerificationExpires: { $gt: Date.now() },
  });
  if (!user) throw ApiError.badRequest('Invalid or expired verification token');

  user.isVerified = true;
  user.emailVerificationToken = undefined;
  user.emailVerificationExpires = undefined;
  await user.save();

  return ok(res, { verified: true }, 'Email verified');
});

// @desc   Resend the verification email
// @route  POST /api/auth/resend-verification
// @access Public
exports.resendVerification = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) throw ApiError.badRequest('Please provide email');

  const user = await User.findOne({ email: String(email).trim().toLowerCase() });
  const message = 'If that account exists and is unverified, a new link has been sent';
  if (!user || user.isVerified) return ok(res, null, message);

  const rawToken = await issueEmailVerification(user);
  const data = config.isProd ? null : { verifyToken: rawToken };
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
