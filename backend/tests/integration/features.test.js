/**
 * Integration tests for the newer features: table sessions, geofence,
 * waiter claim, payment guards, multi-restaurant scoping.
 *
 * They exercise the REAL API — a server must be running (API_URL or
 * http://localhost:5000) against the seeded dev database. When the server is
 * unreachable the whole file skips, so `npm test` stays green in CI.
 */
const test = require('node:test');
const assert = require('node:assert');
const { signIn, verifyEmailOtp } = require('../helpers/supabaseAuth');

const BASE = process.env.API_URL || 'http://localhost:5000';
const PASSWORD = 'password123';

const H = (t, rid) => ({
  'Content-Type': 'application/json',
  ...(t ? { Authorization: `Bearer ${t}` } : {}),
  ...(rid ? { 'X-Restaurant-Id': rid } : {}),
});
const j = async (p) => {
  const r = await p;
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const login = async (email) => (await signIn(email, PASSWORD)).token;

let up = false;
let mgr;
let w1;
let w2;
let rid;
let tableId;
let menuItemId;

test.before(async () => {
  try {
    const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(3000) });
    up = r.ok;
  } catch {
    up = false;
  }
  if (!up) return;

  [mgr, w1, w2] = await Promise.all([
    login('manager@rswork.com'),
    login('waiter@rswork.com'),
    login('waiter2@rswork.com'),
  ]);
  const me = await j(fetch(`${BASE}/api/restaurants/me`, { headers: H(mgr) }));
  rid = me.body.data.restaurant._id;
  const tables = await j(fetch(`${BASE}/api/tables`, { headers: H(mgr) }));
  tableId = tables.body.data.tables[0]._id;
  const items = await j(fetch(`${BASE}/api/menu/items?restaurantId=${rid}`));
  menuItemId = items.body.data.menuItems[0]._id;
  // Geofence off for a clean baseline.
  await j(fetch(`${BASE}/api/restaurants/${rid}`, { method: 'PUT', headers: H(mgr), body: JSON.stringify({ location: null }) }));
});

const openSession = async () =>
  (await j(fetch(`${BASE}/api/tables/${tableId}/session`, { method: 'POST', headers: H() }))).body.data.session.id;

const placeOrder = (sessionId, extra = {}) =>
  j(fetch(`${BASE}/api/orders`, {
    method: 'POST',
    headers: H(),
    body: JSON.stringify({ table: tableId, sessionId, items: [{ menuItem: menuItemId, quantity: 1 }], ...extra }),
  }));

test('table sessions: order requires a live matching session', async (t) => {
  if (!up) return t.skip(`server not reachable at ${BASE}`);
  const sid = await openSession();
  assert.equal((await placeOrder(sid)).status, 201, 'valid session accepted');
  assert.equal((await placeOrder(undefined)).status, 403, 'missing session rejected');
  assert.equal((await placeOrder('bogus-session')).status, 403, 'wrong session rejected');
});

