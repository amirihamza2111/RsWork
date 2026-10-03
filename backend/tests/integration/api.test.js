process.env.DISABLE_RATE_LIMIT = 'true'; // deterministic auth-heavy suite
process.env.RESEND_API_KEY = ''; // don't send real emails during tests

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { sql } = require('../../config/db');
const { supabaseAdmin } = require('../../config/supabase');
const app = require('../../app');
const profiles = require('../../db/profiles');
const restaurants = require('../../db/restaurants');
const { flush } = require('../../realtime');
const { signIn, verifyEmailOtp, verifyRecovery } = require('../helpers/supabaseAuth');

// Every fixture is namespaced by this run id and removed in `after`, so the
// suite can run against a shared Supabase project without touching real data.
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const email = (label) => `${label}.${RUN}@rswork-test.dev`;
const PASSWORD = 'password123';

let server;
let base;
const state = {};
const createdUserIds = new Set();
const createdRestaurantIds = new Set();

const api = (pathname, { method = 'GET', body, token } = {}) =>
  fetch(base + pathname, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

async function createConfirmedUser({ name, role, restaurantId, phone }) {
  const address = email(role);
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: address,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw error;
  createdUserIds.add(data.user.id);
  return profiles.create({ id: data.user.id, name, email: address, role, phone, restaurantId });
}

test.before(async () => {
  const restaurant = await restaurants.create({
    name: `Test Bistro ${RUN}`,
    type: 'restaurant',
    settings: { currency: 'TND', language: 'fr' },
  });
  state.restaurantId = restaurant._id;
  createdRestaurantIds.add(restaurant._id);
  state.manager = await createConfirmedUser({
    name: 'Manager',
    role: 'manager',
    restaurantId: restaurant._id,
  });

  server = http.createServer(app).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  server.close();
  await flush();
  for (const id of createdRestaurantIds) {
    await sql`delete from restaurants where id = ${id}`;
  }
  for (const id of createdUserIds) {
    await supabaseAdmin.auth.admin.deleteUser(id).catch(() => {});
  }
  await sql.end({ timeout: 5 });
});

test('auth: protected route rejects requests without a token', async () => {
  const res = await api('/api/reports/dashboard');
  assert.equal(res.status, 401);
});

test('auth: a forged token is rejected', async () => {
  const res = await api('/api/auth/me', { token: 'not.a.real-token' });
  assert.equal(res.status, 401);
});

test('auth: manager signs in with Supabase and the API resolves the profile', async () => {
  const { token, error } = await signIn(state.manager.email, PASSWORD);
  assert.ifError(error);
  state.token = token;

  const res = await api('/api/auth/me', { token });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.success, true);
  assert.equal(json.data.user.role, 'manager');
  assert.equal(json.data.user.restaurant, state.restaurantId);
});

test('menu: manager creates a category', async () => {
  const res = await api('/api/menu/categories', {
    method: 'POST',
    token: state.token,
    body: { name: { fr: 'Plats', en: 'Dishes', ar: 'أطباق' } },
  });
  assert.equal(res.status, 201);
  const json = await res.json();
  state.categoryId = json.data.category._id;
  assert.ok(state.categoryId);
});

test('menu: manager creates a kitchen item and a bar item', async () => {
  const pizza = await api('/api/menu/items', {
    method: 'POST',
    token: state.token,
    body: { name: { fr: 'Pizza', en: 'Pizza', ar: 'بيتزا' }, price: 20, category: state.categoryId, prepStation: 'kitchen' },
  });
  assert.equal(pizza.status, 201);
  state.pizzaId = (await pizza.json()).data.menuItem._id;

  const coke = await api('/api/menu/items', {
    method: 'POST',
    token: state.token,
    body: { name: { fr: 'Coca', en: 'Coke', ar: 'كوكا' }, price: 5, category: state.categoryId, prepStation: 'bar' },
  });
  assert.equal(coke.status, 201);
  state.cokeId = (await coke.json()).data.menuItem._id;
});

test('menu: public menu lists items with their category populated', async () => {
  const res = await api(`/api/menu/items?restaurantId=${state.restaurantId}`);
  assert.equal(res.status, 200);
  const items = (await res.json()).data.menuItems;
  assert.equal(items.length, 2);
  assert.equal(items[0].category.name.fr, 'Plats');
});

test('tables: manager creates a table with a QR code', async () => {
  const res = await api('/api/tables', { method: 'POST', token: state.token, body: { number: 7, capacity: 4 } });
  assert.equal(res.status, 201);
  const json = await res.json();
  state.tableId = json.data.table._id;
  state.tableNumber = json.data.table.number;
  assert.ok(json.data.table.qrCode);
});

