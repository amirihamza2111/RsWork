/**
 * Imports the real Tunisian menu (5 categories, 21 items) into the RsWork Demo
 * restaurant. Idempotent: existing categories/items (matched by French name) are
 * left untouched, so re-running never duplicates and never clobbers prices you
 * later edit in the dashboard.
 *
 * Images are delivered through Cloudinary's f_auto,q_auto (adaptive WebP/AVIF +
 * auto quality) for optimized loading.
 *
 * Usage:  npm run seed:menu
 */
const mongoose = require('mongoose');
const config = require('../config');
const Restaurant = require('../models/Restaurant');
const Category = require('../models/Category');
const MenuItem = require('../models/MenuItem');

const RESTAURANT_NAME = 'RsWork Demo';

// Deliver Cloudinary images optimized: adaptive format + auto quality.
const optimize = (url) =>
  typeof url === 'string' && url.includes('/upload/') && !url.includes('/upload/f_auto')
    ? url.replace('/upload/', '/upload/f_auto,q_auto/')
    : url;

// Menu data: prices in TND, prepStation drives KDS routing (drinks = bar).
const MENU = [
  {
    category: { fr: 'Entrées', en: 'Starters', ar: 'مقبلات' },
    station: 'kitchen',
    items: [
      { fr: 'Fricassé Thon', en: 'Tuna Fricassé', ar: 'فريكاسي بالتن', price: 4.5, image: 'https://res.cloudinary.com/dbiszp8lt/image/upload/v1776004879/Fricass%C3%A9_thon_jduzc4.jpg' },
      { fr: 'Lablabi', en: 'Lablabi', ar: 'لبلابي', price: 5, image: 'https://res.cloudinary.com/dbiszp8lt/image/upload/v1776004879/Lablabi_tgzbrd.jpg' },
      { fr: 'Ojja Merguez', en: 'Merguez Ojja', ar: 'عجة مرقاز', price: 9, image: 'https://res.cloudinary.com/dbiszp8lt/image/upload/v1776004879/Ojja_Merguez_aanpqq.jpg' },
    ],
  },
  {
    category: { fr: 'Couscous', en: 'Couscous', ar: 'كسكسي' },
    station: 'kitchen',
    items: [
      { fr: 'Couscous Agneau', en: 'Lamb Couscous', ar: 'كسكسي بالضاني', price: 22, image: 'https://res.cloudinary.com/dbiszp8lt/image/upload/v1776004879/Couscous_agneau_u10a1y.png' },
      { fr: 'Couscous Poulet', en: 'Chicken Couscous', ar: 'كسكسي بالدجاج', price: 16, image: 'https://res.cloudinary.com/dbiszp8lt/image/upload/v1776004878/Couscous_au_poulet_icqdlv.jpg' },
      { fr: 'Couscous Poisson', en: 'Fish Couscous', ar: 'كسكسي بالحوت', price: 20, image: 'https://res.cloudinary.com/dbiszp8lt/image/upload/v1776004878/Couscous_poisson_e623zr.jpg' },
    ],
  },
  {
    category: { fr: 'Plats Tunisiens', en: 'Tunisian Dishes', ar: 'أطباق تونسية' },
    station: 'kitchen',
    items: [
      { fr: 'Kamounia', en: 'Kamounia', ar: 'كمونية', price: 12, image: 'https://res.cloudinary.com/dbiszp8lt/image/upload/v1776004878/Kamounia_jny08g.jpg' },
      { fr: 'Mloukhia', en: 'Mloukhia', ar: 'ملوخية', price: 13, image: 'https://res.cloudinary.com/dbiszp8lt/image/upload/v1776004878/Mloukhia_viande_ftg6zf.jpg' },
      { fr: 'Riz Djerbien', en: 'Djerbian Rice', ar: 'أرز جربي', price: 16, image: 'https://res.cloudinary.com/dbiszp8lt/image/upload/v1776004878/Riz_Djerbien_edniti.jpg' },
      { fr: 'Kafteji Royal', en: 'Royal Kafteji', ar: 'كفتاجي رويال', price: 10, image: 'https://res.cloudinary.com/dbiszp8lt/image/upload/v1776004878/Kafteji_royal_dl8jb9.jpg' },
      { fr: 'Makarouna Salsa Escalope', en: 'Escalope Pasta', ar: 'مكرونة بالصلصة والاسكالوب', price: 14, image: 'https://res.cloudinary.com/dbiszp8lt/image/upload/v1776004878/Makarouna_salsa_escalope_vmkm73.jpg' },
    ],
  },
  {
    category: { fr: 'Grillades', en: 'Grills', ar: 'مشاوي' },
    station: 'kitchen',
    items: [
      { fr: 'Grillade Mixte', en: 'Mixed Grill', ar: 'مشوي مشكل', price: 28, image: 'https://res.cloudinary.com/dbiszp8lt/image/upload/v1776004876/Grillade_mixte_axebq0.jpg' },
      { fr: 'Brochettes de Poulet', en: 'Chicken Skewers', ar: 'بروشات دجاج', price: 18, image: 'https://res.cloudinary.com/dbiszp8lt/image/upload/v1776004877/Brochettes_de_poulet_sk4lzr.jpg' },
      { fr: 'Escalope Grillée', en: 'Grilled Escalope', ar: 'اسكالوب مشوي', price: 16, image: 'https://res.cloudinary.com/dbiszp8lt/image/upload/v1776004877/Escalope_grill%C3%A9e_wuuv9n.jpg' },
      { fr: 'Merguez Grillée', en: 'Grilled Merguez', ar: 'مرقاز مشوي', price: 15, image: 'https://res.cloudinary.com/dbiszp8lt/image/upload/v1776004877/Merguez_grill%C3%A9e_khbbky.jpg' },
      { fr: 'Poisson Grillé', en: 'Grilled Fish', ar: 'سمك مشوي', price: 24, image: 'https://res.cloudinary.com/dbiszp8lt/image/upload/v1776004877/Poisson_grill%C3%A9_xdfdbx.jpg' },
    ],
  },
  {
    category: { fr: 'Boissons', en: 'Drinks', ar: 'مشروبات' },
    station: 'bar',
    items: [
      { fr: 'Jus', en: 'Juice', ar: 'عصير', price: 5, image: 'https://res.cloudinary.com/dbiszp8lt/image/upload/v1776004877/Jus_jl392u.jpg' },
      { fr: 'Thé', en: 'Tea', ar: 'شاي', price: 2.5, image: 'https://res.cloudinary.com/dbiszp8lt/image/upload/v1776004876/the_qydggx.jpg' },
      { fr: 'Café Turc', en: 'Turkish Coffee', ar: 'قهوة تركي', price: 2.5, image: 'https://res.cloudinary.com/dbiszp8lt/image/upload/v1776004875/9ahwa_arbi_hruf4f.jpg' },
      { fr: 'Eau Minérale', en: 'Mineral Water', ar: 'ماء معدني', price: 2, image: 'https://res.cloudinary.com/dbiszp8lt/image/upload/v1776004875/Eau_min%C3%A9rale_gmohyg.jpg' },
      { fr: 'Soda', en: 'Soda', ar: 'صودا', price: 3, image: 'https://res.cloudinary.com/dbiszp8lt/image/upload/v1776031616/sodaa_tuivfc.jpg' },
    ],
  },
];

