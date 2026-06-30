// Order & item state machines for the kitchen/serving workflow.

// Order-level lifecycle: pending -> confirmed -> preparing -> ready -> served,
// with cancellation allowed from any non-terminal state.
const ORDER_TRANSITIONS = {
  pending: ['confirmed', 'preparing', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['served', 'cancelled'],
  served: [],
  cancelled: [],
};

// Item-level lifecycle for the KDS Kanban (queue -> in progress -> done -> served).
const ITEM_TRANSITIONS = {
  queued: ['preparing', 'ready', 'served'],
  preparing: ['ready', 'served'],
  ready: ['served'],
  served: [],
};

const ORDER_STATUSES = Object.keys(ORDER_TRANSITIONS);
const ITEM_STATUSES = Object.keys(ITEM_TRANSITIONS);

const canTransitionOrder = (from, to) =>
  Boolean(ORDER_TRANSITIONS[from]) && ORDER_TRANSITIONS[from].includes(to);

const canTransitionItem = (from, to) =>
  Boolean(ITEM_TRANSITIONS[from]) && ITEM_TRANSITIONS[from].includes(to);

// Derive the order-level status from its items' statuses. Drinks (bar items)
// don't need cooking, so kitchen items drive "preparing"/"ready" when present.
const deriveOrderStatus = (order) => {
  if (order.status === 'cancelled') return 'cancelled';

  const items = order.items || [];
  if (items.length === 0) return order.status;

  if (items.every((i) => i.status === 'served')) return 'served';

  const kitchenItems = items.filter((i) => i.prepStation === 'kitchen');
  const progressItems = kitchenItems.length ? kitchenItems : items;

  if (progressItems.every((i) => i.status === 'ready' || i.status === 'served')) {
    return 'ready';
  }

  const anyStarted = items.some((i) => i.status !== 'queued');
  return anyStarted ? 'preparing' : 'pending';
};

module.exports = {
  ORDER_TRANSITIONS,
  ITEM_TRANSITIONS,
  ORDER_STATUSES,
  ITEM_STATUSES,
  canTransitionOrder,
  canTransitionItem,
  deriveOrderStatus,
};
