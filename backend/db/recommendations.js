const { sql } = require('./helpers');

const latestGeneratedAt = async (restaurantId) => {
  const [row] = await sql`
    select max(generated_at) as generated_at from recommendations where restaurant_id = ${restaurantId}
  `;
  return row?.generatedAt || null;
};

// Replaces the restaurant's whole model atomically.
// model: Map<itemId, [{ menuItem, count, score }]>
const replaceAll = async (restaurantId, model) => {
  await sql.begin(async (tx) => {
    await tx`delete from recommendations where restaurant_id = ${restaurantId}`;
    if (model.size === 0) return;
    const heads = await tx`
      insert into recommendations ${tx(
        [...model.keys()].map((itemId) => ({ restaurant_id: restaurantId, item_id: itemId }))
      )}
      returning id, item_id
    `;
    const rows = heads.flatMap((head) =>
      model.get(head.itemId).map((rec) => ({
        recommendation_id: head.id,
        menu_item_id: rec.menuItem,
        count: rec.count,
        score: rec.score,
      }))
    );
    if (rows.length) await tx`insert into recommendation_items ${tx(rows)}`;
  });
};

// Total co-occurrence score per candidate across the given cart items.
const scoresForCart = async (restaurantId, cartItemIds) => {
  if (cartItemIds.length === 0) return [];
  return sql`
    select ri.menu_item_id, sum(ri.count)::int as score
    from recommendations r
    join recommendation_items ri on ri.recommendation_id = r.id
    where r.restaurant_id = ${restaurantId} and r.item_id in ${sql(cartItemIds)}
    group by ri.menu_item_id
    order by score desc
  `;
};

module.exports = { latestGeneratedAt, replaceAll, scoresForCart };
