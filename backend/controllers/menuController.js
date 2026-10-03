const menu = require('../db/menu');
const { deleteByPublicUrl } = require('../services/storageService');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { ok, created } = require('../utils/apiResponse');
const { toId, isSameRestaurant } = require('../utils/scope');
const recommendationService = require('../services/recommendationService');
const cache = require('../utils/microCache');

// Bust every cached menu read for a restaurant after any menu mutation.
const bustMenuCache = (restaurantId) => cache.delPrefix(`menu:${toId(restaurantId)}`);

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

const parseAllergens = (value) => {
  const parsed = parseMaybeJson(value);
  if (parsed === undefined || parsed === null || parsed === '') return undefined;
  const list = Array.isArray(parsed) ? parsed : String(parsed).split(',');
  return list.map((a) => String(a).trim()).filter(Boolean);
};

const I18N_KEYS = ['ar', 'fr', 'en'];
// Category/item names are trilingual; a missing translation falls back to French.
const parseI18n = (value, { required }) => {
  const parsed = parseMaybeJson(value);
  if (parsed === undefined || parsed === null || parsed === '') return undefined;
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw ApiError.badRequest('Names must be an object with ar, fr and en');
  }
  const out = {};
  for (const key of I18N_KEYS) {
    if (parsed[key] !== undefined && parsed[key] !== null) out[key] = String(parsed[key]);
  }
  if (required) {
    if (!out.fr) throw ApiError.badRequest('French name is required');
    for (const key of I18N_KEYS) if (!out[key]) out[key] = out.fr;
  }
  return out;
};

// Public reads resolve the restaurant from the request; writes resolve it from
// the authenticated manager (so a manager can only write to their own restaurant).
// Falls back to the authenticated user's restaurant so managers don't need to
// pass restaurantId explicitly on GET requests.
const getReadRestaurantId = (req) =>
  req.params.restaurantId ||
  req.query.restaurantId ||
  req.body?.restaurant ||
  toId(req.user?.restaurant);

const getWriteRestaurantId = (req) => {
  if (req.user?.role === 'superadmin') {
    return req.body.restaurant || toId(req.user.restaurant);
  }
  return toId(req.user?.restaurant);
};

const requireOwnCategory = async (categoryId, restaurantId) => {
  const category = await menu.findCategoryById(categoryId);
  if (!category || toId(category.restaurant) !== toId(restaurantId)) {
    throw ApiError.badRequest('Invalid category for this restaurant');
  }
};

/* ----------------------------- Categories ----------------------------- */

exports.createCategory = asyncHandler(async (req, res) => {
  const { name, image, order } = req.body;
  const parsedName = parseI18n(name, { required: true });
  const restaurant = getWriteRestaurantId(req);

  if (!parsedName) throw ApiError.badRequest('Please provide category name');
  if (!restaurant) throw ApiError.badRequest('Restaurant context is required');

  const category = await menu.createCategory({
    name: parsedName,
    restaurantId: restaurant,
    image,
    order: parseNumber(order),
  });

  bustMenuCache(restaurant);
  return created(res, { category }, 'Category created');
});

exports.getCategories = asyncHandler(async (req, res) => {
  const restaurantId = getReadRestaurantId(req);
  if (!restaurantId) throw ApiError.badRequest('restaurantId is required');

  const key = `menu:${toId(restaurantId)}:categories`;
  const cached = cache.get(key);
  if (cached) return ok(res, cached);

  const categories = await menu.listActiveCategories(restaurantId);
  const payload = { count: categories.length, categories };
  cache.set(key, payload);
  return ok(res, payload);
});

exports.updateCategory = asyncHandler(async (req, res) => {
  const { name, image, order, isActive } = req.body;
  const category = await menu.findCategoryById(req.params.id);
  if (!category) throw ApiError.notFound('Category not found');
  if (!isSameRestaurant(req.user, category.restaurant)) throw ApiError.forbidden();

  const parsedName = parseI18n(name, { required: false });
  const updated = await menu.updateCategory(category._id, {
    name: parsedName ? { ...category.name, ...parsedName } : undefined,
    image: image || undefined,
    order: parseNumber(order),
    isActive: parseBoolean(isActive),
  });

  bustMenuCache(category.restaurant);
  return ok(res, { category: updated }, 'Category updated');
});

