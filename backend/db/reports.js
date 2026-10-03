// Analytics queries shared by the dashboard endpoints, the AI report, the
// forecast service and the recommendation model. Day/hour buckets use UTC,
// matching the previous MongoDB aggregation behaviour.
const { sql, and } = require('./helpers');

// Revenue = money actually collected: only PAID orders count.
const paidRevenue = () => sql`coalesce(sum(case when payment_status = 'paid' then total_amount else 0 end), 0)`;
// Forecast history: everything ordered except cancellations.
const bookedRevenue = () => sql`coalesce(sum(case when status = 'cancelled' then 0 else total_amount end), 0)`;

const range = (restaurantId, start, end) =>
  and([
    sql`restaurant_id = ${restaurantId}`,
    start ? sql`created_at >= ${start}` : null,
    end ? sql`created_at <= ${end}` : null,
  ]);

const periodTotals = async (restaurantId, start, end) => {
  const [row] = await sql`
    select count(*)::int as orders,
           ${paidRevenue()} as revenue,
           count(*) filter (where status = 'cancelled')::int as cancelled
    from orders where ${range(restaurantId, start, end)}
  `;
  return row;
};

const todayStats = async (restaurantId, dayStart, dayEnd) => {
  const [row] = await sql`
    select count(*) filter (where created_at between ${dayStart} and ${dayEnd})::int as total_orders,
           coalesce(sum(case when payment_status = 'paid' and created_at between ${dayStart} and ${dayEnd}
                             then total_amount else 0 end), 0) as total_revenue,
           count(*) filter (where status = 'pending')::int as pending_orders
    from orders where restaurant_id = ${restaurantId}
  `;
  return row;
};

// [{ date: 'YYYY-MM-DD', orders, revenue }] for days that have orders.
const dailySeries = async (restaurantId, start, end, { revenue = 'paid' } = {}) => {
  const revenueExpr = revenue === 'booked' ? bookedRevenue() : paidRevenue();
  return sql`
    select to_char(created_at at time zone 'utc', 'YYYY-MM-DD') as date,
           count(*)::int as orders,
           ${revenueExpr} as revenue
    from orders where ${range(restaurantId, start, end)}
    group by 1 order by 1
  `;
};

// Best sellers by quantity (cancelled orders excluded).
const topItems = async (restaurantId, { start, end, limit = 5 } = {}) =>
  sql`
    select oi.menu_item_id,
           coalesce(mi.name ->> 'fr', 'Unknown item') as name,
           sum(oi.quantity)::int as quantity,
           sum(oi.quantity * oi.price) as revenue
    from order_items oi
    join orders o on o.id = oi.order_id
    left join menu_items mi on mi.id = oi.menu_item_id
    where ${and([
      sql`o.restaurant_id = ${restaurantId}`,
      sql`o.status <> 'cancelled'`,
      start ? sql`o.created_at >= ${start}` : null,
      end ? sql`o.created_at <= ${end}` : null,
    ])}
    group by oi.menu_item_id, mi.name
    order by quantity desc
    limit ${limit}
  `;

const byHour = async (restaurantId, { start, end } = {}) =>
  sql`
    select extract(hour from created_at at time zone 'utc')::int as hour, count(*)::int as orders
    from orders where ${range(restaurantId, start, end)}
    group by 1 order by orders desc, hour
  `;

// Day of week 1 (Sunday) .. 7 (Saturday), like MongoDB's $dayOfWeek.
const byDayOfWeek = async (restaurantId, { start, end } = {}) =>
  sql`
    select (extract(dow from created_at at time zone 'utc')::int + 1) as day,
           count(*)::int as orders,
           ${paidRevenue()} as revenue
    from orders where ${range(restaurantId, start, end)}
    group by 1
  `;

// Market basket: per item, how many orders contain it and how often each other
// item appears alongside it.
const basket = async (restaurantId, since) => {
  const baskets = () => sql`
    select distinct oi.order_id, oi.menu_item_id
    from order_items oi join orders o on o.id = oi.order_id
    where o.restaurant_id = ${restaurantId}
      and o.status <> 'cancelled'
      and o.created_at >= ${since}
      and oi.menu_item_id is not null
  `;
  const [orders, support, pairs] = await Promise.all([
    sql`
      select count(*)::int as count from orders
      where restaurant_id = ${restaurantId} and status <> 'cancelled' and created_at >= ${since}
    `,
    sql`
      with b as (${baskets()})
      select menu_item_id, count(*)::int as orders from b group by menu_item_id
    `,
    sql`
      with b as (${baskets()})
      select a.menu_item_id as item_id, c.menu_item_id as other_id, count(*)::int as count
      from b a join b c on c.order_id = a.order_id and c.menu_item_id <> a.menu_item_id
      group by a.menu_item_id, c.menu_item_id
    `,
  ]);
  return { ordersAnalyzed: orders[0].count, support, pairs };
};

module.exports = {
  periodTotals,
  todayStats,
  dailySeries,
  topItems,
  byHour,
  byDayOfWeek,
  basket,
};
