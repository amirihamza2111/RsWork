const { sql, and, compact, updateById } = require('./helpers');
const { isUuid, toFeedback } = require('./mappers');

const findById = async (id) => {
  if (!isUuid(id)) return null;
  const [row] = await sql`select * from feedback where id = ${id}`;
  return toFeedback(row) || null;
};

const create = async (data) => {
  const [row] = await sql`
    insert into feedback ${sql(
      compact({
        restaurant_id: data.restaurant,
        table_id: data.table,
        order_id: data.order,
        rating: data.rating,
        category: data.category || undefined,
        comment: data.comment,
      })
    )}
    returning *
  `;
  return toFeedback(row);
};

const setReviewed = async (id, reviewed) =>
  toFeedback(
    await updateById('feedback', id, {
      status: reviewed ? 'reviewed' : 'new',
      reviewed_at: reviewed ? new Date() : null,
    })
  );

const list = async ({ restaurantId, status }, { limit, offset }) => {
  const where = and([
    restaurantId ? sql`f.restaurant_id = ${restaurantId}` : null,
    status ? sql`f.status = ${status}` : null,
  ]);
  const [rows, [{ total }]] = await Promise.all([
    sql`
      select f.*, t.number as table_number, o.order_number
      from feedback f
      left join tables t on t.id = f.table_id
      left join orders o on o.id = f.order_id
      where ${where}
      order by f.created_at desc
      limit ${limit} offset ${offset}
    `,
    sql`select count(*)::int as total from feedback f where ${where}`,
  ]);
  const feedbacks = rows.map((f) =>
    toFeedback(f, {
      table: f.tableId ? { _id: f.tableId, number: f.tableNumber } : null,
      order: f.orderId ? { _id: f.orderId, orderNumber: f.orderNumber } : null,
    })
  );
  return { feedbacks, total };
};

const countNew = async (restaurantId) => {
  const [row] = restaurantId
    ? await sql`select count(*)::int as count from feedback where status = 'new' and restaurant_id = ${restaurantId}`
    : await sql`select count(*)::int as count from feedback where status = 'new'`;
  return row.count;
};

module.exports = { findById, create, setReviewed, list, countNew };