test('orders: placing an order ignores client-sent prices (no tampering)', async () => {
  // Public orders require a live table session (QR scan).
  const sess = await api(`/api/tables/${state.tableId}/session`, { method: 'POST' });
  assert.equal(sess.status, 200);
  state.sessionId = (await sess.json()).data.session.id;

  const res = await api('/api/orders', {
    method: 'POST',
    body: {
      table: state.tableId,
      sessionId: state.sessionId,
      items: [
        { menuItem: state.pizzaId, quantity: 2, price: 1 }, // bogus price
        { menuItem: state.cokeId, quantity: 1, price: 1 },
      ],
    },
  });
  assert.equal(res.status, 201);
  const order = (await res.json()).data.order;
  state.orderId = order._id;
  // Server price: 20*2 + 5*1 = 45, NOT the client's 1+1.
  assert.equal(order.totalAmount, 45);
  assert.equal(order.status, 'pending');
  assert.match(order.orderNumber, /^ORD-\d{8}-\d{4}$/);
  const kitchenItem = order.items.find((i) => i.prepStation === 'kitchen');
  const barItem = order.items.find((i) => i.prepStation === 'bar');
  assert.ok(kitchenItem && barItem, 'items routed to kitchen and bar');
  state.kitchenItemId = kitchenItem._id;
});

test('orders: invalid menu item is rejected', async () => {
  const res = await api('/api/orders', {
    method: 'POST',
    body: {
      table: state.tableId,
      sessionId: state.sessionId,
      items: [{ menuItem: '00000000-0000-4000-8000-000000000000', quantity: 1 }],
    },
  });
  assert.equal(res.status, 400);
});

test('kds: board lists the active order', async () => {
  const res = await api('/api/orders/kds', { token: state.token });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.ok(json.data.orders.some((o) => o._id === state.orderId));
});

test('kds: cooking the kitchen item rolls the order to "ready" (drink does not block)', async () => {
  const begin = await api(`/api/orders/${state.orderId}/items/${state.kitchenItemId}/status`, {
    method: 'PATCH',
    token: state.token,
    body: { status: 'preparing' },
  });
  assert.equal(begin.status, 200);
  assert.equal((await begin.json()).data.order.status, 'preparing');

  const ready = await api(`/api/orders/${state.orderId}/items/${state.kitchenItemId}/status`, {
    method: 'PATCH',
    token: state.token,
    body: { status: 'ready' },
  });
  assert.equal(ready.status, 200);
  assert.equal((await ready.json()).data.order.status, 'ready');
});

test('orders: illegal status transition is rejected', async () => {
  const res = await api(`/api/orders/${state.orderId}/status`, {
    method: 'PUT',
    token: state.token,
    body: { status: 'pending' }, // ready -> pending is illegal
  });
  assert.equal(res.status, 400);
});

test('cashier: lookup by table number returns amount due', async () => {
  const res = await api(`/api/orders/active?tableNumber=${state.tableNumber}`, { token: state.token });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.data.totalDue, 45);
  assert.ok(json.data.orders.length >= 1);
});

test('payments: cash payment can be initiated and confirmed', async () => {
  const init = await api('/api/payments/cash', { method: 'POST', token: state.token, body: { orderId: state.orderId } });
  assert.equal(init.status, 200);
  const paymentId = (await init.json()).data.payment._id;

  const confirm = await api('/api/payments/cash/confirm', { method: 'POST', token: state.token, body: { paymentId } });
  assert.equal(confirm.status, 200);
  assert.equal((await confirm.json()).data.payment.status, 'completed');
});

test('payments: confirming without a paymentId does not settle anything', async () => {
  const res = await api('/api/payments/cash/confirm', { method: 'POST', token: state.token, body: {} });
  assert.equal(res.status, 404);
});

test('receipt: a paid order produces a PDF receipt', async () => {
  const res = await api(`/api/payments/order/${state.orderId}/receipt/pdf`, { token: state.token });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /application\/pdf/);
  const buf = Buffer.from(await res.arrayBuffer());
  assert.equal(buf.slice(0, 5).toString(), '%PDF-');
});

test('reports: dashboard returns the standard envelope with metrics', async () => {
  const res = await api('/api/reports/dashboard', { token: state.token });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.success, true);
  assert.equal(json.data.totalOrdersToday, 1);
  assert.equal(json.data.totalRevenueToday, 45);
});

test('reports: top items and peak days are computed in SQL', async () => {
  const top = await api('/api/reports/top-items', { token: state.token });
  assert.equal(top.status, 200);
  const topItems = (await top.json()).data.topItems;
  assert.equal(topItems[0].itemName, 'Pizza');
  assert.equal(topItems[0].totalQuantity, 2);

  const days = await api('/api/reports/peak-days', { token: state.token });
  assert.equal(days.status, 200);
  assert.equal((await days.json()).data.days.length, 7);
});

