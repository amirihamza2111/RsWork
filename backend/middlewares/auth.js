const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const User = require('../models/User');
const Restaurant = require('../models/Restaurant');
const config = require('../config');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');

// Multi-restaurant switch: an owner with several restaurants (or a superadmin)
// sends X-Restaurant-Id to pick which restaurant the request is scoped to.
// Every downstream controller reads req.user.restaurant, so overriding it here
// scopes the whole API (menu CRUD, tables, orders, reports…) to the selection.
const applyRestaurantSwitch = async (req, user) => {
  const selected = req.headers['x-restaurant-id'];
  if (!selected || !user) return;
  if (!mongoose.isValidObjectId(selected)) return;
  if (String(user.restaurant || '') === String(selected)) return;

  if (user.role === 'superadmin') {
    user.restaurant = selected;
    return;
  }
  if (user.role === 'manager') {
    // A manager may only switch to a restaurant they own.
    const owned = await Restaurant.exists({ _id: selected, owner: user._id });
    if (owned) user.restaurant = selected;
  }
};

exports.protect = asyncHandler(async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    throw ApiError.unauthorized('Not authorized to access this route');
  }

  const decoded = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] });
  const user = await User.findById(decoded.id).select('+passwordChangedAt');

  if (!user) {
    throw ApiError.unauthorized('User not found');
  }

  if (!user.isActive) {
    throw ApiError.unauthorized('Account is deactivated');
  }

  // Reject tokens issued before the user's most recent password change.
  if (user.passwordChangedAt) {
    const changedAtSec = Math.floor(new Date(user.passwordChangedAt).getTime() / 1000);
    if (decoded.iat && changedAtSec > decoded.iat) {
      throw ApiError.unauthorized('Session expired, please log in again');
    }
  }

  await applyRestaurantSwitch(req, user);

  req.user = user;
  next();
});

// Attaches req.user when a valid token is present, but never rejects.
// Used by public routes (QR order placement, order tracking) that still want to
// know the caller when they happen to be logged in.
exports.optionalAuth = asyncHandler(async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) return next();

  try {
    const decoded = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] });
    const user = await User.findById(decoded.id).select('+passwordChangedAt');
    if (user && user.isActive) {
      const changedAtSec = user.passwordChangedAt
        ? Math.floor(new Date(user.passwordChangedAt).getTime() / 1000)
        : 0;
      if (!decoded.iat || changedAtSec <= decoded.iat) {
        req.user = user;
      }
    }
  } catch {
    // Ignore invalid tokens for optional auth.
  }

  next();
});

exports.authorize = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    throw ApiError.forbidden(
      `User role '${req.user?.role}' is not authorized to access this route`
    );
  }
  next();
};
