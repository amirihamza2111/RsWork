const mongoose = require('mongoose');
const Order = require('../models/Order');
const MenuItem = require('../models/MenuItem');
const Recommendation = require('../models/Recommendation');

const LOOKBACK_DAYS = 90;
const MAX_RECS_PER_ITEM = 5;
const STALE_MS = 24 * 60 * 60 * 1000; // recompute at most once per day
const oid = (value) => new mongoose.Types.ObjectId(String(value));

// Avoid two requests recomputing the same restaurant at once.
const inFlight = new Set();

/**
 * Market-basket analysis: for every pair of items that appear together in an
 * order, count co-occurrences and derive a confidence score, then persist the
 * top recommendations per item.
 */
async function computeForRestaurant(restaurantId) {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const orders = await Order.find({
    restaurant: restaurantId,
    status: { $ne: 'cancelled' },
    createdAt: { $gte: since },
  })
    .select('items.menuItem')
    .lean();

  const support = new Map(); // item -> number of orders containing it
  const pairs = new Map(); // item a -> Map(item b -> co-occurrence count)

  for (const order of orders) {
    const ids = [
      ...new Set((order.items || []).map((i) => String(i.menuItem)).filter(Boolean)),
    ];
    for (const a of ids) support.set(a, (support.get(a) || 0) + 1);
    for (const a of ids) {
      for (const b of ids) {
        if (a === b) continue;
        if (!pairs.has(a)) pairs.set(a, new Map());
        const row = pairs.get(a);
        row.set(b, (row.get(b) || 0) + 1);
      }
    }
  }

  const ops = [];
  for (const [a, row] of pairs) {
    const recommendations = [...row.entries()]
      .map(([b, count]) => ({ menuItem: oid(b), count, score: count / (support.get(a) || 1) }))
      .sort((x, y) => y.count - x.count || y.score - x.score)
      .slice(0, MAX_RECS_PER_ITEM);

    ops.push({
      updateOne: {
        filter: { restaurant: oid(restaurantId), item: oid(a) },
        update: { $set: { recommendations, generatedAt: new Date() } },
        upsert: true,
      },
    });
  }

  // Replace the whole set so removed items don't linger.
  await Recommendation.deleteMany({ restaurant: oid(restaurantId) });
  if (ops.length) await Recommendation.bulkWrite(ops);

  return { ordersAnalyzed: orders.length, antecedents: ops.length };
}

async function ensureFresh(restaurantId) {
  const latest = await Recommendation.findOne({ restaurant: oid(restaurantId) })
    .select('generatedAt')
    .sort({ generatedAt: -1 })
    .lean();

  const fresh = latest && Date.now() - new Date(latest.generatedAt).getTime() < STALE_MS;
  if (fresh) return;

  const key = String(restaurantId);
  if (inFlight.has(key)) return; // another request is already recomputing
  inFlight.add(key);
  try {
    await computeForRestaurant(restaurantId);
  } finally {
    inFlight.delete(key);
  }
}

// Fallback when there are no basket signals yet: the best-selling available items.
async function popularItems(restaurantId, excludeIds, limit) {
  const top = await Order.aggregate([
    { $match: { restaurant: oid(restaurantId), status: { $ne: 'cancelled' } } },
    { $unwind: '$items' },
    { $group: { _id: '$items.menuItem', qty: { $sum: '$items.quantity' } } },
    { $sort: { qty: -1 } },
    { $limit: limit + excludeIds.length },
  ]);

  const exclude = new Set(excludeIds.map(String));
  const ids = top.map((t) => t._id).filter((id) => !exclude.has(String(id)));

  const items = await MenuItem.find({
    _id: { $in: ids },
    restaurant: restaurantId,
    isAvailable: true,
  }).select('name price image category prepStation');

  const byId = new Map(items.map((i) => [String(i._id), i]));
  return ids.map((id) => byId.get(String(id))).filter(Boolean).slice(0, limit);
}

/**
 * Recommend items to add, given the items currently in the cart.
 * Scores candidates by total co-occurrence across all cart items.
 */
async function getRecommendations(restaurantId, cartItemIds = [], limit = 4) {
  await ensureFresh(restaurantId);

  const cart = cartItemIds.map(String).filter(Boolean);
  if (cart.length === 0) {
    return popularItems(restaurantId, [], limit);
  }

  const docs = await Recommendation.find({
    restaurant: oid(restaurantId),
    item: { $in: cart.map(oid) },
  }).lean();

  const scores = new Map();
  for (const doc of docs) {
    for (const rec of doc.recommendations || []) {
      const key = String(rec.menuItem);
      scores.set(key, (scores.get(key) || 0) + rec.count);
    }
  }
  for (const id of cart) scores.delete(id); // never recommend what's already chosen

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  if (ranked.length === 0) {
    return popularItems(restaurantId, cart, limit);
  }

  const items = await MenuItem.find({
    _id: { $in: ranked.slice(0, limit * 3).map(oid) },
    restaurant: restaurantId,
    isAvailable: true,
  }).select('name price image category prepStation');

  const byId = new Map(items.map((i) => [String(i._id), i]));
  return ranked.map((id) => byId.get(id)).filter(Boolean).slice(0, limit);
}

module.exports = { computeForRestaurant, getRecommendations };