test('reports: forecast returns a 7-day forecast (ML or fallback)', async () => {
  const res = await api('/api/reports/forecast?horizon=7', { token: state.token });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.data.forecast.length, 7);
  assert.ok(['ml', 'fallback'].includes(json.data.source));
});

test('recommendations: pizza recommends the co-ordered drink', async () => {
  const res = await api(`/api/menu/recommendations?restaurantId=${state.restaurantId}&items=${state.pizzaId}`);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.ok(Array.isArray(json.data.recommendations));
  // The only order pairs pizza with coke, so coke should be recommended.
  assert.ok(json.data.recommendations.some((r) => String(r._id) === String(state.cokeId)));
});

test('ai-report: returns analytics + a narrative (AI or template fallback)', async () => {
  const res = await api('/api/reports/ai-report', { token: state.token });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.ok(json.data.analytics && json.data.narrative);
  assert.equal(typeof json.data.narrative.executiveSummary, 'string');
});

/* --------------------------- Onboarding & auth --------------------------- */

test('onboarding: register-restaurant creates a restaurant + manager awaiting verification', async () => {
  state.ownerEmail = email('owner');
  const res = await api('/api/auth/register-restaurant', {
    method: 'POST',
    body: { restaurantName: `New Bistro ${RUN}`, name: 'Owner', email: state.ownerEmail, password: PASSWORD, currency: 'TND' },
  });
  assert.equal(res.status, 201);
  const d = (await res.json()).data;
  createdUserIds.add(d.user._id);
  createdRestaurantIds.add(d.restaurant._id);
  assert.equal(d.user.role, 'manager');
  assert.equal(d.user.isVerified, false);
  assert.equal(d.restaurant.name, `New Bistro ${RUN}`);
  assert.equal(String(d.restaurant.owner), String(d.user._id));
  assert.ok(d.verifyToken, 'verification code exposed in non-production');
  state.ownerOtp = d.verifyToken;
});

test('onboarding: an unverified account cannot sign in yet', async () => {
  const { error } = await signIn(state.ownerEmail, PASSWORD);
  assert.ok(error, 'sign-in must fail before email confirmation');
  assert.equal(error.code, 'email_not_confirmed');
});

test('onboarding: verifying the emailed code opens a session', async () => {
  const { token, error } = await verifyEmailOtp(state.ownerEmail, state.ownerOtp);
  assert.ifError(error);
  const me = await api('/api/auth/me', { token });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).data.user.isVerified, true);
  state.ownerToken = token;
});

test('onboarding: duplicate email is rejected', async () => {
  const res = await api('/api/auth/register-restaurant', {
    method: 'POST',
    body: { restaurantName: 'Dupe', name: 'Owner2', email: state.ownerEmail, password: PASSWORD },
  });
  assert.equal(res.status, 400);
});

test('auth: change password, then the old one stops working', async () => {
  const { client, error } = await signIn(state.ownerEmail, PASSWORD);
  assert.ifError(error);
  const update = await client.auth.updateUser({ password: 'newpass123' });
  assert.ifError(update.error);

  assert.ifError((await signIn(state.ownerEmail, 'newpass123')).error);
  assert.ok((await signIn(state.ownerEmail, PASSWORD)).error, 'old password rejected');
});

test('auth: forgot + reset password lets the user sign in again', async () => {
  const forgot = await api('/api/auth/forgot-password', { method: 'POST', body: { email: state.ownerEmail } });
  assert.equal(forgot.status, 200);
  const resetToken = (await forgot.json()).data.resetToken; // exposed in non-production
  assert.ok(resetToken);

  const { client, error } = await verifyRecovery(resetToken);
  assert.ifError(error);
  assert.ifError((await client.auth.updateUser({ password: 'reset123' })).error);

  assert.ifError((await signIn(state.ownerEmail, 'reset123')).error);
});

test('auth: forgot-password does not reveal unknown accounts', async () => {
  const res = await api('/api/auth/forgot-password', { method: 'POST', body: { email: email('nobody') } });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).data, null);
});

test('staff: manager creates a cook who can sign in immediately', async () => {
  const cookEmail = email('cook');
  const res = await api('/api/staff', {
    method: 'POST',
    token: state.token,
    body: { name: 'Cook', email: cookEmail, password: PASSWORD, role: 'cook' },
  });
  assert.equal(res.status, 201);
  const cook = (await res.json()).data.user;
  createdUserIds.add(cook._id);
  assert.equal(cook.restaurant, state.restaurantId);
  state.cookId = cook._id;

  const { token, error } = await signIn(cookEmail, PASSWORD);
  assert.ifError(error);
  state.cookToken = token;
  const kds = await api('/api/orders/kds', { token });
  assert.equal(kds.status, 200);
});

