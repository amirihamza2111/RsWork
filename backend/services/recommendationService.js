const { isUuid } = require('../db/mappers');
const menu = require('../db/menu');
const reports = require('../db/reports');
const recommendations = require('../db/recommendations');

const LOOKBACK_DAYS = 90;
const MAX_RECS_PER_ITEM = 5;
const STALE_MS = 24 * 60 * 60 * 1000; // recompute at most once per day

// Avoid two requests recomputing the same restaurant at once.
const inFlight = new Set();

/**
 * Market-basket analysis: for every pair of items that appear together in an
 * order, count co-occurrences (a self-join on order_items) and derive a
 * confidence score, then persist the top recommendations per item.
 */
async function computeForRestaurant(restaurantId) {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const { ordersAnalyzed, support, pairs } = await reports.basket(restaurantId, since);

  const supportById = new Map(support.map((s) => [s.menuItemId, s.orders]));
  const grouped = new Map();
  for (const pair of pairs) {
    if (!grouped.has(pair.itemId)) grouped.set(pair.itemId, []);
    grouped.get(pair.itemId).push({
      menuItem: pair.otherId,
      count: pair.count,
      score: pair.count / (supportById.get(pair.itemId) || 1),
    });
  }

  const model = new Map();
  for (const [itemId, recs] of grouped) {
    model.set(
      itemId,
      recs.sort((x, y) => y.count - x.count || y.score - x.score).slice(0, MAX_RECS_PER_ITEM)
    );
  }

  // Replace the whole set so removed items don't linger.
  await recommendations.replaceAll(restaurantId, model);
  return { ordersAnalyzed, antecedents: model.size };
}

async function ensureFresh(restaurantId) {
  const latest = await recommendations.latestGeneratedAt(restaurantId);
  if (latest && Date.now() - new Date(latest).getTime() < STALE_MS) return;

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
  const top = await reports.topItems(restaurantId, { limit: limit + excludeIds.length });
  const exclude = new Set(excludeIds.map(String));
  const ids = top.map((t) => t.menuItemId).filter((id) => id && !exclude.has(id));
  return (await menu.findAvailableBrief(ids, restaurantId)).slice(0, limit);
}

/**
 * Recommend items to add, given the items currently in the cart.
 * Scores candidates by total co-occurrence across all cart items.
 */
async function getRecommendations(restaurantId, cartItemIds = [], limit = 4) {
  if (!isUuid(restaurantId)) return [];
  await ensureFresh(restaurantId);

  const cart = [...new Set(cartItemIds.map(String).filter(isUuid))];
  if (cart.length === 0) return popularItems(restaurantId, [], limit);

  const inCart = new Set(cart);
  const ranked = (await recommendations.scoresForCart(restaurantId, cart))
    .map((row) => row.menuItemId)
    .filter((id) => !inCart.has(id)); // never recommend what's already chosen

  if (ranked.length === 0) return popularItems(restaurantId, cart, limit);
  return (await menu.findAvailableBrief(ranked.slice(0, limit * 3), restaurantId)).slice(0, limit);
}

module.exports = { computeForRestaurant, getRecommendations };
