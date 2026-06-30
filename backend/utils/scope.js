// Shared helpers for multi-tenant (per-restaurant) scoping and id comparison.

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
  const scope = getRestaurantScope(user);
  if (!scope) return true; // superadmin or unscoped
  return scope === toId(restaurantValue);
};

module.exports = { toId, getRestaurantScope, isSameRestaurant };
