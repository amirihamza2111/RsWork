// Must be set BEFORE requiring config/app so the webhook secret is picked up.
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_rswork';

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const mongoose = require('mongoose');
const Stripe = require('stripe');
const config = require('../../config');
const app = require('../../app');
const Restaurant = require('../../models/Restaurant');
const Order = require('../../models/Order');
const Payment = require('../../models/Payment');

// Own database so it can run alongside the main integration suite safely.
const dbUri = config.dbUri.replace(/(@[^/]+\/)[^?]*/, '$1rswork_test_wh');
const stripeKey = config.stripe.secretKey;
const stripe = Stripe(stripeKey || 'sk_test_dummy');

let server;
let base;

test.before(async () => {
  await mongoose.connect(dbUri, { serverSelectionTimeoutMS: 15000 });
  await mongoose.connection.dropDatabase();
  server = http.createServer(app).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  server.close();
});

test('webhook: a signed payment_intent.succeeded marks payment completed + order paid', async (t) => {
  if (!stripeKey) {
    t.skip('Stripe not configured (no STRIPE_SECRET_KEY)');
    return;
  }

  const restaurant = await Restaurant.create({ name: 'WH Bistro', settings: { currency: 'TND' } });
  const order = await Order.create({
    restaurant: restaurant._id,
    table: new mongoose.Types.ObjectId(),
    items: [{ menuItem: new mongoose.Types.ObjectId(), quantity: 1, price: 10 }],
    totalAmount: 10,
    paymentStatus: 'unpaid',
  });
  const intentId = `pi_test_${Date.now()}`;
  await Payment.create({
    order: order._id,
    restaurant: restaurant._id,
    amount: 10,
    method: 'card',
    status: 'pending',
    stripePaymentIntentId: intentId,
  });

  const payload = JSON.stringify({
    id: 'evt_test',
    object: 'event',
    type: 'payment_intent.succeeded',
    data: { object: { id: intentId } },
  });
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: process.env.STRIPE_WEBHOOK_SECRET,
  });

  const res = await fetch(`${base}/api/payments/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': signature },
    body: payload,
  });
  assert.equal(res.status, 200);

  const updatedPayment = await Payment.findOne({ stripePaymentIntentId: intentId });
  assert.equal(updatedPayment.status, 'completed');
  const updatedOrder = await Order.findById(order._id);
  assert.equal(updatedOrder.paymentStatus, 'paid');
});

test('webhook: an invalid signature is rejected with 400', async (t) => {
  if (!stripeKey) {
    t.skip('Stripe not configured');
    return;
  }
  const res = await fetch(`${base}/api/payments/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'stripe-signature': 'bad-signature' },
    body: '{}',
  });
  assert.equal(res.status, 400);
});
