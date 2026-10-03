const { sql, compact, updateById, byIds } = require('./helpers');
const { isUuid, toRestaurant } = require('./mappers');

const findById = async (id, db = sql) => {
  if (!isUuid(id)) return null;
  const [row] = await db`select * from restaurants where id = ${id}`;
  return toRestaurant(row) || null;
};

const findMapByIds = async (ids, db = sql) => {
  const rows = await byIds('restaurants', ids, null, db);
  return new Map([...rows].map(([id, row]) => [id, toRestaurant(row)]));
};

const findFirstOwnedBy = async (userId) => {
  const [row] = await sql`
    select * from restaurants where owner_id = ${userId} order by created_at limit 1
  `;
  return toRestaurant(row) || null;
};

const isOwnedBy = async (restaurantId, userId) => {
  if (!isUuid(restaurantId)) return false;
  const [row] = await sql`
    select 1 from restaurants where id = ${restaurantId} and owner_id = ${userId}
  `;
  return Boolean(row);
};

const create = async (data, db = sql) => {
  const [row] = await db`
    insert into restaurants ${db(
      compact({
        name: data.name,
        type: data.type || 'restaurant',
        address: data.address,
        phone: data.phone,
        logo: data.logo,
        settings: sql.json(data.settings || {}),
        owner_id: data.ownerId,
      })
    )}
    returning *
  `;
  return toRestaurant(row);
};

const update = async (id, patch, db = sql) => {
  const row = await updateById(
    'restaurants',
    id,
    {
      name: patch.name,
      address: patch.address,
      phone: patch.phone,
      logo: patch.logo,
      settings: patch.settings !== undefined ? sql.json(patch.settings) : undefined,
      lat: patch.lat,
      lng: patch.lng,
      geofence_radius: patch.geofenceRadius,
      sections_day: patch.sectionsDay,
      owner_id: patch.ownerId,
    },
    db
  );
  return toRestaurant(row);
};

const remove = async (id, db = sql) => {
  await db`delete from restaurants where id = ${id}`;
};

// Restaurants a user can switch between: everything they own plus their scoped one.
const listForUser = async (user) => {
  const rows =
    user.role === 'superadmin'
      ? await sql`select * from restaurants order by name`
      : await sql`
          select * from restaurants
          where owner_id = ${user._id} or id = ${user.restaurant || null}
          order by name
        `;
  return rows.map((r) => {
    const dto = toRestaurant(r);
    return { _id: dto._id, name: dto.name, logo: dto.logo, settings: dto.settings, isActive: dto.isActive };
  });
};

const listAllWithOwner = async () => {
  const rows = await sql`
    select r.*, p.name as owner_name, p.email as owner_email
    from restaurants r left join profiles p on p.id = r.owner_id
    order by r.created_at
  `;
  return rows.map((r) => ({
    ...toRestaurant(r),
    owner: r.ownerId ? { _id: r.ownerId, name: r.ownerName, email: r.ownerEmail } : null,
  }));
};

module.exports = {
  findById,
  findMapByIds,
  findFirstOwnedBy,
  isOwnedBy,
  create,
  update,
  remove,
  listForUser,
  listAllWithOwner,
};
