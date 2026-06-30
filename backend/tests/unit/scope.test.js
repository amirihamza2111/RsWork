const test = require('node:test');
const assert = require('node:assert');
const { toId, getRestaurantScope, isSameRestaurant } = require('../../utils/scope');

test('toId: handles strings, objects with _id, and falsy values', () => {
  assert.equal(toId('abc'), 'abc');
  assert.equal(toId({ _id: 'xyz' }), 'xyz');
  assert.equal(toId(null), '');
  assert.equal(toId(undefined), '');
});

test('getRestaurantScope: superadmin has no scope (null)', () => {
  assert.equal(getRestaurantScope({ role: 'superadmin', restaurant: 'r1' }), null);
});

test('getRestaurantScope: scoped roles return their restaurant id', () => {
  assert.equal(getRestaurantScope({ role: 'manager', restaurant: 'r1' }), 'r1');
  assert.equal(getRestaurantScope({ role: 'waiter', restaurant: { _id: 'r2' } }), 'r2');
});

test('isSameRestaurant: superadmin matches any restaurant', () => {
  assert.ok(isSameRestaurant({ role: 'superadmin' }, 'anything'));
});

test('isSameRestaurant: scoped user matches only its own restaurant', () => {
  const manager = { role: 'manager', restaurant: 'r1' };
  assert.ok(isSameRestaurant(manager, 'r1'));
  assert.ok(isSameRestaurant(manager, { _id: 'r1' }));
  assert.ok(!isSameRestaurant(manager, 'r2'));
});
