const { sql, and, compact, updateById } = require('./helpers');
const { isUuid, toPayment } = require('./mappers');

// Identifying filters that are passed must be valid — an empty/garbage id never
// widens the lookup to "any payment".
const findOne = async (filter) => {
  const { id, orderId, restaurantId, status, method, stripePaymentIntentId } = filter;
  const has = (key) => Object.prototype.hasOwnProperty.call(filter, key);
  if (has('id') && !isUuid(id)) return null;
  if (has('orderId') && !isUuid(orderId)) return null;
  if (has('stripePaymentIntentId') && (typeof stripePaymentIntentId !== 'string' || !stripePaymentIntentId)) {
    return null;
  }
  const [row] = await sql`
    select * from payments
    where ${and([
      id ? sql`id = ${id}` : null,
      orderId ? sql`order_id = ${orderId}` : null,
      restaurantId ? sql`restaurant_id = ${restaurantId}` : null,
      status ? sql`status = ${status}` : null,
      method ? sql`method = ${method}` : null,
      stripePaymentIntentId ? sql`stripe_payment_intent_id = ${stripePaymentIntentId}` : null,
    ])}
    order by created_at desc
    limit 1
  `;
  return row || null;
};

const create = async (data, db = sql) => {
  const [row] = await db`
    insert into payments ${db(
      compact({
        order_id: data.order,
        restaurant_id: data.restaurant,
        amount: data.amount,
        method: data.method,
        status: data.status || 'pending',
        stripe_payment_intent_id: data.stripePaymentIntentId,
        stripe_client_secret: data.stripeClientSecret,
      })
    )}
    returning *
  `;
  return row;
};

const update = async (id, patch) =>
  updateById('payments', id, {
    amount: patch.amount,
    method: patch.method,
    status: patch.status,
    stripe_payment_intent_id: patch.stripePaymentIntentId,
    stripe_client_secret: patch.stripeClientSecret,
    paid_at: patch.paidAt,
  });

// Marks a payment completed exactly once; returns null if it already was.
const completeOnce = async (id) => {
  const [row] = await sql`
    update payments set status = 'completed', paid_at = now()
    where id = ${id} and status <> 'completed'
    returning *
  `;
  return row || null;
};

const markFailedByIntent = async (intentId) => {
  await sql`update payments set status = 'failed' where stripe_payment_intent_id = ${intentId}`;
};

const list = async ({ restaurantId, status, method, from, to }, { limit, offset }) => {
  const where = and([
    restaurantId ? sql`p.restaurant_id = ${restaurantId}` : null,
    status ? sql`p.status = ${status}` : null,
    method ? sql`p.method = ${method}` : null,
    from ? sql`p.created_at >= ${from}` : null,
    to ? sql`p.created_at <= ${to}` : null,
  ]);
  const [rows, [{ total }]] = await Promise.all([
    sql`
      select p.*, o.order_number, o.total_amount as order_total_amount,
             o.payment_status as order_payment_status, o.table_id as order_table_id
      from payments p left join orders o on o.id = p.order_id
      where ${where}
      order by p.created_at desc
      limit ${limit} offset ${offset}
    `,
    sql`select count(*)::int as total from payments p where ${where}`,
  ]);
  const payments = rows.map((p) =>
    toPayment(p, {
      order: p.orderNumber
        ? {
            _id: p.orderId,
            orderNumber: p.orderNumber,
            totalAmount: p.orderTotalAmount,
            paymentStatus: p.orderPaymentStatus,
            table: p.orderTableId,
          }
        : p.orderId,
    })
  );
  return { payments, total };
};

module.exports = { findOne, create, update, completeOnce, markFailedByIntent, list, toPayment };
