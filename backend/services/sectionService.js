/**
 * Waiter sections — automatic table assignment.
 *
 * The system distributes tables among the waiters who are CONNECTED (their
 * socket is online), round-robin over a shuffled order:
 *   5 tables, waiters X & Y  ->  X: 1, 4, 3   Y: 2, 5
 *
 * Rules:
 *  - The layout re-randomizes once per day (first rebalance of a new day is a
 *    full shuffle) so sections rotate between waiters.
 *  - Within the same day rebalances are STICKY: tables keep their waiter while
 *    that waiter is still connected; only orphaned/unassigned tables move (to
 *    the least-loaded waiter). This avoids reshuffling mid-service.
 *  - A manager can force a full reshuffle via POST /api/tables/auto-assign.
 *  - When no waiter is connected, assignments are left untouched (ready-order
 *    alerts fall back to broadcasting to all waiters).
 */
const Table = require('../models/Table');
const Restaurant = require('../models/Restaurant');
const { planAssignments } = require('../utils/sectionAssign');

// restaurantId -> Map<waiterId, live connection count>
const connected = new Map();
// restaurantId -> debounce timer
const pending = new Map();

const dayKey = () => new Date().toISOString().slice(0, 10);

function waiterConnected(restaurantId, waiterId) {
  const rid = String(restaurantId);
  const wid = String(waiterId);
  if (!connected.has(rid)) connected.set(rid, new Map());
  const m = connected.get(rid);
  m.set(wid, (m.get(wid) || 0) + 1);
  scheduleRebalance(rid);
}

function waiterDisconnected(restaurantId, waiterId) {
  const rid = String(restaurantId);
  const wid = String(waiterId);
  const m = connected.get(rid);
  if (!m) return;
  const next = (m.get(wid) || 1) - 1;
  if (next <= 0) m.delete(wid);
  else m.set(wid, next);
  scheduleRebalance(rid);
}

const getConnectedWaiters = (restaurantId) =>
  [...(connected.get(String(restaurantId))?.keys() ?? [])];

// Debounce so a burst of connects (page refresh, reconnects) rebalances once.
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

async function autoAssignSections(restaurantId, { force = false } = {}) {
  const rid = String(restaurantId);
  const waiters = getConnectedWaiters(rid);
  if (waiters.length === 0) return { skipped: true, reason: 'no connected waiters' };

  const [restaurant, tables] = await Promise.all([
    Restaurant.findById(rid).select('sectionsDay'),
    Table.find({ restaurant: rid, isActive: true }).sort({ number: 1 }),
  ]);
  if (!restaurant || tables.length === 0) return { skipped: true, reason: 'nothing to assign' };

  const today = dayKey();
  const fullShuffle = force || restaurant.sectionsDay !== today;

  const { updates } = planAssignments({
    tables: tables.map((t) => ({ id: t._id, assignedWaiter: String(t.assignedWaiter || '') })),
    waiters,
    fullShuffle,
  });

  if (updates.length > 0) {
    await Table.bulkWrite(
      updates.map((u) => ({
        updateOne: { filter: { _id: u.id }, update: { $set: { assignedWaiter: u.waiter } } },
      }))
    );
  }
  if (restaurant.sectionsDay !== today) {
    restaurant.sectionsDay = today;
    await restaurant.save();
  }

  // Lazy require avoids a circular dependency with sockets/index.js.
  // eslint-disable-next-line global-require
  const { getIO } = require('../sockets');
  getIO()
    ?.to(`restaurant_${rid}`)
    .emit('sections_updated', { changed: updates.length, waiters: waiters.length });

  return { skipped: false, fullShuffle, changed: updates.length, waiters: waiters.length };
}

module.exports = {
  waiterConnected,
  waiterDisconnected,
  getConnectedWaiters,
  autoAssignSections,
};
