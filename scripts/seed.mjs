/**
 * Seeds the "RsWork Demo" restaurant: one account per role, the Tunisian demo
 * menu (5 categories, 21 items) and six tables. Idempotent — re-running never
 * duplicates anything and never overwrites edits made in the dashboard.
 *
 * Usage (repo root, with .env filled in):  npm run seed
 */
import { admin, check } from './lib/supabase.mjs'

const PASSWORD = 'password123'
const RESTAURANT = 'RsWork Demo'

const MENU = [
  {
    category: { fr: 'Entrées', en: 'Starters', ar: 'مقبلات' },
    station: 'kitchen',
    items: [
      { fr: 'Fricassé Thon', en: 'Tuna Fricassé', ar: 'فريكاسي بالتن', price: 4.5, image: 'https://res.cloudinary.com/dbiszp8lt/image/upload/f_auto,q_auto/v1776004879/Fricass%C3%A9_thon_jduzc4.jpg' },
      { fr: 'Lablabi', en: 'Lablabi', ar: 'لبلابي', price: 5, image: 'https://res.cloudinary.com/dbiszp8lt/image/upload/f_auto,q_auto/v1776004879/Lablabi_tgzbrd.jpg' },
      { fr: 'Ojja Merguez', en: 'Merguez Ojja', ar: 'عجة مرقاز', price: 9, image: 'https://res.cloudinary.com/dbiszp8lt/image/upload/f_auto,q_auto/v1776004879/Ojja_Merguez_aanpqq.jpg' },
    ],
  },
  {
    category: { fr: 'Couscous', en: 'Couscous', ar: 'كسكسي' },
    station: 'kitchen',
    items: [
      { fr: 'Couscous Agneau', en: 'Lamb Couscous', ar: 'كسكسي بالضاني', price: 22, image: 'https://res.cloudinary.com/dbiszp8lt/image/upload/f_auto,q_auto/v1776004879/Couscous_agneau_u10a1y.png' },
      { fr: 'Couscous Poulet', en: 'Chicken Couscous', ar: 'كسكسي بالدجاج', price: 16, image: 'https://res.cloudinary.com/dbiszp8lt/image/upload/f_auto,q_auto/v1776004878/Couscous_au_poulet_icqdlv.jpg' },
      { fr: 'Couscous Poisson', en: 'Fish Couscous', ar: 'كسكسي بالحوت', price: 20, image: 'https://res.cloudinary.com/dbiszp8lt/image/upload/f_auto,q_auto/v1776004878/Couscous_poisson_e623zr.jpg' },
    ],
  },
  {
    category: { fr: 'Plats Tunisiens', en: 'Tunisian Dishes', ar: 'أطباق تونسية' },
    station: 'kitchen',
    items: [
      { fr: 'Kamounia', en: 'Kamounia', ar: 'كمونية', price: 12, image: 'https://res.cloudinary.com/dbiszp8lt/image/upload/f_auto,q_auto/v1776004878/Kamounia_jny08g.jpg' },
      { fr: 'Mloukhia', en: 'Mloukhia', ar: 'ملوخية', price: 13, image: 'https://res.cloudinary.com/dbiszp8lt/image/upload/f_auto,q_auto/v1776004878/Mloukhia_viande_ftg6zf.jpg' },
      { fr: 'Riz Djerbien', en: 'Djerbian Rice', ar: 'أرز جربي', price: 16, image: 'https://res.cloudinary.com/dbiszp8lt/image/upload/f_auto,q_auto/v1776004878/Riz_Djerbien_edniti.jpg' },
      { fr: 'Kafteji Royal', en: 'Royal Kafteji', ar: 'كفتاجي رويال', price: 10, image: 'https://res.cloudinary.com/dbiszp8lt/image/upload/f_auto,q_auto/v1776004878/Kafteji_royal_dl8jb9.jpg' },
      { fr: 'Makarouna Salsa Escalope', en: 'Escalope Pasta', ar: 'مكرونة بالصلصة والاسكالوب', price: 14, image: 'https://res.cloudinary.com/dbiszp8lt/image/upload/f_auto,q_auto/v1776004878/Makarouna_salsa_escalope_vmkm73.jpg' },
    ],
  },
  {
    category: { fr: 'Grillades', en: 'Grills', ar: 'مشاوي' },
    station: 'kitchen',
    items: [
      { fr: 'Grillade Mixte', en: 'Mixed Grill', ar: 'مشوي مشكل', price: 28, image: 'https://res.cloudinary.com/dbiszp8lt/image/upload/f_auto,q_auto/v1776004876/Grillade_mixte_axebq0.jpg' },
      { fr: 'Brochettes de Poulet', en: 'Chicken Skewers', ar: 'بروشات دجاج', price: 18, image: 'https://res.cloudinary.com/dbiszp8lt/image/upload/f_auto,q_auto/v1776004877/Brochettes_de_poulet_sk4lzr.jpg' },
      { fr: 'Escalope Grillée', en: 'Grilled Escalope', ar: 'اسكالوب مشوي', price: 16, image: 'https://res.cloudinary.com/dbiszp8lt/image/upload/f_auto,q_auto/v1776004877/Escalope_grill%C3%A9e_wuuv9n.jpg' },
      { fr: 'Merguez Grillée', en: 'Grilled Merguez', ar: 'مرقاز مشوي', price: 15, image: 'https://res.cloudinary.com/dbiszp8lt/image/upload/f_auto,q_auto/v1776004877/Merguez_grill%C3%A9e_khbbky.jpg' },
      { fr: 'Poisson Grillé', en: 'Grilled Fish', ar: 'سمك مشوي', price: 24, image: 'https://res.cloudinary.com/dbiszp8lt/image/upload/f_auto,q_auto/v1776004877/Poisson_grill%C3%A9_xdfdbx.jpg' },
    ],
  },
  {
    category: { fr: 'Boissons', en: 'Drinks', ar: 'مشروبات' },
    station: 'bar',
    items: [
      { fr: 'Jus', en: 'Juice', ar: 'عصير', price: 5, image: 'https://res.cloudinary.com/dbiszp8lt/image/upload/f_auto,q_auto/v1776004877/Jus_jl392u.jpg' },
      { fr: 'Thé', en: 'Tea', ar: 'شاي', price: 2.5, image: 'https://res.cloudinary.com/dbiszp8lt/image/upload/f_auto,q_auto/v1776004876/the_qydggx.jpg' },
      { fr: 'Café Turc', en: 'Turkish Coffee', ar: 'قهوة تركي', price: 2.5, image: 'https://res.cloudinary.com/dbiszp8lt/image/upload/f_auto,q_auto/v1776004875/9ahwa_arbi_hruf4f.jpg' },
      { fr: 'Eau Minérale', en: 'Mineral Water', ar: 'ماء معدني', price: 2, image: 'https://res.cloudinary.com/dbiszp8lt/image/upload/f_auto,q_auto/v1776004875/Eau_min%C3%A9rale_gmohyg.jpg' },
      { fr: 'Soda', en: 'Soda', ar: 'صودا', price: 3, image: 'https://res.cloudinary.com/dbiszp8lt/image/upload/f_auto,q_auto/v1776031616/sodaa_tuivfc.jpg' },
    ],
  },
]

