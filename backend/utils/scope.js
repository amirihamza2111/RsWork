// Shared helpers for multi-tenant (per-restaurant) scoping and id comparison.
const ApiError = require('./ApiError');

const toId = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value._id) return String(value._id);
  return String(value);
};

// Returns the restaurant id a user is scoped to, or null for superadmin (no scope).
const getRestaurantScope = (user) => {
  if (!user) return null;
  if (user.role === 'superadmin') return null;
  return toId(user.restaurant);
};

const isSameRestaurant = (user, restaurantValue) => {
  if (!user) return false;
  if (user.role === 'superadmin') return true;
  const scope = getRestaurantScope(user);
  // Clients aren't tenant-bound (their access is checked by ownership); staff
  // without a restaurant (e.g. theirs was deleted) match nothing.
  if (!scope) return user.role === 'client';
  return scope === toId(restaurantValue);
};

// Restaurant filter for staff queries: undefined (= unscoped) for superadmin and
// for non-staff callers (anonymous diners, clients — their access is checked by
// ownership/route guards); throws for staff that lost their restaurant.
const requireStaffScope = (user) => {
  if (!user || user.role === 'superadmin' || user.role === 'client') return undefined;
  const scope = getRestaurantScope(user);
  if (!scope) throw ApiError.forbidden('Restaurant context is required');
  return scope;
};

module.exports = { toId, getRestaurantScope, isSameRestaurant, requireStaffScope };
