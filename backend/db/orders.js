const { sql, and, compact, unique, byIds } = require('./helpers');
const { isUuid, toOrder, toOrderItem, toMenuItem, toRestaurant } = require('./mappers');
const profiles = require('./profiles');

const ACTIVE_STATUSES = ['pending', 'confirmed', 'preparing', 'ready'];

const itemsFor = async (orderIds, db = sql) => {
  const ids = unique(orderIds);
  if (ids.length === 0) return new Map();
  const rows = await db`
    select * from order_items where order_id in ${db(ids)} order by position, id
  `;
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.orderId)) map.set(row.orderId, []);
    map.get(row.orderId).push(row);
  }
  return map;
};

// Orders with their line items only (relations left as ids).
const hydrateBare = async (rows, db = sql) => {
  const items = await itemsFor(
    rows.map((r) => r.id),
    db
  );
  return rows.map((r) =>
    toOrder(r, { items: (items.get(r.id) || []).map((i) => toOrderItem(i)) })
  );
};

// Equivalent of the old Mongoose POPULATE: restaurant, table(number),
// client(name/email/phone), waiter(name) and every item's menuItem.
const hydrate = async (rows, db = sql) => {
  if (rows.length === 0) return [];
  const items = await itemsFor(
    rows.map((r) => r.id),
    db
  );
  const allItems = [...items.values()].flat();
  const [menuItems, tables, restaurantRows, clients, waiters] = await Promise.all([
    byIds('menu_items', allItems.map((i) => i.menuItemId), null, db),
    byIds('tables', rows.map((r) => r.tableId), ['id', 'number'], db),
    byIds('restaurants', rows.map((r) => r.restaurantId), null, db),
    profiles.findBriefMap(rows.map((r) => r.clientId), ['name', 'email', 'phone']),
    profiles.findBriefMap(rows.map((r) => r.waiterId), ['name']),
  ]);

  return rows.map((r) => {
    const table = tables.get(r.tableId);
    return toOrder(r, {
      restaurant: toRestaurant(restaurantRows.get(r.restaurantId)),
      table: table ? { _id: table.id, number: table.number } : null,
      client: clients.get(r.clientId) || null,
      waiter: waiters.get(r.waiterId) || null,
      items: (items.get(r.id) || []).map((i) =>
        toOrderItem(i, toMenuItem(menuItems.get(i.menuItemId)) || null)
      ),
    });
  });
};

const findById = async (id, { populate = false, forUpdate = false, db = sql } = {}) => {
  if (!isUuid(id)) return null;
  const [row] = forUpdate
    ? await db`select * from orders where id = ${id} for update`
    : await db`select * from orders where id = ${id}`;
  if (!row) return null;
  const [order] = populate ? await hydrate([row], db) : await hydrateBare([row], db);
  return order;
};

const populateById = async (id, db = sql) => findById(id, { populate: true, db });

// Flexible filtered listing. Every filter is optional.
const list = async (
  {
    restaurantId,
    tableId,
    clientId,
    waiterId,
    status,
    statuses,
    excludeStatus,
    excludePaymentStatus,
    from,
    to,
  } = {},
  { sort = 'desc', populate = true } = {}
) => {
  const rows = await sql`
    select * from orders
    where ${and([
      restaurantId ? sql`restaurant_id = ${restaurantId}` : null,
      tableId ? sql`table_id = ${tableId}` : null,
      clientId ? sql`client_id = ${clientId}` : null,
      waiterId ? sql`waiter_id = ${waiterId}` : null,
      status ? sql`status = ${status}` : null,
      statuses ? sql`status in ${sql(statuses)}` : null,
      excludeStatus ? sql`status <> ${excludeStatus}` : null,
      excludePaymentStatus ? sql`payment_status <> ${excludePaymentStatus}` : null,
      from ? sql`created_at >= ${from}` : null,
      to ? sql`created_at <= ${to}` : null,
    ])}
    order by created_at ${sort === 'asc' ? sql`asc` : sql`desc`}
  `;
  return populate ? hydrate(rows) : hydrateBare(rows);
};

// Open-tab totals for the anti-abuse caps (counted inside the order transaction).
const openTabForTable = async (tableId, db = sql) => {
  const [row] = await db`
    select count(*)::int as count, coalesce(sum(total_amount), 0) as sum
    from orders
    where table_id = ${tableId}
      and status in ${db(ACTIVE_STATUSES)}
      and payment_status <> 'paid'
  `;
  return row;
};

const hasActiveForTable = async (tableId) => {
  const [row] = await sql`
    select 1 from orders where table_id = ${tableId} and status in ${sql(ACTIVE_STATUSES)} limit 1
  `;
  return Boolean(row);
};

// Inserts an order with its items; the order number comes from a DB trigger.
const insert = async (db, order, items) => {
  const [row] = await db`
    insert into orders ${db(
      compact({
        restaurant_id: order.restaurant,
        table_id: order.table,
        client_id: order.client,
        waiter_id: order.waiter,
        notes: order.notes,
        payment_method: order.paymentMethod,
        total_amount: order.totalAmount,
      })
    )}
    returning *
  `;
  await db`
    insert into order_items ${db(
      items.map((item, position) => ({
        order_id: row.id,
        menu_item_id: item.menuItem,
        quantity: item.quantity,
        price: item.price,
        options: item.options ?? null,
        comment: item.comment ?? null,
        prep_station: item.prepStation,
        position,
      }))
    )}
  `;
  return row;
};

// Conditional UPDATE: applies `set` only while `where` still holds. Returns the
// updated row, or null when another request won the race.
const updateIf = async (id, set, where = [], db = sql) => {
  const values = compact(set);
  const [row] = await db`
    update orders set ${db(values)}
    where ${and([sql`id = ${id}`, ...where])}
    returning *
  `;
  return row || null;
};

const update = async (id, set, db = sql) => updateIf(id, set, [], db);

const markAllItemsServed = async (orderId, db = sql) => {
  await db`update order_items set status = 'served' where order_id = ${orderId}`;
};

const setItemStatus = async (itemId, status, db = sql) => {
  await db`update order_items set status = ${status} where id = ${itemId}`;
};

// Daily table numbers for the end-of-day report list.
const listForDay = async (restaurantId, start, end) => {
  const rows = await sql`
    select o.id, o.order_number, t.number as table_number, o.total_amount, o.status, o.created_at
    from orders o left join tables t on t.id = o.table_id
    where o.restaurant_id = ${restaurantId} and o.created_at between ${start} and ${end}
    order by o.order_number
  `;
  return rows.map((r) => ({
    _id: r.id,
    orderNumber: r.orderNumber,
    table: r.tableNumber ?? null,
    totalAmount: r.totalAmount,
    status: r.status,
    createdAt: r.createdAt,
  }));
};

module.exports = {
  ACTIVE_STATUSES,
  hydrate,
  findById,
  populateById,
  list,
  openTabForTable,
  hasActiveForTable,
  insert,
  updateIf,
  update,
  markAllItemsServed,
  setItemStatus,
  listForDay,
};
