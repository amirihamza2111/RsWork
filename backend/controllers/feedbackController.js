const feedback = require('../db/feedback');
const orders = require('../db/orders');
const tables = require('../db/tables');
const { isUuid } = require('../db/mappers');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { ok, created } = require('../utils/apiResponse');
const { requireStaffScope, toId } = require('../utils/scope');
const { sanitizeText } = require('../utils/sanitizeText');
const { parsePagination, meta } = require('../utils/pagination');

// @desc   List feedbacks (scoped to the manager's restaurant)
// @route  GET /api/feedbacks
// @access Manager / Superadmin
exports.getFeedbacks = asyncHandler(async (req, res) => {
  const scope = requireStaffScope(req.user);
  const status =
    req.query.status === 'new' || req.query.status === 'reviewed' ? req.query.status : undefined;

  const { page, limit, skip } = parsePagination(req.query);
  const { feedbacks, total } = await feedback.list(
    { restaurantId: scope || undefined, status },
    { limit, offset: skip }
  );

  return ok(res, { count: feedbacks.length, feedbacks, ...meta(total, page, limit) });
});

// @desc   Create feedback (public — left by a diner)
// @route  POST /api/feedbacks
// @access Public
exports.createFeedback = asyncHandler(async (req, res) => {
  const { tableId, orderId, rating, category, comment } = req.body;

  const score = Number(rating);
  if (!rating) throw ApiError.badRequest('Rating is required');
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    throw ApiError.badRequest('Rating must be between 1 and 5');
  }

  // Derive the restaurant from the order or table so feedback is tenant-scoped.
  const order = isUuid(orderId) ? await orders.findById(orderId) : null;
  const table = isUuid(tableId) ? await tables.findById(tableId) : null;
  const restaurant = toId(order?.restaurant) || toId(table?.restaurant) || undefined;

  const created_ = await feedback.create({
    restaurant,
    table: table?._id,
    order: order?._id,
    rating: score,
    category: sanitizeText(category, 50),
    comment: sanitizeText(comment, 500),
  });

  return created(res, { feedback: created_ }, 'Thanks for your feedback');
});

// @desc   Mark feedback reviewed / unreviewed
// @route  PUT /api/feedbacks/:id/reviewed
// @access Manager / Superadmin
exports.updateFeedbackReviewedStatus = asyncHandler(async (req, res) => {
  const { reviewed } = req.body;
  const existing = await feedback.findById(req.params.id);
  if (!existing) throw ApiError.notFound('Feedback not found');

  const scope = requireStaffScope(req.user);
  if (scope && String(existing.restaurant || '') !== scope) {
    throw ApiError.forbidden();
  }

  const updated = await feedback.setReviewed(existing._id, Boolean(reviewed));
  return ok(res, { feedback: updated }, 'Feedback updated');
});

// @desc   Count of unreviewed feedbacks
// @route  GET /api/feedbacks/unread-count
// @access Manager / Superadmin
exports.getUnreadCount = asyncHandler(async (req, res) => {
  const scope = requireStaffScope(req.user);
  const unreadCount = await feedback.countNew(scope || undefined);
  return ok(res, { unreadCount });
});
