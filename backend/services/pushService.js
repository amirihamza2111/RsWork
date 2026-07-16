const webpush = require('web-push');
const config = require('../config');
const PushSubscription = require('../models/PushSubscription');

let configured = false;
if (config.vapid.publicKey && config.vapid.privateKey) {
  webpush.setVapidDetails(config.vapid.contact, config.vapid.publicKey, config.vapid.privateKey);
  configured = true;
}

// Push to every subscription matching `filter`, pruning stale ones (410/404).
async function sendToSubscriptions(filter, payload) {
  if (!configured) return;
  const subs = await PushSubscription.find(filter).lean();
  if (!subs.length) return;

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(sub.subscription, JSON.stringify(payload));
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await PushSubscription.deleteOne({ _id: sub._id });
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
  return sendToSubscriptions({ restaurant: restaurantId }, payload);
}

/**
 * Send a push notification to one specific user's devices (the assigned waiter),
 * so a "ready" order pings only the responsible waiter — not the whole floor.
 */
async function sendToUser(userId, payload) {
  if (!userId) return;
  return sendToSubscriptions({ user: userId }, payload);
}

module.exports = { sendToRestaurantWaiters, sendToUser, isConfigured: () => configured };
