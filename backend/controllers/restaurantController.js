const restaurants = require('../db/restaurants');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { ok, created } = require('../utils/apiResponse');
const { toId } = require('../utils/scope');

exports.createRestaurant = asyncHandler(async (req, res) => {
  const { name, type, address, phone, logo, settings } = req.body;
  if (!name) throw ApiError.badRequest('Please provide restaurant name');

  const restaurant = await restaurants.create({
    name,
    type,
    address,
    phone,
    logo,
    settings,
    ownerId: req.user._id,
  });

  return created(res, { restaurant }, 'Restaurant created');
});

// @desc   Every restaurant this user can switch to (the multi-restaurant picker).
//         Owners get all restaurants they own; staff get their scoped one.
// @route  GET /api/restaurants/mine
exports.getMyRestaurants = asyncHandler(async (req, res) => {
  const list = await restaurants.listForUser(req.user);
  return ok(res, { count: list.length, restaurants: list });
});

exports.getMyRestaurant = asyncHandler(async (req, res) => {
  // Resolve via the user's restaurant ref first (works for any manager/staff),
  // falling back to ownership. Supports multi-manager restaurants.
  let restaurant = req.user.restaurant ? await restaurants.findById(req.user.restaurant) : null;
  if (!restaurant) restaurant = await restaurants.findFirstOwnedBy(req.user._id);
  if (!restaurant) throw ApiError.notFound('Restaurant not found');
  return ok(res, { restaurant });
});

exports.updateRestaurant = asyncHandler(async (req, res) => {
  const { name, address, phone, logo, settings, location, geofenceRadius } = req.body;
  const restaurant = await restaurants.findById(req.params.id);
  if (!restaurant) throw ApiError.notFound('Restaurant not found');

  // A manager may only update a restaurant they own / are scoped to.
  if (req.user.role !== 'superadmin') {
    const owns = toId(restaurant.owner) === toId(req.user._id);
    const scoped = toId(restaurant._id) === toId(req.user.restaurant);
    if (!owns && !scoped) throw ApiError.forbidden();
  }

  const patch = {
    name: name || undefined,
    address: address || undefined,
    phone: phone || undefined,
    logo: logo || undefined,
    settings: settings || undefined,
    geofenceRadius: geofenceRadius != null ? Number(geofenceRadius) : undefined,
  };
  // Geofence config for QR ordering. `location: null` turns the geofence off.
  if (location === null) {
    patch.lat = null;
    patch.lng = null;
  } else if (location && typeof location.lat === 'number' && typeof location.lng === 'number') {
    patch.lat = location.lat;
    patch.lng = location.lng;
  }

  const updated = await restaurants.update(restaurant._id, patch);
  return ok(res, { restaurant: updated }, 'Restaurant updated');
});

exports.getAllRestaurants = asyncHandler(async (req, res) => {
  const list = await restaurants.listAllWithOwner();
  return ok(res, { count: list.length, restaurants: list });
});
