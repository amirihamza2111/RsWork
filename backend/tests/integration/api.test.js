process.env.DISABLE_RATE_LIMIT = 'true'; // deterministic auth-heavy suite
process.env.RESEND_API_KEY = ''; // don't send real emails during tests

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const config = require('../../config');
const app = require('../../app');
const User = require('../../models/User');
const Restaurant = require('../../models/Restaurant');

// Run against a dedicated test database so the real `rswork` data is untouched.
const testUri = config.dbUri.replace(/(@[^/]+\/)[^?]*/, '$1rswork_test');

let server;
let base;
const state = {};

const api = (pathname, { method = 'GET', body, token } = {}) =>
  fetch(base + pathname, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

test.before(async () => {
  await mongoose.connect(testUri, { serverSelectionTimeoutMS: 15000 });
  await mongoose.connection.dropDatabase();

  const restaurant = await Restaurant.create({
    name: 'Test Bistro',
    type: 'restaurant',
    settings: { currency: 'TND', language: 'fr' },
  });
  state.restaurantId = String(restaurant._id);
  await User.create({
    name: 'Manager',
    email: 'manager@test.com',
    password: 'password123',
    role: 'manager',
    restaurant: restaurant._id,
  });

  server = http.createServer(app).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  server.close();
});

test('auth: protected route rejects requests without a token', async () => {
  const res = await api('/api/reports/dashboard');
  assert.equal(res.status, 401);
});

test('auth: manager can log in and receive a token', async () => {
  const res = await api('/api/auth/login', {
    method: 'POST',
    body: { email: 'manager@test.com', password: 'password123' },
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.success, true);
  assert.ok(json.data.token);
  assert.equal(json.data.user.role, 'manager');
  state.token = json.data.token;
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

test('tables: manager creates a table with a QR code', async () => {
  const res = await api('/api/tables', { method: 'POST', token: state.token, body: { number: 7, capacity: 4 } });
  assert.equal(res.status, 201);
  const json = await res.json();
  state.tableId = json.data.table._id;
  state.tableNumber = json.data.table.number;
  assert.ok(json.data.table.qrCode);
});

test('orders: placing an order ignores client-sent prices (no tampering)', async () => {
  const res = await api('/api/orders', {
    method: 'POST',
    body: {
      table: state.tableId,
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
  const kitchenItem = order.items.find((i) => i.prepStation === 'kitchen');
  const barItem = order.items.find((i) => i.prepStation === 'bar');
  assert.ok(kitchenItem && barItem, 'items routed to kitchen and bar');
  state.kitchenItemId = kitchenItem._id;
});

test('orders: invalid menu item is rejected', async () => {
  const res = await api('/api/orders', {
    method: 'POST',
    body: { table: state.tableId, items: [{ menuItem: '64b000000000000000000000', quantity: 1 }] },
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
  assert.ok('totalOrdersToday' in json.data);
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

test('onboarding: register-restaurant creates a restaurant + manager + token', async () => {
  const res = await api('/api/auth/register-restaurant', {
    method: 'POST',
    body: { restaurantName: 'New Bistro', name: 'Owner', email: 'owner@newbistro.com', password: 'password123', currency: 'TND' },
  });
  assert.equal(res.status, 201);
  const d = (await res.json()).data;
  assert.ok(d.token);
  assert.equal(d.user.role, 'manager');
  assert.equal(d.restaurant.name, 'New Bistro');
  assert.equal(String(d.restaurant.owner), String(d.user._id));
  state.ownerToken = d.token;
  state.ownerEmail = 'owner@newbistro.com';
});

test('onboarding: duplicate email is rejected', async () => {
  const res = await api('/api/auth/register-restaurant', {
    method: 'POST',
    body: { restaurantName: 'Dupe', name: 'Owner2', email: 'owner@newbistro.com', password: 'password123' },
  });
  assert.equal(res.status, 400);
});

test('auth: change password, then the old one stops working', async () => {
  const change = await api('/api/auth/change-password', {
    method: 'POST',
    token: state.ownerToken,
    body: { currentPassword: 'password123', newPassword: 'newpass123' },
  });
  assert.equal(change.status, 200);

  const fresh = await api('/api/auth/login', { method: 'POST', body: { email: state.ownerEmail, password: 'newpass123' } });
  assert.equal(fresh.status, 200);

  const old = await api('/api/auth/login', { method: 'POST', body: { email: state.ownerEmail, password: 'password123' } });
  assert.equal(old.status, 401);
});

test('auth: forgot + reset password lets the user log in again', async () => {
  const forgot = await api('/api/auth/forgot-password', { method: 'POST', body: { email: state.ownerEmail } });
  assert.equal(forgot.status, 200);
  const resetToken = (await forgot.json()).data.resetToken; // exposed in non-production
  assert.ok(resetToken);

  const reset = await api('/api/auth/reset-password', { method: 'POST', body: { token: resetToken, newPassword: 'reset123' } });
  assert.equal(reset.status, 200);

  const login = await api('/api/auth/login', { method: 'POST', body: { email: state.ownerEmail, password: 'reset123' } });
  assert.equal(login.status, 200);
});

/* ----------------------------- Security ----------------------------- */

test('security (IDOR): public order tracking hides client/waiter PII', async () => {
  const Order = require('../../models/Order');
  // Attach a real customer so the PII distinction is concrete.
  const customer = await User.create({
    name: 'Cust', email: 'cust-idor@test.com', password: 'password123', role: 'client', phone: '55500000',
  });
  await Order.updateOne({ _id: state.orderId }, { $set: { client: customer._id } });

  // Staff see the customer's PII...
  const staff = await api(`/api/orders/${state.orderId}`, { token: state.token });
  assert.equal(staff.status, 200);
  const staffOrder = (await staff.json()).data.order;
  assert.ok(staffOrder.client && staffOrder.client.email === 'cust-idor@test.com', 'staff sees client PII');

  // ...the public tracker does not.
  const anon = await api(`/api/orders/${state.orderId}`);
  assert.equal(anon.status, 200);
  const anonOrder = (await anon.json()).data.order;
  assert.ok(!('client' in anonOrder), 'client redacted for public');
  assert.ok(!('waiter' in anonOrder), 'waiter redacted for public');
});

test('security (NoSQL injection): operator object in login email cannot bypass auth', async () => {
  const res = await api('/api/auth/login', { method: 'POST', body: { email: { $gt: '' }, password: 'x' } });
  assert.ok([400, 401].includes(res.status), `expected 400/401, got ${res.status}`);
});

test('security (query injection): bracket operators in query are ignored', async () => {
  const res = await api('/api/orders?status[$ne]=cancelled', { token: state.token });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray((await res.json()).data.orders));
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

test('security (JWT): a token issued before a password change is rejected', async () => {
  const reg = await api('/api/auth/register', {
    method: 'POST',
    body: { name: 'Temp', email: 'temp-jwt@test.com', password: 'password123' },
  });
  const { token, user } = (await reg.json()).data;

  // Token still works...
  const before = await api('/api/auth/me', { token });
  assert.equal(before.status, 200);

  // Simulate a password change strictly after the token was issued.
  const iat = jwt.decode(token).iat;
  await User.updateOne({ _id: user._id }, { $set: { passwordChangedAt: new Date((iat + 10) * 1000) } });

  const after = await api('/api/auth/me', { token });
  assert.equal(after.status, 401);
});

/* ------------------------ Email verification ------------------------ */

test('email: register creates an unverified account and issues a verify token', async () => {
  const res = await api('/api/auth/register', {
    method: 'POST',
    body: { name: 'Verif', email: 'verify-me@test.com', password: 'password123' },
  });
  assert.equal(res.status, 201);
  const d = (await res.json()).data;
  assert.equal(d.user.isVerified, false);
  assert.ok(d.verifyToken, 'verify token exposed in non-production');
  state.verifyToken = d.verifyToken;
  state.verifyEmail = 'verify-me@test.com';
});

test('email: verify-email marks the account verified', async () => {
  const res = await api('/api/auth/verify-email', { method: 'POST', body: { token: state.verifyToken } });
  assert.equal(res.status, 200);

  const login = await api('/api/auth/login', { method: 'POST', body: { email: state.verifyEmail, password: 'password123' } });
  assert.equal((await login.json()).data.user.isVerified, true);
});

test('email: an invalid verification token is rejected', async () => {
  const res = await api('/api/auth/verify-email', { method: 'POST', body: { token: 'bad-token' } });
  assert.equal(res.status, 400);
});

test('email: resend-verification responds without leaking account existence', async () => {
  const res = await api('/api/auth/resend-verification', { method: 'POST', body: { email: 'verify-me@test.com' } });
  assert.equal(res.status, 200);
});
