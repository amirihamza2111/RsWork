const { sql } = require('./helpers');

// A waiter counts as on the floor while their heartbeat is fresher than this.
const ONLINE_WINDOW_SECONDS = 120;

// Records a heartbeat; returns true when the waiter was offline before it.
const heartbeat = async (userId, restaurantId) => {
  const [row] = await sql`
    with prev as (
      select last_seen_at, restaurant_id from waiter_presence where user_id = ${userId}
    )
    insert into waiter_presence (user_id, restaurant_id, last_seen_at)
    values (${userId}, ${restaurantId}, now())
    on conflict (user_id) do update
      set restaurant_id = excluded.restaurant_id, last_seen_at = now()
    returning
      (select last_seen_at from prev) as previous_seen_at,
      (select restaurant_id from prev) as previous_restaurant_id
  `;
  const previous = row.previousSeenAt ? new Date(row.previousSeenAt).getTime() : 0;
  return (
    !previous ||
    row.previousRestaurantId !== restaurantId ||
    Date.now() - previous > ONLINE_WINDOW_SECONDS * 1000
  );
};

const goOffline = async (userId) => {
  const rows = await sql`
    delete from waiter_presence where user_id = ${userId} returning restaurant_id
  `;
  return rows[0]?.restaurantId || null;
};

const onlineWaiters = async (restaurantId) => {
  const rows = await sql`
    select w.user_id
    from waiter_presence w join profiles p on p.id = w.user_id
    where w.restaurant_id = ${restaurantId}
      and p.role = 'waiter' and p.is_active
      and w.last_seen_at > now() - make_interval(secs => ${ONLINE_WINDOW_SECONDS})
    order by w.user_id
  `;
  return rows.map((r) => r.userId);
};

module.exports = { ONLINE_WINDOW_SECONDS, heartbeat, goOffline, onlineWaiters };
