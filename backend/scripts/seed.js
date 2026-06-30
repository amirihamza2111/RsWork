/**
 * Seeds a demo restaurant, one user per role, two categories, two menu items,
 * and a table — so the API can be exercised end-to-end (e.g. in Postman).
 *
 * Idempotent: re-running it won't create duplicates. Passwords are hashed by the
 * User model's pre-save hook.
 *
 * Usage:  npm run seed
 */
const mongoose = require('mongoose');
const config = require('../config');
const Restaurant = require('../models/Restaurant');
const User = require('../models/User');
const Category = require('../models/Category');
const MenuItem = require('../models/MenuItem');
const Table = require('../models/Table');

const PASSWORD = 'password123';

async function ensureUser(data) {
  const existing = await User.findOne({ email: data.email });
  if (existing) return existing;
  return User.create(data); // pre-save hook hashes the password
}

async function ensureCategory(restaurant, name) {
  const existing = await Category.findOne({ restaurant, 'name.fr': name.fr });
  if (existing) return existing;
  return Category.create({ restaurant, name });
}

async function ensureMenuItem(restaurant, category, data) {
  const existing = await MenuItem.findOne({ restaurant, 'name.fr': data.name.fr });
  if (existing) return existing;
  return MenuItem.create({ ...data, restaurant, category });
}

(async () => {
  await mongoose.connect(config.dbUri, { serverSelectionTimeoutMS: 15000 });
  console.log(`Connected to ${mongoose.connection.name}\n`);

  let restaurant = await Restaurant.findOne({ name: 'RsWork Demo' });
  if (!restaurant) {
    restaurant = await Restaurant.create({
      name: 'RsWork Demo',
      type: 'restaurant',
      address: 'Tunis, Tunisia',
      phone: '+216 00 000 000',
      settings: { currency: 'TND', language: 'fr', timezone: 'Africa/Tunis' },
    });
  }

  const roles = ['manager', 'cook', 'waiter', 'cashier', 'client'];
  const users = {};
  for (const role of roles) {
    users[role] = await ensureUser({
      name: `Demo ${role}`,
      email: `${role}@rswork.com`,
      password: PASSWORD,
      role,
      // clients aren't tied to a restaurant; staff are
      restaurant: role === 'client' ? undefined : restaurant._id,
    });
  }

  const plats = await ensureCategory(restaurant._id, { fr: 'Plats', en: 'Dishes', ar: 'أطباق' });
  const boissons = await ensureCategory(restaurant._id, { fr: 'Boissons', en: 'Drinks', ar: 'مشروبات' });

  const pizza = await ensureMenuItem(restaurant._id, plats._id, {
    name: { fr: 'Pizza Margherita', en: 'Margherita Pizza', ar: 'بيتزا' },
    price: 20,
    prepStation: 'kitchen',
  });
  const coke = await ensureMenuItem(restaurant._id, boissons._id, {
    name: { fr: 'Coca-Cola', en: 'Coke', ar: 'كوكا' },
    price: 5,
    prepStation: 'bar',
  });

  let table = await Table.findOne({ restaurant: restaurant._id, number: 1 });
  if (!table) {
    table = await Table.create({ restaurant: restaurant._id, number: 1, capacity: 4 });
  }

  console.log('=== Seed complete ===');
  console.log(`Restaurant : ${restaurant.name}  (id: ${restaurant._id})`);
  console.log(`Table      : #${table.number}  (id: ${table._id})`);
  console.log(`Category   : Plats (${plats._id}), Boissons (${boissons._id})`);
  console.log(`MenuItem   : Pizza (${pizza._id}), Coca (${coke._id})`);
  console.log('\nLogins (password for all):', PASSWORD);
  roles.forEach((r) => console.log(`  ${r.padEnd(8)} ${r}@rswork.com`));

  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
