/**
 * Seeds a demo restaurant, one user per role, two categories, two menu items,
 * and a table — so the API can be exercised end-to-end (e.g. in Postman).
 *
 * Idempotent: re-running it won't create duplicates. Users are created in
 * Supabase Auth (email pre-confirmed) with a matching app profile.
 *
 * Usage:  npm run seed
 */
const { sql } = require('../config/db');
const { supabaseAdmin } = require('../config/supabase');
const profiles = require('../db/profiles');
const restaurants = require('../db/restaurants');

const PASSWORD = 'password123';

async function ensureUser({ name, email, role, restaurantId }) {
  const existing = await profiles.findByEmail(email);
  if (existing) return existing;

  const [authRow] = await sql`select id from auth.users where lower(email) = ${email}`;
  let id = authRow?.id;
  if (!id) {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { name },
    });
    if (error) throw new Error(`Creating ${email}: ${error.message}`);
    id = data.user.id;
  }
  return profiles.create({ id, name, email, role, restaurantId });
}

async function ensureCategory(restaurantId, name) {
  const [existing] = await sql`
    select id from categories where restaurant_id = ${restaurantId} and name ->> 'fr' = ${name.fr}
  `;
  if (existing) return existing.id;
  const [row] = await sql`
    insert into categories (restaurant_id, name) values (${restaurantId}, ${sql.json(name)})
    returning id
  `;
  return row.id;
}

async function ensureMenuItem(restaurantId, categoryId, data) {
  const [existing] = await sql`
    select id from menu_items where restaurant_id = ${restaurantId} and name ->> 'fr' = ${data.name.fr}
  `;
  if (existing) return existing.id;
  const [row] = await sql`
    insert into menu_items (restaurant_id, category_id, name, price, prep_station)
    values (${restaurantId}, ${categoryId}, ${sql.json(data.name)}, ${data.price}, ${data.prepStation})
    returning id
  `;
  return row.id;
}

(async () => {
  let [restaurant] = await sql`select id, name, owner_id from restaurants where name = 'RsWork Demo'`;
  if (!restaurant) {
    const created = await restaurants.create({
      name: 'RsWork Demo',
      type: 'restaurant',
      address: 'Tunis, Tunisia',
      phone: '+216 00 000 000',
      settings: { currency: 'TND', language: 'fr', timezone: 'Africa/Tunis' },
    });
    restaurant = { id: created._id, name: created.name, ownerId: null };
  }

  const roles = ['manager', 'cook', 'waiter', 'cashier', 'client'];
  const users = {};
  for (const role of roles) {
    users[role] = await ensureUser({
      name: `Demo ${role}`,
      email: `${role}@rswork.com`,
      role,
      // clients aren't tied to a restaurant; staff are
      restaurantId: role === 'client' ? undefined : restaurant.id,
    });
  }

  // The manager owns the restaurant (so ownership-based lookups work too).
  if (!restaurant.ownerId && users.manager) {
    await restaurants.update(restaurant.id, { ownerId: users.manager._id });
  }

  const plats = await ensureCategory(restaurant.id, { fr: 'Plats', en: 'Dishes', ar: 'أطباق' });
  const boissons = await ensureCategory(restaurant.id, { fr: 'Boissons', en: 'Drinks', ar: 'مشروبات' });

  const pizza = await ensureMenuItem(restaurant.id, plats, {
    name: { fr: 'Pizza Margherita', en: 'Margherita Pizza', ar: 'بيتزا' },
    price: 20,
    prepStation: 'kitchen',
  });
  const coke = await ensureMenuItem(restaurant.id, boissons, {
    name: { fr: 'Coca-Cola', en: 'Coke', ar: 'كوكا' },
    price: 5,
    prepStation: 'bar',
  });

  const [table] = await sql`
    insert into tables (restaurant_id, number, capacity) values (${restaurant.id}, 1, 4)
    on conflict (restaurant_id, number) do update set number = excluded.number
    returning id, number
  `;

  console.log('=== Seed complete ===');
  console.log(`Restaurant : ${restaurant.name}  (id: ${restaurant.id})`);
  console.log(`Table      : #${table.number}  (id: ${table.id})`);
  console.log(`Category   : Plats (${plats}), Boissons (${boissons})`);
  console.log(`MenuItem   : Pizza (${pizza}), Coca (${coke})`);
  console.log('\nLogins (password for all):', PASSWORD);
  roles.forEach((r) => console.log(`  ${r.padEnd(8)} ${r}@rswork.com`));
  console.log('\nTip: log in as manager → Tables → Regenerate QR to get scannable QR codes.');

  await sql.end();
  process.exit(0);
})().catch(async (err) => {
  console.error('Seed failed:', err.message);
  await sql.end().catch(() => {});
  process.exit(1);
});
