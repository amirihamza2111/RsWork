const User = require('../models/User');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { ok, created } = require('../utils/apiResponse');
const { isSameRestaurant } = require('../utils/scope');

const MANAGER_ALLOWED_ROLES = new Set(['manager', 'waiter', 'cashier', 'cook']);

exports.getAllUsers = asyncHandler(async (req, res) => {
  // Superadmin sees everyone; a manager sees only their restaurant's staff.
  const filter = req.user.role === 'superadmin' ? {} : { restaurant: req.user.restaurant };
  const users = await User.find(filter).select('-password');
  return ok(res, { count: users.length, users });
});

exports.createStaff = asyncHandler(async (req, res) => {
  const { name, email, password, phone, role, restaurant } = req.body;

  if (!name || !email || !password) {
    throw ApiError.badRequest('Please provide name, email, and password');
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const normalizedRole = String(role || 'waiter').trim();
  const creatorRole = req.user.role;

  if (creatorRole !== 'superadmin' && !MANAGER_ALLOWED_ROLES.has(normalizedRole)) {
    throw ApiError.badRequest('Invalid role for staff account');
  }

  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) {
    throw ApiError.badRequest('Email already in use');
  }

  const resolvedRestaurant =
    creatorRole === 'superadmin' ? restaurant || req.user.restaurant : req.user.restaurant;
  if (!resolvedRestaurant) {
    throw ApiError.badRequest('Restaurant context is required');
  }

  const user = await User.create({
    name,
    email: normalizedEmail,
    password,
    phone,
    role: normalizedRole,
    restaurant: resolvedRestaurant,
  });

  const obj = user.toObject();
  delete obj.password;
  return created(res, { user: obj }, 'Staff account created');
});

exports.getUserById = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id).select('-password');
  if (!user) throw ApiError.notFound('User not found');
  if (!isSameRestaurant(req.user, user.restaurant)) throw ApiError.forbidden();
  return ok(res, { user });
});

exports.updateUser = asyncHandler(async (req, res) => {
  const { name, phone, role, isActive, restaurant, email } = req.body;
  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('User not found');
  if (!isSameRestaurant(req.user, user.restaurant)) throw ApiError.forbidden();

  if (name !== undefined) user.name = name;
  if (phone !== undefined) user.phone = phone;
  if (email !== undefined) user.email = String(email).trim().toLowerCase();
  if (role) {
    if (req.user.role !== 'superadmin' && !MANAGER_ALLOWED_ROLES.has(String(role).trim())) {
      throw ApiError.badRequest('Invalid role for staff account');
    }
    user.role = role;
  }
  // Only superadmin can move a user to a different restaurant.
  if (restaurant && req.user.role === 'superadmin') user.restaurant = restaurant;
  if (isActive !== undefined) user.isActive = isActive;

  await user.save();
  const obj = user.toObject();
  delete obj.password;
  return ok(res, { user: obj }, 'User updated');
});

exports.deleteUser = asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw ApiError.notFound('User not found');
  if (!isSameRestaurant(req.user, user.restaurant)) throw ApiError.forbidden();

  // Soft delete: deactivate so historical orders keep referencing the account.
  user.isActive = false;
  await user.save();
  const obj = user.toObject();
  delete obj.password;
  return ok(res, { user: obj }, 'User deleted successfully');
});