test('waiter claim: atomic — exactly one winner, loser gets 409', async (t) => {
  if (!up) return t.skip(`server not reachable at ${BASE}`);
  const sid = await openSession();
  // Ensure the table has no auto-assigned waiter so the order starts unclaimed.
  await j(fetch(`${BASE}/api/tables/${tableId}`, { method: 'PUT', headers: H(mgr), body: JSON.stringify({ assignedWaiter: null }) }));
  const placed = await placeOrder(sid);
  const orderId = placed.body.data.order._id;
  const [a, b] = await Promise.all([
    j(fetch(`${BASE}/api/orders/${orderId}/claim`, { method: 'PUT', headers: H(w1) })),
    j(fetch(`${BASE}/api/orders/${orderId}/claim`, { method: 'PUT', headers: H(w2) })),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
});

test('geofence: blocks far/no-location, allows nearby, disables with null', async (t) => {
  if (!up) return t.skip(`server not reachable at ${BASE}`);
  const HERE = { lat: 36.8065, lng: 10.1815 };
  await j(fetch(`${BASE}/api/restaurants/${rid}`, { method: 'PUT', headers: H(mgr), body: JSON.stringify({ location: HERE, geofenceRadius: 250 }) }));
  try {
    const sid = await openSession();
    assert.equal((await placeOrder(sid, { lat: 36.9, lng: 10.3 })).status, 403, 'far rejected');
    assert.equal((await placeOrder(sid)).status, 403, 'no coords rejected');
    assert.equal((await placeOrder(sid, { lat: HERE.lat + 0.0002, lng: HERE.lng })).status, 201, 'nearby accepted');
  } finally {
    await j(fetch(`${BASE}/api/restaurants/${rid}`, { method: 'PUT', headers: H(mgr), body: JSON.stringify({ location: null }) }));
  }
  const sid2 = await openSession();
  assert.equal((await placeOrder(sid2)).status, 201, 'geofence off again');
});

test('payments: paid orders reject re-initiate and bill requests', async (t) => {
  if (!up) return t.skip(`server not reachable at ${BASE}`);
  const sid = await openSession();
  const orderId = (await placeOrder(sid)).body.data.order._id;
  // settle in cash
  const pay = await j(fetch(`${BASE}/api/payments/cash`, { method: 'POST', headers: H(mgr), body: JSON.stringify({ orderId }) }));
  await j(fetch(`${BASE}/api/payments/cash/confirm`, { method: 'POST', headers: H(mgr), body: JSON.stringify({ paymentId: pay.body.data.payment._id }) }));
  // all further payment attempts must be rejected
  assert.equal((await j(fetch(`${BASE}/api/payments/cash`, { method: 'POST', headers: H(mgr), body: JSON.stringify({ orderId }) }))).status, 400);
  assert.equal((await j(fetch(`${BASE}/api/payments/card/diner`, { method: 'POST', headers: H(), body: JSON.stringify({ orderId }) }))).status, 400);
  assert.equal((await j(fetch(`${BASE}/api/orders/${orderId}/request-bill`, { method: 'POST', headers: H(), body: JSON.stringify({ method: 'cash' }) }))).status, 400);
});

test('multi-restaurant: X-Restaurant-Id scopes data and enforces ownership', async (t) => {
  if (!up) return t.skip(`server not reachable at ${BASE}`);
  const mine = await j(fetch(`${BASE}/api/restaurants/mine`, { headers: H(mgr) }));
  const list = mine.body.data.restaurants;
  if (list.length < 2) return t.skip('needs a second owned restaurant');
  const other = list.find((r) => r._id !== rid);
  const meSwitched = await j(fetch(`${BASE}/api/restaurants/me`, { headers: H(mgr, other._id) }));
  assert.equal(meSwitched.body.data.restaurant._id, other._id, 'switch follows header');
  // A foreign manager must NOT be able to switch into our restaurant.
  const intruderEmail = `intruder${Date.now()}@rswork-test.dev`;
  const reg = await j(fetch(`${BASE}/api/auth/register-restaurant`, {
    method: 'POST', headers: H(),
    body: JSON.stringify({ restaurantName: `Intruder ${Date.now()}`, name: 'Intruder', email: intruderEmail, password: PASSWORD }),
  }));
  const { token: intruderToken } = await verifyEmailOtp(intruderEmail, reg.body.data.verifyToken);
  const stolen = await j(fetch(`${BASE}/api/restaurants/me`, { headers: H(intruderToken, rid) }));
  assert.notEqual(stolen.body?.data?.restaurant?._id, rid, 'ownership enforced');
});

test.after(async () => {
  if (!up) return;
  // Tidy: remove active test orders so staff boards stay clean.
  const orders = await j(fetch(`${BASE}/api/orders?status=pending`, { headers: H(mgr) }));
  for (const o of orders.body?.data?.orders ?? []) {
    await j(fetch(`${BASE}/api/orders/${o._id}/cancel`, { method: 'PUT', headers: H(mgr) }));
  }
});
