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

exports.getMyRestaurant = asyncHandler(async (req, res) => {
  const restaurant = await Restaurant.findOne({ owner: req.user._id });
  if (!restaurant) throw ApiError.notFound('Restaurant not found');
  return ok(res, { restaurant });
});

exports.updateRestaurant = asyncHandler(async (req, res) => {
  const { name, address, phone, logo, settings } = req.body;
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
  await restaurant.save();
  return ok(res, { restaurant }, 'Restaurant updated');
});

exports.getAllRestaurants = asyncHandler(async (req, res) => {
  const restaurants = await Restaurant.find().populate('owner', 'name email');
  return ok(res, { count: restaurants.length, restaurants });
});
