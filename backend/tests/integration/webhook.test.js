// Must be set BEFORE requiring config/app so the webhook secret is picked up.
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_rswork';

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const Stripe = require('stripe');
const config = require('../../config');
const { sql } = require('../../config/db');
const app = require('../../app');
const { flush } = require('../../realtime');

const stripeKey = config.stripe.secretKey;
const stripe = Stripe(stripeKey || 'sk_test_dummy');
const RUN = Date.now().toString(36);

let server;
let base;
let restaurantId;

test.before(async () => {
  const [restaurant] = await sql`
    insert into restaurants (name, settings) values (${`WH Bistro ${RUN}`}, ${sql.json({ currency: 'TND' })})
    returning id
  `;
  restaurantId = restaurant.id;
  server = http.createServer(app).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  server.close();
  await flush();
  await sql`delete from restaurants where id = ${restaurantId}`;
  await sql.end({ timeout: 5 });
});

test('webhook: a signed payment_intent.succeeded marks payment completed + order paid', async (t) => {
  if (!stripeKey) {
    t.skip('Stripe not configured (no STRIPE_SECRET_KEY)');
    return;
  }

  const [order] = await sql`
    insert into orders (restaurant_id, total_amount, payment_status)
    values (${restaurantId}, 10, 'unpaid')
    returning id
  `;
  const intentId = `pi_test_${RUN}`;
  await sql`
    insert into payments (order_id, restaurant_id, amount, method, status, stripe_payment_intent_id)
    values (${order.id}, ${restaurantId}, 10, 'card', 'pending', ${intentId})
  `;

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

  const [payment] = await sql`select status from payments where stripe_payment_intent_id = ${intentId}`;
  assert.equal(payment.status, 'completed');
  const [updatedOrder] = await sql`select payment_status from orders where id = ${order.id}`;
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
