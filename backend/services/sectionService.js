/**
 * Waiter sections — automatic table assignment.
 *
 * The system distributes tables among the waiters who are ON THE FLOOR (their
 * waiter board is open and sending heartbeats), round-robin over a shuffled order:
 *   5 tables, waiters X & Y  ->  X: 1, 4, 3   Y: 2, 5
 *
 * Rules:
 *  - The layout re-randomizes once per day (first rebalance of a new day is a
 *    full shuffle) so sections rotate between waiters.
 *  - Within the same day rebalances are STICKY: tables keep their waiter while
 *    that waiter is still online; only orphaned/unassigned tables move (to
 *    the least-loaded waiter). This avoids reshuffling mid-service.
 *  - A manager can force a full reshuffle via POST /api/tables/auto-assign.
 *  - When no waiter is online, assignments are left untouched (ready-order
 *    alerts fall back to broadcasting to all waiters).
 */
const presence = require('../db/presence');
const tables = require('../db/tables');
const restaurants = require('../db/restaurants');
const { planAssignments } = require('../utils/sectionAssign');
const { getIO } = require('../realtime');

// restaurantId -> debounce timer
const pending = new Map();

const dayKey = () => new Date().toISOString().slice(0, 10);

// Debounce so a burst of joins/leaves rebalances once.
function scheduleRebalance(restaurantId) {
  const rid = String(restaurantId);
  if (pending.has(rid)) clearTimeout(pending.get(rid));
  pending.set(
    rid,
    setTimeout(() => {
      pending.delete(rid);
      autoAssignSections(rid).catch(() => {});
    }, 2000)
  );
}

// Called by the waiter board every minute while it is open.
async function waiterHeartbeat(restaurantId, waiterId) {
  const cameOnline = await presence.heartbeat(waiterId, restaurantId);
  if (cameOnline) scheduleRebalance(restaurantId);
  return { cameOnline };
}

async function waiterLeft(waiterId) {
  const restaurantId = await presence.goOffline(waiterId);
  if (restaurantId) scheduleRebalance(restaurantId);
}

const getConnectedWaiters = (restaurantId) => presence.onlineWaiters(String(restaurantId));

async function autoAssignSections(restaurantId, { force = false } = {}) {
  const rid = String(restaurantId);
  const waiters = await getConnectedWaiters(rid);
  if (waiters.length === 0) return { skipped: true, reason: 'no connected waiters' };

  const [restaurant, tableRows] = await Promise.all([
    restaurants.findById(rid),
    tables.listActiveForSections(rid),
  ]);
  if (!restaurant || tableRows.length === 0) return { skipped: true, reason: 'nothing to assign' };

  const today = dayKey();
  const fullShuffle = force || restaurant.sectionsDay !== today;

  const { updates } = planAssignments({
    tables: tableRows.map((t) => ({ id: t.id, assignedWaiter: String(t.assignedWaiterId || '') })),
    waiters,
    fullShuffle,
  });

  await tables.bulkAssignWaiters(updates);
  if (restaurant.sectionsDay !== today) {
    await restaurants.update(rid, { sectionsDay: today });
  }

  getIO()
    .to(`restaurant_${rid}`)
    .emit('sections_updated', { changed: updates.length, waiters: waiters.length });

  return { skipped: false, fullShuffle, changed: updates.length, waiters: waiters.length };
}

module.exports = {
  waiterHeartbeat,
  waiterLeft,
  getConnectedWaiters,
  autoAssignSections,
};
