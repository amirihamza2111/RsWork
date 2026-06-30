const test = require('node:test');
const assert = require('node:assert');
const {
  canTransitionOrder,
  canTransitionItem,
  deriveOrderStatus,
} = require('../../utils/orderWorkflow');

test('order transitions: valid forward moves are allowed', () => {
  assert.ok(canTransitionOrder('pending', 'preparing'));
  assert.ok(canTransitionOrder('preparing', 'ready'));
  assert.ok(canTransitionOrder('ready', 'served'));
  assert.ok(canTransitionOrder('pending', 'cancelled'));
});

test('order transitions: backward / terminal moves are blocked', () => {
  assert.ok(!canTransitionOrder('served', 'preparing'));
  assert.ok(!canTransitionOrder('ready', 'pending'));
  assert.ok(!canTransitionOrder('cancelled', 'pending'));
});

test('item transitions: queue -> preparing -> ready -> served', () => {
  assert.ok(canTransitionItem('queued', 'preparing'));
  assert.ok(canTransitionItem('preparing', 'ready'));
  assert.ok(canTransitionItem('ready', 'served'));
  assert.ok(canTransitionItem('queued', 'served')); // drinks can skip cooking
  assert.ok(!canTransitionItem('served', 'ready'));
});

const order = (statuses, stations) => ({
  status: 'pending',
  items: statuses.map((s, i) => ({ status: s, prepStation: (stations && stations[i]) || 'kitchen' })),
});

test('deriveOrderStatus: all queued -> pending', () => {
  assert.equal(deriveOrderStatus(order(['queued', 'queued'])), 'pending');
});

test('deriveOrderStatus: any started -> preparing', () => {
  assert.equal(deriveOrderStatus(order(['preparing', 'queued'])), 'preparing');
});

test('deriveOrderStatus: all kitchen items ready -> ready', () => {
  assert.equal(deriveOrderStatus(order(['ready', 'ready'])), 'ready');
});

test('deriveOrderStatus: queued drink does not block ready when kitchen is done', () => {
  assert.equal(deriveOrderStatus(order(['ready', 'queued'], ['kitchen', 'bar'])), 'ready');
});

test('deriveOrderStatus: all served -> served', () => {
  assert.equal(deriveOrderStatus(order(['served', 'served'])), 'served');
});

test('deriveOrderStatus: cancelled stays cancelled', () => {
  const o = order(['queued']);
  o.status = 'cancelled';
  assert.equal(deriveOrderStatus(o), 'cancelled');
});
