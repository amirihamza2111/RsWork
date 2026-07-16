const Restaurant = require('../models/Restaurant');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { ok, created } = require('../utils/apiResponse');
const { toId } = require('../utils/scope');

exports.createRestaurant = asyncHandler(async (req, res) => {
  const { name, type, address, phone, logo, settings } = req.body;
  if (!name) throw ApiError.badRequest('Please provide restaurant name');

  const restaurant = await Restaurant.create({
    name,
    type,
    address,
    phone,
    logo,
    settings,
    owner: req.user._id,
  });

  return created(res, { restaurant }, 'Restaurant created');
});

// @desc   Every restaurant this user can switch to (the multi-restaurant picker).
//         Owners get all restaurants they own; staff get their scoped one.
// @route  GET /api/restaurants/mine
exports.getMyRestaurants = asyncHandler(async (req, res) => {
  const filter =
    req.user.role === 'superadmin'
      ? {}
      : {
          $or: [
            { owner: req.user._id },
            ...(req.user.restaurant ? [{ _id: req.user.restaurant }] : []),
          ],
        };
  const restaurants = await Restaurant.find(filter).select('name logo settings isActive').sort({ name: 1 });
  return ok(res, { count: restaurants.length, restaurants });
});

exports.getMyRestaurant = asyncHandler(async (req, res) => {
  // Resolve via the user's restaurant ref first (works for any manager/staff),
  // falling back to ownership. Supports multi-manager restaurants.
  let restaurant = null;
  if (req.user.restaurant) {
    restaurant = await Restaurant.findById(req.user.restaurant);
  }
  if (!restaurant) {
    restaurant = await Restaurant.findOne({ owner: req.user._id });
  }
  if (!restaurant) throw ApiError.notFound('Restaurant not found');
  return ok(res, { restaurant });
});

exports.updateRestaurant = asyncHandler(async (req, res) => {
  const { name, address, phone, logo, settings, location, geofenceRadius } = req.body;
  const restaurant = await Restaurant.findById(req.params.id);
  if (!restaurant) throw ApiError.notFound('Restaurant not found');

  // A manager may only update a restaurant they own / are scoped to.
  if (req.user.role !== 'superadmin') {
    const owns = toId(restaurant.owner) === toId(req.user._id);
    const scoped = toId(restaurant._id) === toId(req.user.restaurant);
    if (!owns && !scoped) throw ApiError.forbidden();
  }

  if (name) restaurant.name = name;
  if (address) restaurant.address = address;
  if (phone) restaurant.phone = phone;
  if (logo) restaurant.logo = logo;
  if (settings) restaurant.settings = settings;
  // Geofence config for QR ordering. `location: null` turns the geofence off.
  if (location === null) {
    restaurant.location = undefined;
  } else if (location && typeof location.lat === 'number' && typeof location.lng === 'number') {
    restaurant.location = { lat: location.lat, lng: location.lng };
  }
  if (geofenceRadius != null) restaurant.geofenceRadius = Number(geofenceRadius);
  await restaurant.save();
  return ok(res, { restaurant }, 'Restaurant updated');
});

exports.getAllRestaurants = asyncHandler(async (req, res) => {
  const restaurants = await Restaurant.find().populate('owner', 'name email');
  return ok(res, { count: restaurants.length, restaurants });
});
