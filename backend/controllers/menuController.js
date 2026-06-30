const Category = require('../models/Category');
const MenuItem = require('../models/MenuItem');
const cloudinary = require('../config/cloudinary');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { ok, created } = require('../utils/apiResponse');
const { toId, isSameRestaurant } = require('../utils/scope');
const recommendationService = require('../services/recommendationService');

const parseMaybeJson = (value) => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const parseBoolean = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return Boolean(value);
};

const parseNumber = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
};

// Public reads resolve the restaurant from the request; writes resolve it from
// the authenticated manager (so a manager can only write to their own restaurant).
const getReadRestaurantId = (req) =>
  req.params.restaurantId || req.query.restaurantId || req.body.restaurant;

const getWriteRestaurantId = (req) => {
  if (req.user?.role === 'superadmin') {
    return req.body.restaurant || toId(req.user.restaurant);
  }
  return toId(req.user?.restaurant);
};

const extractCloudinaryPublicId = (urlValue) => {
  try {
    const parsed = new URL(String(urlValue || ''));
    const marker = '/upload/';
    const idx = parsed.pathname.indexOf(marker);
    if (idx === -1) return null;

    let pathAfter = parsed.pathname.slice(idx + marker.length).replace(/^v\d+\//, '');
    if (!pathAfter) return null;

    const lastDot = pathAfter.lastIndexOf('.');
    if (lastDot > 0) pathAfter = pathAfter.slice(0, lastDot);
    return pathAfter || null;
  } catch {
    return null;
  }
};

const deleteCloudinaryImage = async (imageUrl) => {
  const publicId = extractCloudinaryPublicId(imageUrl);
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
  } catch {
    // Ignore cleanup failures so they don't block core CRUD.
  }
};

/* ----------------------------- Categories ----------------------------- */

exports.createCategory = asyncHandler(async (req, res) => {
  const { name, image, order } = req.body;
  const parsedName = parseMaybeJson(name);
  const restaurant = getWriteRestaurantId(req);

  if (!parsedName) throw ApiError.badRequest('Please provide category name');
  if (!restaurant) throw ApiError.badRequest('Restaurant context is required');

  const category = await Category.create({
    name: parsedName,
    restaurant,
    image,
    order: parseNumber(order),
  });

  return created(res, { category }, 'Category created');
});

exports.getCategories = asyncHandler(async (req, res) => {
  const restaurantId = getReadRestaurantId(req);
  if (!restaurantId) throw ApiError.badRequest('restaurantId is required');

  const categories = await Category.find({ restaurant: restaurantId, isActive: true }).sort({
    order: 1,
  });
  return ok(res, { count: categories.length, categories });
});

exports.updateCategory = asyncHandler(async (req, res) => {
  const { name, image, order, isActive } = req.body;
  const category = await Category.findById(req.params.id);
  if (!category) throw ApiError.notFound('Category not found');
  if (!isSameRestaurant(req.user, category.restaurant)) throw ApiError.forbidden();

  const parsedName = parseMaybeJson(name);
  const parsedOrder = parseNumber(order);
  if (parsedName) category.name = parsedName;
  if (image) category.image = image;
  if (parsedOrder !== undefined) category.order = parsedOrder;
  if (isActive !== undefined) category.isActive = parseBoolean(isActive);

  await category.save();
  return ok(res, { category }, 'Category updated');
});

exports.deleteCategory = asyncHandler(async (req, res) => {
  const category = await Category.findById(req.params.id);
  if (!category) throw ApiError.notFound('Category not found');
  if (!isSameRestaurant(req.user, category.restaurant)) throw ApiError.forbidden();

  await category.deleteOne();
  return ok(res, null, 'Category deleted successfully');
});

/* ----------------------------- Menu items ----------------------------- */

exports.createMenuItem = asyncHandler(async (req, res) => {
  const {
    name,
    description,
    price,
    category,
    image,
    isVegetarian,
    isGlutenFree,
    allergens,
    preparationTime,
    prepStation,
  } = req.body;

  const restaurant = getWriteRestaurantId(req);
  const parsedName = parseMaybeJson(name);
  const parsedPrice = parseNumber(price);

  if (!parsedName || parsedPrice === undefined || !category || !restaurant) {
    throw ApiError.badRequest('Please provide required fields: name, price, category');
  }

  const menuItem = await MenuItem.create({
    name: parsedName,
    description: parseMaybeJson(description),
    price: parsedPrice,
    category,
    restaurant,
    image: req.file?.cloudinaryUrl || image,
    isVegetarian: parseBoolean(isVegetarian),
    isGlutenFree: parseBoolean(isGlutenFree),
    allergens: parseMaybeJson(allergens),
    preparationTime: parseNumber(preparationTime),
    prepStation: prepStation === 'bar' ? 'bar' : 'kitchen',
  });

  return created(res, { menuItem }, 'Menu item created');
});

