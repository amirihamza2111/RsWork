const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { ok } = require('../utils/apiResponse');
const PushSubscription = require('../models/PushSubscription');
const { toId } = require('../utils/scope');

exports.subscribe = asyncHandler(async (req, res) => {
  const { subscription } = req.body;
  if (!subscription?.endpoint) throw ApiError.badRequest('Invalid push subscription');

  const restaurantId = toId(req.user.restaurant);
  if (!restaurantId) throw ApiError.badRequest('User has no associated restaurant');

  await PushSubscription.findOneAndUpdate(
    { endpoint: subscription.endpoint },
    {
      user: req.user._id,
      restaurant: restaurantId,
      endpoint: subscription.endpoint,
      subscription,
    },
    { upsert: true, new: true }
  );

  ok(res, {}, 'Subscribed to push notifications');
});

exports.unsubscribe = asyncHandler(async (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) throw ApiError.badRequest('endpoint is required');
  await PushSubscription.deleteOne({ endpoint, user: req.user._id });
  ok(res, {}, 'Unsubscribed');
});

exports.getVapidPublicKey = asyncHandler(async (req, res) => {
  const { isConfigured } = require('../services/pushService');
  const config = require('../config');
  ok(res, { publicKey: isConfigured() ? config.vapid.publicKey : null });
});
