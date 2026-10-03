const { sql, compact, updateById } = require('./helpers');
const { isUuid, toTable } = require('./mappers');
const restaurants = require('./restaurants');
const profiles = require('./profiles');

const findById = async (id, { populate = false, forUpdate = false, db = sql } = {}) => {
  if (!isUuid(id)) return null;
  const [row] = forUpdate
    ? await db`select * from tables where id = ${id} for update`
    : await db`select * from tables where id = ${id}`;
  if (!row) return null;
  if (!populate) return toTable(row);
  return toTable(row, { restaurant: await restaurants.findById(row.restaurantId) });
};

const findByNumber = async (restaurantId, number) => {
  if (!isUuid(restaurantId)) return null;
  const [row] = await sql`
    select * from tables where restaurant_id = ${restaurantId} and number = ${number}
  `;
  return toTable(row) || null;
};

// Tables populated with their restaurant and assigned waiter's name.
const hydrate = async (rows) => {
  const [restaurantMap, waiterMap] = await Promise.all([
    restaurants.findMapByIds(rows.map((r) => r.restaurantId)),
    profiles.findBriefMap(rows.map((r) => r.assignedWaiterId)),
  ]);
  return rows.map((r) =>
    toTable(r, {
      restaurant: restaurantMap.get(r.restaurantId),
      assignedWaiter: waiterMap.get(r.assignedWaiterId) || null,
    })
  );
};

const list = async ({ restaurantId, ids, waiterSection } = {}) => {
  let rows;
  if (waiterSection) {
    rows = await sql`
      select t.* from tables t
      where t.restaurant_id = ${waiterSection.restaurantId}
        and (
          t.assigned_waiter_id = ${waiterSection.waiterId}
          or t.id in (
            select o.table_id from orders o
            where o.restaurant_id = ${waiterSection.restaurantId}
              and o.waiter_id = ${waiterSection.waiterId}
              and o.table_id is not null
          )
        )
      order by t.number
    `;
  } else if (ids) {
    rows = ids.length
      ? await sql`select * from tables where id in ${sql(ids)} order by number`
      : [];
  } else if (restaurantId) {
    rows = await sql`select * from tables where restaurant_id = ${restaurantId} order by number`;
  } else {
    rows = await sql`select * from tables order by restaurant_id, number`;
  }
  return hydrate(rows);
};

const create = async ({ restaurantId, number, capacity }) => {
  const [row] = await sql`
    insert into tables ${sql(compact({ restaurant_id: restaurantId, number, capacity }))}
    returning *
  `;
  return toTable(row);
};

const update = async (id, patch, db = sql) =>
  toTable(
    await updateById(
      'tables',
      id,
      {
        number: patch.number,
        capacity: patch.capacity,
        status: patch.status,
        assigned_waiter_id: patch.assignedWaiter,
        qr_code: patch.qrCode,
        session_id: patch.sessionId,
        session_expires_at: patch.sessionExpiresAt,
      },
      db
    )
  );

const remove = async (id) => {
  await sql`delete from tables where id = ${id}`;
};

const listIdsForRestaurant = async (restaurantId) => {
  const rows = restaurantId
    ? await sql`select id from tables where restaurant_id = ${restaurantId}`
    : await sql`select id from tables`;
  return rows.map((r) => r.id);
};

const countOccupied = async (restaurantId) => {
  const [row] = await sql`
    select count(*)::int as count from tables
    where restaurant_id = ${restaurantId} and status = 'occupied'
  `;
  return row.count;
};

// Active tables for section assignment, ordered by number.
const listActiveForSections = async (restaurantId) =>
  sql`
    select id, assigned_waiter_id from tables
    where restaurant_id = ${restaurantId} and is_active
    order by number
  `;

// Apply many { id, waiter } assignments in one statement.
const bulkAssignWaiters = async (updates) => {
  if (updates.length === 0) return;
  const values = updates.map((u) => [String(u.id), u.waiter ? String(u.waiter) : null]);
  await sql`
    update tables as t
    set assigned_waiter_id = v.waiter::uuid
    from (values ${sql(values)}) as v (id, waiter)
    where t.id = v.id::uuid
  `;
};

module.exports = {
  findById,
  findByNumber,
  list,
  create,
  update,
  remove,
  listIdsForRestaurant,
  countOccupied,
  listActiveForSections,
  bulkAssignWaiters,
};
