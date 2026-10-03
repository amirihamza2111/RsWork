const { sql, and, compact, updateById, byIds } = require('./helpers');
const { isUuid, toCategory, toMenuItem } = require('./mappers');
const restaurants = require('./restaurants');

/* ------------------------------ categories ------------------------------ */

const findCategoryById = async (id) => {
  if (!isUuid(id)) return null;
  const [row] = await sql`select * from categories where id = ${id}`;
  return toCategory(row) || null;
};

const listActiveCategories = async (restaurantId) => {
  if (!isUuid(restaurantId)) return [];
  const rows = await sql`
    select * from categories
    where restaurant_id = ${restaurantId} and is_active
    order by sort_order nulls last, created_at
  `;
  return rows.map(toCategory);
};

const createCategory = async ({ name, restaurantId, image, order }) => {
  const [row] = await sql`
    insert into categories ${sql(
      compact({
        name: sql.json(name),
        restaurant_id: restaurantId,
        image,
        sort_order: order,
      })
    )}
    returning *
  `;
  return toCategory(row);
};

const updateCategory = async (id, patch) =>
  toCategory(
    await updateById('categories', id, {
      name: patch.name !== undefined ? sql.json(patch.name) : undefined,
      image: patch.image,
      sort_order: patch.order,
      is_active: patch.isActive,
    })
  );

const deleteCategory = async (id) => {
  await sql`delete from categories where id = ${id}`;
};

/* ------------------------------ menu items ------------------------------ */

const withCategories = async (rows) => {
  const categories = await byIds('categories', rows.map((r) => r.categoryId));
  return rows.map((r) => toMenuItem(r, { category: toCategory(categories.get(r.categoryId)) }));
};

const findItemById = async (id, { populate = false } = {}) => {
  if (!isUuid(id)) return null;
  const [row] = await sql`select * from menu_items where id = ${id}`;
  if (!row) return null;
  if (!populate) return toMenuItem(row);
  const [category, restaurant] = await Promise.all([
    findCategoryById(row.categoryId),
    restaurants.findById(row.restaurantId),
  ]);
  return toMenuItem(row, { category, restaurant });
};

const listItems = async ({ restaurantId, categoryId, isAvailable }) => {
  if (!isUuid(restaurantId)) return [];
  if (categoryId !== undefined && !isUuid(categoryId)) return [];
  const rows = await sql`
    select * from menu_items
    where ${and([
      sql`restaurant_id = ${restaurantId}`,
      categoryId ? sql`category_id = ${categoryId}` : null,
      isAvailable !== undefined ? sql`is_available = ${isAvailable}` : null,
    ])}
    order by created_at
  `;
  return withCategories(rows);
};

// Raw rows (with price/availability) for server-side order pricing.
const findItemsForRestaurant = async (ids, restaurantId, db = sql) => {
  const list = [...new Set(ids.filter(isUuid))];
  if (list.length === 0) return [];
  const rows = await db`
    select * from menu_items where id in ${db(list)} and restaurant_id = ${restaurantId}
  `;
  return rows.map((r) => toMenuItem(r));
};

const ITEM_COLUMNS = (data) =>
  compact({
    name: data.name !== undefined ? sql.json(data.name) : undefined,
    description:
      data.description !== undefined
        ? data.description === null
          ? null
          : sql.json(data.description)
        : undefined,
    price: data.price,
    category_id: data.category,
    restaurant_id: data.restaurant,
    image: data.image,
    is_available: data.isAvailable,
    is_vegetarian: data.isVegetarian,
    is_gluten_free: data.isGlutenFree,
    allergens: data.allergens,
    preparation_time: data.preparationTime,
    prep_station: data.prepStation,
  });

const createItem = async (data) => {
  const [row] = await sql`insert into menu_items ${sql(ITEM_COLUMNS(data))} returning *`;
  return toMenuItem(row);
};

const updateItem = async (id, patch) => toMenuItem(await updateById('menu_items', id, ITEM_COLUMNS(patch)));

const deleteItem = async (id) => {
  await sql`delete from menu_items where id = ${id}`;
};

const toggleItemAvailability = async (id) => {
  const [row] = await sql`
    update menu_items set is_available = not is_available where id = ${id} returning *
  `;
  return toMenuItem(row);
};

// Available items by id, in the given order (used by recommendations).
const findAvailableBrief = async (ids, restaurantId) => {
  const list = [...new Set(ids.filter(isUuid))];
  if (list.length === 0) return [];
  const rows = await sql`
    select id, name, price, image, category_id, prep_station
    from menu_items
    where id in ${sql(list)} and restaurant_id = ${restaurantId} and is_available
  `;
  const byId = new Map(
    rows.map((r) => [
      r.id,
      { _id: r.id, name: r.name, price: r.price, image: r.image, category: r.categoryId, prepStation: r.prepStation },
    ])
  );
  return list.map((id) => byId.get(id)).filter(Boolean);
};

module.exports = {
  findCategoryById,
  listActiveCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  findItemById,
  listItems,
  findItemsForRestaurant,
  createItem,
  updateItem,
  deleteItem,
  toggleItemAvailability,
  findAvailableBrief,
};