async function ensureCategory(restaurant, name, order) {
  const existing = await Category.findOne({ restaurant, 'name.fr': name.fr });
  if (existing) return { doc: existing, created: false };
  const doc = await Category.create({ restaurant, name, order });
  return { doc, created: true };
}

async function ensureMenuItem(restaurant, category, data) {
  const existing = await MenuItem.findOne({ restaurant, 'name.fr': data.fr });
  if (existing) return false;
  await MenuItem.create({
    restaurant,
    category,
    name: { fr: data.fr, en: data.en, ar: data.ar },
    price: data.price,
    image: optimize(data.image),
    prepStation: data.station,
  });
  return true;
}

(async () => {
  await mongoose.connect(config.dbUri, { serverSelectionTimeoutMS: 15000 });
  console.log(`Connected to ${mongoose.connection.name}\n`);

  const restaurant = await Restaurant.findOne({ name: RESTAURANT_NAME });
  if (!restaurant) {
    console.error(`Restaurant "${RESTAURANT_NAME}" not found — run "npm run seed" first.`);
    process.exit(1);
  }

  let catCreated = 0;
  let itemCreated = 0;
  let itemSkipped = 0;

  for (let i = 0; i < MENU.length; i += 1) {
    const group = MENU[i];
    const { doc: category, created } = await ensureCategory(restaurant._id, group.category, i + 1);
    if (created) catCreated += 1;

    for (const item of group.items) {
      const added = await ensureMenuItem(restaurant._id, category._id, {
        ...item,
        station: group.station,
      });
      if (added) itemCreated += 1;
      else itemSkipped += 1;
    }
    console.log(`  ${group.category.fr.padEnd(16)} ${group.items.length} items`);
  }

  console.log('\n=== Menu import complete ===');
  console.log(`Restaurant     : ${restaurant.name} (${restaurant._id})`);
  console.log(`Categories new : ${catCreated}`);
  console.log(`Items created  : ${itemCreated}`);
  console.log(`Items skipped  : ${itemSkipped} (already existed)`);

  await mongoose.disconnect();
  process.exit(0);
})().catch((err) => {
  console.error('Menu import failed:', err.message);
  process.exit(1);
});
