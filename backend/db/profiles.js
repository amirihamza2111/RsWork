const { sql, compact, updateById } = require('./helpers');
const { isUuid, toUser } = require('./mappers');

// Profiles joined with auth.users for the email-confirmation flag.
const findById = async (id, db = sql) => {
  if (!isUuid(id)) return null;
  const [row] = await db`
    select p.*, (u.email_confirmed_at is not null) as is_verified
    from profiles p join auth.users u on u.id = p.id
    where p.id = ${id}
  `;
  return toUser(row) || null;
};

const findByEmail = async (email, db = sql) => {
  const [row] = await db`
    select p.*, (u.email_confirmed_at is not null) as is_verified
    from profiles p join auth.users u on u.id = p.id
    where p.email = ${String(email).trim().toLowerCase()}
  `;
  return toUser(row) || null;
};

const emailExists = async (email) => {
  const normalized = String(email).trim().toLowerCase();
  const [row] = await sql`
    select 1 from auth.users where lower(email) = ${normalized}
    union all
    select 1 from profiles where email = ${normalized}
    limit 1
  `;
  return Boolean(row);
};

const create = async (data, db = sql) => {
  await db`
    insert into profiles ${db(
      compact({
        id: data.id,
        name: data.name,
        email: String(data.email).trim().toLowerCase(),
        role: data.role || 'client',
        phone: data.phone,
        restaurant_id: data.restaurantId,
      })
    )}
  `;
  return findById(data.id, db);
};

const update = async (id, patch, db = sql) => {
  await updateById(
    'profiles',
    id,
    {
      name: patch.name,
      email: patch.email !== undefined ? String(patch.email).trim().toLowerCase() : undefined,
      phone: patch.phone,
      role: patch.role,
      restaurant_id: patch.restaurantId,
      is_active: patch.isActive,
    },
    db
  );
  return findById(id, db);
};

const list = async ({ restaurantId } = {}) => {
  const rows = restaurantId
    ? await sql`
        select p.*, (u.email_confirmed_at is not null) as is_verified
        from profiles p join auth.users u on u.id = p.id
        where p.restaurant_id = ${restaurantId}
        order by p.created_at
      `
    : await sql`
        select p.*, (u.email_confirmed_at is not null) as is_verified
        from profiles p join auth.users u on u.id = p.id
        order by p.created_at
      `;
  return rows.map(toUser);
};

// Minimal { _id, ...fields } projections for populated relations.
const findBriefMap = async (ids, fields = ['name']) => {
  const list = [...new Set(ids.filter(Boolean).map(String))];
  if (list.length === 0) return new Map();
  const rows = await sql`select id, name, email, phone from profiles where id in ${sql(list)}`;
  return new Map(
    rows.map((r) => [r.id, Object.fromEntries([['_id', r.id], ...fields.map((f) => [f, r[f]])])])
  );
};

module.exports = { findById, findByEmail, emailExists, create, update, list, findBriefMap };