const profileByEmail = async (email) =>
  check(await admin.from('profiles').select('id, role, restaurant_id').eq('email', email).maybeSingle())

// Creates a pre-confirmed account; the on_auth_user_created trigger builds the
// profile (and, for the manager, the restaurant itself).
async function ensureUser(email, { userMetadata = {}, appMetadata = {} } = {}) {
  const existing = await profileByEmail(email)
  if (existing) return existing
  const { error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: userMetadata,
    app_metadata: appMetadata,
  })
  if (error) throw new Error(`${email}: ${error.message}`)
  return profileByEmail(email)
}

const manager = await ensureUser('manager@rswork.com', {
  userMetadata: { name: 'Demo manager', restaurant_name: RESTAURANT, currency: 'TND', language: 'fr' },
})
const restaurantId = manager.restaurant_id
check(
  await admin
    .from('restaurants')
    .update({ address: 'Tunis, Tunisia', phone: '+216 00 000 000', settings: { currency: 'TND', language: 'fr', timezone: 'Africa/Tunis' } })
    .eq('id', restaurantId)
    .is('address', null)
)

for (const [email, role, name] of [
  ['cook@rswork.com', 'cook', 'Demo cook'],
  ['waiter@rswork.com', 'waiter', 'Demo waiter'],
  ['waiter2@rswork.com', 'waiter', 'Demo waiter 2'],
  ['cashier@rswork.com', 'cashier', 'Demo cashier'],
]) {
  await ensureUser(email, { userMetadata: { name }, appMetadata: { staff_role: role, restaurant_id: restaurantId } })
}
await ensureUser('client@rswork.com', { userMetadata: { name: 'Demo client' } })

let itemsCreated = 0
for (const [index, group] of MENU.entries()) {
  let category = check(
    await admin.from('categories').select('id').eq('restaurant_id', restaurantId).eq('name->>fr', group.category.fr).maybeSingle()
  )
  if (!category) {
    category = check(
      await admin
        .from('categories')
        .insert({ restaurant_id: restaurantId, name: group.category, sort_order: index + 1 })
        .select('id')
        .single()
    )
  }
  for (const item of group.items) {
    const exists = check(
      await admin.from('menu_items').select('id').eq('restaurant_id', restaurantId).eq('name->>fr', item.fr).maybeSingle()
    )
    if (exists) continue
    check(
      await admin.from('menu_items').insert({
        restaurant_id: restaurantId,
        category_id: category.id,
        name: { fr: item.fr, en: item.en, ar: item.ar },
        price: item.price,
        image: item.image,
        prep_station: group.station,
      })
    )
    itemsCreated += 1
  }
}

check(
  await admin
    .from('tables')
    .upsert(
      [1, 2, 3, 4, 5, 6].map((number) => ({ restaurant_id: restaurantId, number, capacity: 4 })),
      { onConflict: 'restaurant_id,number', ignoreDuplicates: true }
    )
)

console.log('=== Seed complete ===')
console.log(`Restaurant : ${RESTAURANT} (${restaurantId})`)
console.log(`Menu items : ${itemsCreated} created`)
console.log(`Logins (password "${PASSWORD}"): manager / cook / waiter / waiter2 / cashier / client @rswork.com`)