exports.getMenuItems = asyncHandler(async (req, res) => {
  const { categoryId, isAvailable } = req.query;
  const restaurantId = getReadRestaurantId(req);
  if (!restaurantId) throw ApiError.badRequest('restaurantId is required');

  const filter = { restaurant: restaurantId };
  if (categoryId) filter.category = categoryId;
  if (isAvailable !== undefined) filter.isAvailable = isAvailable === 'true';

  const menuItems = await MenuItem.find(filter).populate('category').populate('restaurant');
  return ok(res, { count: menuItems.length, menuItems });
});

exports.getMenuItemById = asyncHandler(async (req, res) => {
  const menuItem = await MenuItem.findById(req.params.id)
    .populate('category')
    .populate('restaurant');
  if (!menuItem) throw ApiError.notFound('Menu item not found');
  return ok(res, { menuItem });
});

exports.updateMenuItem = asyncHandler(async (req, res) => {
  const {
    name,
    description,
    price,
    image,
    category,
    isAvailable,
    isVegetarian,
    isGlutenFree,
    allergens,
    preparationTime,
    prepStation,
  } = req.body;

  const menuItem = await MenuItem.findById(req.params.id);
  if (!menuItem) throw ApiError.notFound('Menu item not found');
  if (!isSameRestaurant(req.user, menuItem.restaurant)) throw ApiError.forbidden();

  const parsedName = parseMaybeJson(name);
  const parsedDescription = parseMaybeJson(description);
  const parsedPrice = parseNumber(price);
  const parsedAvailable = parseBoolean(isAvailable);
  const parsedVegetarian = parseBoolean(isVegetarian);
  const parsedGlutenFree = parseBoolean(isGlutenFree);
  const parsedAllergens = parseMaybeJson(allergens);
  const parsedPrepTime = parseNumber(preparationTime);
  const normalizedImage = req.file?.cloudinaryUrl || image;

  if (parsedName) menuItem.name = parsedName;
  if (parsedDescription) menuItem.description = parsedDescription;
  if (parsedPrice !== undefined) menuItem.price = parsedPrice;
  if (category) menuItem.category = category;
  if (normalizedImage) {
    if (req.file?.cloudinaryUrl && menuItem.image && menuItem.image !== normalizedImage) {
      await deleteCloudinaryImage(menuItem.image);
    }
    menuItem.image = normalizedImage;
  }
  if (parsedAvailable !== undefined) menuItem.isAvailable = parsedAvailable;
  if (parsedVegetarian !== undefined) menuItem.isVegetarian = parsedVegetarian;
  if (parsedGlutenFree !== undefined) menuItem.isGlutenFree = parsedGlutenFree;
  if (parsedAllergens !== undefined) menuItem.allergens = parsedAllergens;
  if (parsedPrepTime !== undefined) menuItem.preparationTime = parsedPrepTime;
  if (prepStation === 'kitchen' || prepStation === 'bar') menuItem.prepStation = prepStation;

  await menuItem.save();
  return ok(res, { menuItem }, 'Menu item updated');
});

exports.deleteMenuItem = asyncHandler(async (req, res) => {
  const menuItem = await MenuItem.findById(req.params.id);
  if (!menuItem) throw ApiError.notFound('Menu item not found');
  if (!isSameRestaurant(req.user, menuItem.restaurant)) throw ApiError.forbidden();

  if (menuItem.image) await deleteCloudinaryImage(menuItem.image);
  await menuItem.deleteOne();
  return ok(res, null, 'Menu item deleted successfully');
});

exports.toggleAvailability = asyncHandler(async (req, res) => {
  const menuItem = await MenuItem.findById(req.params.id);
  if (!menuItem) throw ApiError.notFound('Menu item not found');
  if (!isSameRestaurant(req.user, menuItem.restaurant)) throw ApiError.forbidden();

  menuItem.isAvailable = !menuItem.isAvailable;
  await menuItem.save();
  return ok(res, { menuItem }, `Menu item ${menuItem.isAvailable ? 'enabled' : 'disabled'}`);
});

/* -------------------------- Recommendations --------------------------- */

// @desc   Upsell suggestions for the client cart ("frequently bought together")
// @route  GET /api/menu/recommendations?restaurantId=&items=id1,id2&limit=4
// @access Public
exports.getRecommendations = asyncHandler(async (req, res) => {
  const restaurantId = getReadRestaurantId(req);
  if (!restaurantId) throw ApiError.badRequest('restaurantId is required');

  const cartItemIds = String(req.query.items || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  const limit = Math.min(Math.max(Number(req.query.limit) || 4, 1), 10);
  const recommendations = await recommendationService.getRecommendations(
    restaurantId,
    cartItemIds,
    limit
  );

  return ok(res, { count: recommendations.length, recommendations });
});

// @desc   Force-recompute the recommendation model for the manager's restaurant
// @route  POST /api/menu/recommendations/refresh
// @access Manager / Superadmin
exports.refreshRecommendations = asyncHandler(async (req, res) => {
  const restaurantId = getWriteRestaurantId(req);
  if (!restaurantId) throw ApiError.badRequest('Restaurant context is required');

  const result = await recommendationService.computeForRestaurant(restaurantId);
  return ok(res, result, 'Recommendations recomputed');
});
