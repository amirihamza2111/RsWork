const jwt = require('jsonwebtoken');
const User = require('../models/User');
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
