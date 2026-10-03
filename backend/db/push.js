const { sql } = require('./helpers');

const upsert = async ({ userId, restaurantId, subscription }) => {
  await sql`
    insert into push_subscriptions (user_id, restaurant_id, endpoint, subscription)
    values (${userId}, ${restaurantId}, ${subscription.endpoint}, ${sql.json(subscription)})
    on conflict (endpoint) do update
      set user_id = excluded.user_id,
          restaurant_id = excluded.restaurant_id,
          subscription = excluded.subscription
  `;
};

const removeForUser = async (endpoint, userId) => {
  await sql`delete from push_subscriptions where endpoint = ${endpoint} and user_id = ${userId}`;
};

const removeById = async (id) => {
  await sql`delete from push_subscriptions where id = ${id}`;
};

const listFor = async ({ userId, restaurantId }) => {
  if (userId) return sql`select id, subscription from push_subscriptions where user_id = ${userId}`;
  return sql`select id, subscription from push_subscriptions where restaurant_id = ${restaurantId}`;
};

module.exports = { upsert, removeForUser, removeById, listFor };
