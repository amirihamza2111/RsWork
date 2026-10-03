const { supabaseAdmin } = require('../config/supabase');
const profiles = require('../db/profiles');
const restaurants = require('../db/restaurants');
const { isUuid } = require('../db/mappers');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');

// Multi-restaurant switch: an owner with several restaurants (or a superadmin)
// sends X-Restaurant-Id to pick which restaurant the request is scoped to.
// Every downstream controller reads req.user.restaurant, so overriding it here
// scopes the whole API (menu CRUD, tables, orders, reports…) to the selection.
const applyRestaurantSwitch = async (req, user) => {
  const selected = req.headers['x-restaurant-id'];
  if (!selected || !user) return;
  if (!isUuid(selected)) return;
  if (String(user.restaurant || '') === String(selected)) return;

  if (user.role === 'superadmin') {
    user.restaurant = selected;
    return;
  }
  if (user.role === 'manager' && (await restaurants.isOwnedBy(selected, user._id))) {
    user.restaurant = selected;
  }
};

const bearerToken = (req) => {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null;
};

// Verifies a Supabase access token (JWKS, cached) and loads the app profile.
const resolveUser = async (token) => {
  const { data, error } = await supabaseAdmin.auth.getClaims(token);
  if (error || !data?.claims?.sub) return { error: 'Invalid or expired session' };
  const user = await profiles.findById(data.claims.sub);
  if (!user) return { error: 'User not found' };
  if (!user.isActive) return { error: 'Account is deactivated' };
  return { user };
};

exports.protect = asyncHandler(async (req, res, next) => {
  const token = bearerToken(req);
  if (!token) throw ApiError.unauthorized('Not authorized to access this route');

  const { user, error } = await resolveUser(token);
  if (error) throw ApiError.unauthorized(error);

  await applyRestaurantSwitch(req, user);
  req.user = user;
  next();
});

// Attaches req.user when a valid token is present, but never rejects.
// Used by public routes (QR order placement, order tracking) that still want to
// know the caller when they happen to be logged in.
exports.optionalAuth = asyncHandler(async (req, res, next) => {
  const token = bearerToken(req);
  if (!token) return next();
  try {
    const { user } = await resolveUser(token);
    if (user) {
      await applyRestaurantSwitch(req, user);
      req.user = user;
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
