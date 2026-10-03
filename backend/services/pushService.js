const webpush = require('web-push');
const config = require('../config');
const push = require('../db/push');

let configured = false;
if (config.vapid.publicKey && config.vapid.privateKey) {
  webpush.setVapidDetails(config.vapid.contact, config.vapid.publicKey, config.vapid.privateKey);
  configured = true;
}

// Push to every matching subscription, pruning stale ones (410/404).
async function sendToSubscriptions(filter, payload) {
  if (!configured) return;
  const subs = await push.listFor(filter);
  if (!subs.length) return;

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(sub.subscription, JSON.stringify(payload));
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await push.removeById(sub.id);
        }
      }
    })
  );
}

/**
 * Send a push notification to all subscribed waiters of a restaurant.
 * Used as the fallback when an order has no assigned waiter (open section).
 */
async function sendToRestaurantWaiters(restaurantId, payload) {
  return sendToSubscriptions({ restaurantId }, payload);
}

/**
 * Send a push notification to one specific user's devices (the assigned waiter),
 * so a "ready" order pings only the responsible waiter — not the whole floor.
 */
async function sendToUser(userId, payload) {
  if (!userId) return;
  return sendToSubscriptions({ userId }, payload);
}

module.exports = { sendToRestaurantWaiters, sendToUser, isConfigured: () => configured };