exports.deleteCategory = asyncHandler(async (req, res) => {
  const category = await menu.findCategoryById(req.params.id);
  if (!category) throw ApiError.notFound('Category not found');
  if (!isSameRestaurant(req.user, category.restaurant)) throw ApiError.forbidden();

  await menu.deleteCategory(category._id);
  bustMenuCache(category.restaurant);
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
  const parsedName = parseI18n(name, { required: true });
  const parsedPrice = parseNumber(price);

  if (!parsedName || parsedPrice === undefined || !category || !restaurant) {
    throw ApiError.badRequest('Please provide required fields: name, price, category');
  }
  await requireOwnCategory(category, restaurant);

  const menuItem = await menu.createItem({
    name: parsedName,
    description: parseI18n(description, { required: false }),
    price: parsedPrice,
    category,
    restaurant,
    image: req.file?.publicUrl || image || undefined,
    isVegetarian: parseBoolean(isVegetarian),
    isGlutenFree: parseBoolean(isGlutenFree),
    allergens: parseAllergens(allergens),
    preparationTime: parseNumber(preparationTime),
    prepStation: prepStation === 'bar' ? 'bar' : 'kitchen',
  });

  bustMenuCache(restaurant);
  return created(res, { menuItem }, 'Menu item created');
});

exports.getMenuItems = asyncHandler(async (req, res) => {
  const { categoryId, isAvailable } = req.query;
  const restaurantId = getReadRestaurantId(req);
  if (!restaurantId) throw ApiError.badRequest('restaurantId is required');

  const key = `menu:${toId(restaurantId)}:items:${categoryId || 'all'}:${isAvailable ?? 'all'}`;
  const cached = cache.get(key);
  if (cached) return ok(res, cached);

  // Only the category is populated — currency/name come from context, and the
  // menu is the hottest read path.
  const menuItems = await menu.listItems({
    restaurantId,
    categoryId: categoryId || undefined,
    isAvailable: isAvailable !== undefined ? isAvailable === 'true' : undefined,
  });
  const payload = { count: menuItems.length, menuItems };
  cache.set(key, payload);
  return ok(res, payload);
});

exports.getMenuItemById = asyncHandler(async (req, res) => {
  const menuItem = await menu.findItemById(req.params.id, { populate: true });
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

  const menuItem = await menu.findItemById(req.params.id);
  if (!menuItem) throw ApiError.notFound('Menu item not found');
  if (!isSameRestaurant(req.user, menuItem.restaurant)) throw ApiError.forbidden();
  if (category) await requireOwnCategory(category, menuItem.restaurant);

  const parsedName = parseI18n(name, { required: false });
  const parsedDescription = parseI18n(description, { required: false });
  const newImage = req.file?.publicUrl || image || undefined;

  const updated = await menu.updateItem(menuItem._id, {
    name: parsedName ? { ...menuItem.name, ...parsedName } : undefined,
    description: parsedDescription ? { ...(menuItem.description || {}), ...parsedDescription } : undefined,
    price: parseNumber(price),
    category: category || undefined,
    image: newImage,
    isAvailable: parseBoolean(isAvailable),
    isVegetarian: parseBoolean(isVegetarian),
    isGlutenFree: parseBoolean(isGlutenFree),
    allergens: parseAllergens(allergens),
    preparationTime: parseNumber(preparationTime),
    prepStation: prepStation === 'kitchen' || prepStation === 'bar' ? prepStation : undefined,
  });

  // Replace the stored image only after the row points at the new one.
  if (req.file?.publicUrl && menuItem.image && menuItem.image !== newImage) {
    await deleteByPublicUrl(menuItem.image);
  }

  bustMenuCache(menuItem.restaurant);
  return ok(res, { menuItem: updated }, 'Menu item updated');
});

exports.deleteMenuItem = asyncHandler(async (req, res) => {
  const menuItem = await menu.findItemById(req.params.id);
  if (!menuItem) throw ApiError.notFound('Menu item not found');
  if (!isSameRestaurant(req.user, menuItem.restaurant)) throw ApiError.forbidden();

  await menu.deleteItem(menuItem._id);
  if (menuItem.image) await deleteByPublicUrl(menuItem.image);
  bustMenuCache(menuItem.restaurant);
  return ok(res, null, 'Menu item deleted successfully');
});

exports.toggleAvailability = asyncHandler(async (req, res) => {
  const menuItem = await menu.findItemById(req.params.id);
  if (!menuItem) throw ApiError.notFound('Menu item not found');
  if (!isSameRestaurant(req.user, menuItem.restaurant)) throw ApiError.forbidden();

  const updated = await menu.toggleItemAvailability(menuItem._id);
  bustMenuCache(menuItem.restaurant);
  return ok(res, { menuItem: updated }, `Menu item ${updated.isAvailable ? 'enabled' : 'disabled'}`);
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
