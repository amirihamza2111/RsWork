const Feedback = require('../models/Feedback');
const Order = require('../models/Order');
const Table = require('../models/Table');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { ok, created } = require('../utils/apiResponse');
const { getRestaurantScope } = require('../utils/scope');
const { sanitizeText } = require('../utils/sanitizeText');
const { parsePagination, meta } = require('../utils/pagination');

// @desc   List feedbacks (scoped to the manager's restaurant)
// @route  GET /api/feedbacks
// @access Manager / Superadmin
exports.getFeedbacks = asyncHandler(async (req, res) => {
  const scope = getRestaurantScope(req.user);
  const filter = scope ? { restaurant: scope } : {};
  if (req.query.status === 'new' || req.query.status === 'reviewed') {
    filter.status = req.query.status;
  }

  const { page, limit, skip } = parsePagination(req.query);
  const [feedbacks, total] = await Promise.all([
    Feedback.find(filter)
      .populate('table', 'number')
      .populate('order', 'orderNumber')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Feedback.countDocuments(filter),
  ]);

  return ok(res, { count: feedbacks.length, feedbacks, ...meta(total, page, limit) });
});

// @desc   Create feedback (public — left by a diner)
// @route  POST /api/feedbacks
// @access Public
exports.createFeedback = asyncHandler(async (req, res) => {
  const { tableId, orderId, rating, category, comment } = req.body;

  if (!rating) throw ApiError.badRequest('Rating is required');

  // Derive the restaurant from the order or table so feedback is tenant-scoped.
  let restaurant;
  if (orderId) {
    const order = await Order.findById(orderId).select('restaurant');
    restaurant = order?.restaurant;
  }
  if (!restaurant && tableId) {
    const table = await Table.findById(tableId).select('restaurant');
    restaurant = table?.restaurant;
  }

  const feedback = await Feedback.create({
    restaurant,
    table: tableId || undefined,
    order: orderId || undefined,
    rating,
    category: sanitizeText(category, 50),
    comment: sanitizeText(comment, 500),
  });

  return created(res, { feedback }, 'Thanks for your feedback');
});

// @desc   Mark feedback reviewed / unreviewed
// @route  PUT /api/feedbacks/:id/reviewed
// @access Manager / Superadmin
exports.updateFeedbackReviewedStatus = asyncHandler(async (req, res) => {
  const { reviewed } = req.body;
  const feedback = await Feedback.findById(req.params.id);
  if (!feedback) throw ApiError.notFound('Feedback not found');

  const scope = getRestaurantScope(req.user);
  if (scope && String(feedback.restaurant || '') !== scope) {
    throw ApiError.forbidden();
  }

  feedback.status = reviewed ? 'reviewed' : 'new';
  feedback.reviewedAt = reviewed ? new Date() : null;
  await feedback.save();
  return ok(res, { feedback }, 'Feedback updated');
});

// @desc   Count of unreviewed feedbacks
// @route  GET /api/feedbacks/unread-count
// @access Manager / Superadmin
exports.getUnreadCount = asyncHandler(async (req, res) => {
  const scope = getRestaurantScope(req.user);
  const filter = { status: 'new' };
  if (scope) filter.restaurant = scope;

  const unreadCount = await Feedback.countDocuments(filter);
  return ok(res, { unreadCount });
});