test('staff: a deactivated account is locked out of the API and of sign-in', async () => {
  const del = await api(`/api/users/${state.cookId}`, { method: 'DELETE', token: state.token });
  assert.equal(del.status, 200);

  // Existing access tokens stop working immediately (profile is inactive)...
  const me = await api('/api/auth/me', { token: state.cookToken });
  assert.equal(me.status, 401);
  // ...and new sign-ins are refused by Supabase Auth (banned).
  assert.ok((await signIn(email('cook'), PASSWORD)).error);
});

/* ----------------------------- Security ----------------------------- */

test('security (IDOR): public order tracking hides client/waiter PII', async () => {
  // Attach a real customer so the PII distinction is concrete.
  const customer = await createConfirmedUser({ name: 'Cust', role: 'client', phone: '55500000' });
  await sql`update orders set client_id = ${customer._id} where id = ${state.orderId}`;

  // Staff see the customer's PII...
  const staff = await api(`/api/orders/${state.orderId}`, { token: state.token });
  assert.equal(staff.status, 200);
  const staffOrder = (await staff.json()).data.order;
  assert.ok(staffOrder.client && staffOrder.client.email === customer.email, 'staff sees client PII');

  // ...the public tracker does not.
  const anon = await api(`/api/orders/${state.orderId}`);
  assert.equal(anon.status, 200);
  const anonOrder = (await anon.json()).data.order;
  assert.ok(!('client' in anonOrder), 'client redacted for public');
  assert.ok(!('waiter' in anonOrder), 'waiter redacted for public');
});

test('security (cross-tenant): a manager cannot touch another restaurant\'s order', async () => {
  const res = await api(`/api/orders/${state.orderId}/cancel`, { method: 'PUT', token: state.ownerToken });
  assert.equal(res.status, 403);
});

test('security (injection): operator object in a register email is rejected', async () => {
  const res = await api('/api/auth/register', {
    method: 'POST',
    body: { name: 'x', email: { $gt: '' }, password: 'password123' },
  });
  assert.equal(res.status, 400);
});

test('security (query injection): bracket operators in query are ignored', async () => {
  const res = await api('/api/orders?status[$ne]=cancelled', { token: state.token });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray((await res.json()).data.orders));
});

test('security (bad ids): malformed ids return 4xx, never 500', async () => {
  const res = await api('/api/orders/not-a-uuid', { token: state.token });
  assert.ok([400, 404].includes(res.status), `got ${res.status}`);
});

test('security (XSS): feedback comment is stripped of HTML', async () => {
  const res = await api('/api/feedbacks', {
    method: 'POST',
    body: { orderId: state.orderId, rating: 5, comment: '<script>alert(1)</script>Great food' },
  });
  assert.equal(res.status, 201);
  const comment = (await res.json()).data.feedback.comment;
  assert.equal(comment, 'alert(1)Great food');
  assert.ok(!comment.includes('<'));
});

test('security (RLS): the public anon role cannot read tenant tables', async () => {
  const rows = await sql.begin(async (tx) => {
    await tx`set local role anon`;
    return tx`select id from orders limit 1`;
  });
  assert.equal(rows.length, 0);
});

/* ------------------------ Email verification ------------------------ */

test('email: register creates an unverified client and issues a code', async () => {
  state.verifyEmail = email('verify');
  const res = await api('/api/auth/register', {
    method: 'POST',
    body: { name: 'Verif', email: state.verifyEmail, password: PASSWORD },
  });
  assert.equal(res.status, 201);
  const d = (await res.json()).data;
  createdUserIds.add(d.user._id);
  assert.equal(d.user.role, 'client');
  assert.equal(d.user.isVerified, false);
  assert.ok(d.verifyToken, 'code exposed in non-production');
});

test('email: resend-verification issues a working code', async () => {
  const res = await api('/api/auth/resend-verification', { method: 'POST', body: { email: state.verifyEmail } });
  assert.equal(res.status, 200);
  const code = (await res.json()).data.verifyToken;
  assert.ok(code);

  const { token, error } = await verifyEmailOtp(state.verifyEmail, code);
  assert.ifError(error);
  const me = await api('/api/auth/me', { token });
  assert.equal((await me.json()).data.user.isVerified, true);
});

test('email: an invalid verification code is rejected', async () => {
  const { error } = await verifyEmailOtp(state.verifyEmail, '000000');
  assert.ok(error);
});

test('email: resend-verification responds without leaking account existence', async () => {
  const res = await api('/api/auth/resend-verification', { method: 'POST', body: { email: email('ghost') } });
  assert.equal(res.status, 200);
});
