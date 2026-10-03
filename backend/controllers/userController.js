const { supabaseAdmin } = require('../config/supabase');
const profiles = require('../db/profiles');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { ok, created } = require('../utils/apiResponse');
const { isSameRestaurant, requireStaffScope } = require('../utils/scope');

const MANAGER_ALLOWED_ROLES = new Set(['manager', 'waiter', 'cashier', 'cook']);
// Effectively permanent: Supabase Auth refuses sign-in for banned users.
const DEACTIVATED_BAN = '876000h';

exports.getAllUsers = asyncHandler(async (req, res) => {
  // Superadmin sees everyone; a manager sees only their restaurant's staff.
  const users = await profiles.list({ restaurantId: requireStaffScope(req.user) });
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

  if (await profiles.emailExists(normalizedEmail)) {
    throw ApiError.badRequest('Email already in use');
  }

  const resolvedRestaurant =
    creatorRole === 'superadmin' ? restaurant || req.user.restaurant : req.user.restaurant;
  if (!resolvedRestaurant) {
    throw ApiError.badRequest('Restaurant context is required');
  }

  // Staff accounts are created by their manager with a known password, so the
  // email is treated as confirmed (no self-signup verification step).
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: normalizedEmail,
    password,
    email_confirm: true,
    user_metadata: { name },
  });
  if (error) throw ApiError.badRequest(error.message);

  let user;
  try {
    user = await profiles.create({
      id: data.user.id,
      name,
      email: normalizedEmail,
      phone,
      role: normalizedRole,
      restaurantId: resolvedRestaurant,
    });
  } catch (err) {
    await supabaseAdmin.auth.admin.deleteUser(data.user.id).catch(() => {});
    throw err;
  }

  return created(res, { user }, 'Staff account created');
});

exports.getUserById = asyncHandler(async (req, res) => {
  const user = await profiles.findById(req.params.id);
  if (!user) throw ApiError.notFound('User not found');
  if (!isSameRestaurant(req.user, user.restaurant)) throw ApiError.forbidden();
  return ok(res, { user });
});

exports.updateUser = asyncHandler(async (req, res) => {
  const { name, phone, role, isActive, restaurant, email } = req.body;
  const user = await profiles.findById(req.params.id);
  if (!user) throw ApiError.notFound('User not found');
  if (!isSameRestaurant(req.user, user.restaurant)) throw ApiError.forbidden();

  if (role && req.user.role !== 'superadmin' && !MANAGER_ALLOWED_ROLES.has(String(role).trim())) {
    throw ApiError.badRequest('Invalid role for staff account');
  }

  const normalizedEmail = email !== undefined ? String(email).trim().toLowerCase() : undefined;
  const authPatch = {};
  if (normalizedEmail && normalizedEmail !== user.email) {
    authPatch.email = normalizedEmail;
    authPatch.email_confirm = true;
  }
  if (isActive !== undefined && Boolean(isActive) !== user.isActive) {
    authPatch.ban_duration = isActive ? 'none' : DEACTIVATED_BAN;
  }
  if (Object.keys(authPatch).length) {
    const { error } = await supabaseAdmin.auth.admin.updateUserById(user._id, authPatch);
    if (error) throw ApiError.badRequest(error.message);
  }

  const updated = await profiles.update(user._id, {
    name,
    phone,
    email: normalizedEmail,
    role: role || undefined,
    // Only superadmin can move a user to a different restaurant.
    restaurantId: restaurant && req.user.role === 'superadmin' ? restaurant : undefined,
    isActive: isActive !== undefined ? Boolean(isActive) : undefined,
  });
  return ok(res, { user: updated }, 'User updated');
});

exports.deleteUser = asyncHandler(async (req, res) => {
  const user = await profiles.findById(req.params.id);
  if (!user) throw ApiError.notFound('User not found');
  if (!isSameRestaurant(req.user, user.restaurant)) throw ApiError.forbidden();

  // Soft delete: deactivate (and block sign-in) so historical orders keep
  // referencing the account.
  await supabaseAdmin.auth.admin.updateUserById(user._id, { ban_duration: DEACTIVATED_BAN });
  const updated = await profiles.update(user._id, { isActive: false });
  return ok(res, { user: updated }, 'User deleted successfully');
});
