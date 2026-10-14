/**
 * Seeds the "RsWork Demo" restaurant: one account per role, the Tunisian demo
 * menu (5 categories, 21 items), six tables and 90 days of order history (so
 * the dashboard, AI report and forecast have data). Menu photos ship with the
 * repo (scripts/assets/menu, WebP) and are uploaded to Supabase Storage.
 * Idempotent — re-running never duplicates anything and never overwrites edits
 * made in the dashboard.
 *
 * Usage (repo root, with .env filled in):  npm run seed
 */
import { readFile } from 'node:fs/promises'
import { admin, check } from './lib/supabase.mjs'

const PASSWORD = 'password123'
const RESTAURANT = 'RsWork Demo'

const MENU = [
  {
    category: { fr: 'Entrées', en: 'Starters', ar: 'مقبلات' },
    station: 'kitchen',
    items: [
      { fr: 'Fricassé Thon', en: 'Tuna Fricassé', ar: 'فريكاسي بالتن', price: 4.5, photo: 'fricasse-thon.webp' },
      { fr: 'Lablabi', en: 'Lablabi', ar: 'لبلابي', price: 5, photo: 'lablabi.webp' },
      { fr: 'Ojja Merguez', en: 'Merguez Ojja', ar: 'عجة مرقاز', price: 9, photo: 'ojja-merguez.webp' },
    ],
  },
  {
    category: { fr: 'Couscous', en: 'Couscous', ar: 'كسكسي' },
    station: 'kitchen',
    items: [
      { fr: 'Couscous Agneau', en: 'Lamb Couscous', ar: 'كسكسي بالضاني', price: 22, photo: 'couscous-agneau.webp' },
      { fr: 'Couscous Poulet', en: 'Chicken Couscous', ar: 'كسكسي بالدجاج', price: 16, photo: 'couscous-poulet.webp' },
      { fr: 'Couscous Poisson', en: 'Fish Couscous', ar: 'كسكسي بالحوت', price: 20, photo: 'couscous-poisson.webp' },
    ],
  },
  {
    category: { fr: 'Plats Tunisiens', en: 'Tunisian Dishes', ar: 'أطباق تونسية' },
    station: 'kitchen',
    items: [
      { fr: 'Kamounia', en: 'Kamounia', ar: 'كمونية', price: 12, photo: 'kamounia.webp' },
      { fr: 'Mloukhia', en: 'Mloukhia', ar: 'ملوخية', price: 13, photo: 'mloukhia.webp' },
      { fr: 'Riz Djerbien', en: 'Djerbian Rice', ar: 'أرز جربي', price: 16, photo: 'riz-djerbien.webp' },
      { fr: 'Kafteji Royal', en: 'Royal Kafteji', ar: 'كفتاجي رويال', price: 10, photo: 'kafteji-royal.webp' },
      { fr: 'Makarouna Salsa Escalope', en: 'Escalope Pasta', ar: 'مكرونة بالصلصة والاسكالوب', price: 14, photo: 'makarouna-salsa-escalope.webp' },
    ],
  },
  {
    category: { fr: 'Grillades', en: 'Grills', ar: 'مشاوي' },
    station: 'kitchen',
    items: [
      { fr: 'Grillade Mixte', en: 'Mixed Grill', ar: 'مشوي مشكل', price: 28, photo: 'grillade-mixte.webp' },
      { fr: 'Brochettes de Poulet', en: 'Chicken Skewers', ar: 'بروشات دجاج', price: 18, photo: 'brochettes-de-poulet.webp' },
      { fr: 'Escalope Grillée', en: 'Grilled Escalope', ar: 'اسكالوب مشوي', price: 16, photo: 'escalope-grillee.webp' },
      { fr: 'Merguez Grillée', en: 'Grilled Merguez', ar: 'مرقاز مشوي', price: 15, photo: 'merguez-grillee.webp' },
      { fr: 'Poisson Grillé', en: 'Grilled Fish', ar: 'سمك مشوي', price: 24, photo: 'poisson-grille.webp' },
    ],
  },
  {
    category: { fr: 'Boissons', en: 'Drinks', ar: 'مشروبات' },
    station: 'bar',
    items: [
      { fr: 'Jus', en: 'Juice', ar: 'عصير', price: 5, photo: 'jus.webp' },
      { fr: 'Thé', en: 'Tea', ar: 'شاي', price: 2.5, photo: 'the.webp' },
      { fr: 'Café Turc', en: 'Turkish Coffee', ar: 'قهوة تركي', price: 2.5, photo: 'cafe-turc.webp' },
      { fr: 'Eau Minérale', en: 'Mineral Water', ar: 'ماء معدني', price: 2, photo: 'eau-minerale.webp' },
      { fr: 'Soda', en: 'Soda', ar: 'صودا', price: 3, photo: 'soda.webp' },
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

// Demo photos live in the restaurant's Storage folder, like uploads from the
// dashboard (<restaurant_id>/...). Each file is uploaded once.
const BUCKET = 'menu-images'
const photoFolder = `${restaurantId}/demo`
const storedPhotos = new Set(
  check(await admin.storage.from(BUCKET).list(photoFolder, { limit: 100 })).map((f) => f.name)
)
async function demoPhotoUrl(file) {
  if (!storedPhotos.has(file)) {
    const body = await readFile(new URL(`./assets/menu/${file}`, import.meta.url))
    check(await admin.storage.from(BUCKET).upload(`${photoFolder}/${file}`, body, { contentType: 'image/webp', upsert: true }))
    storedPhotos.add(file)
  }
  return admin.storage.from(BUCKET).getPublicUrl(`${photoFolder}/${file}`).data.publicUrl
}
// Seeded items created before the photos moved to Storage still point at the
// old Cloudinary account; anything else was set by the manager and is kept.
const isLegacyPhoto = (url) => !url || url.includes('res.cloudinary.com')

let itemsCreated = 0
let photosMoved = 0
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
      await admin.from('menu_items').select('id, image').eq('restaurant_id', restaurantId).eq('name->>fr', item.fr).maybeSingle()
    )
    if (exists) {
      if (isLegacyPhoto(exists.image)) {
        check(await admin.from('menu_items').update({ image: await demoPhotoUrl(item.photo) }).eq('id', exists.id))
        photosMoved += 1
      }
      continue
    }
    check(
      await admin.from('menu_items').insert({
        restaurant_id: restaurantId,
        category_id: category.id,
        name: { fr: item.fr, en: item.en, ar: item.ar },
        price: item.price,
        image: await demoPhotoUrl(item.photo),
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

// ------------------------------------------------------------ order history
// 90 days up to yesterday, generated from a fixed seed so every run looks the
// same: lunch and dinner peaks, busier weekends, a slow upward trend, ~3%
// cancellations, payments for every paid order and feedback on some of them.
const HISTORY_DAYS = 90
const TZ_OFFSET_HOURS = 1 // Africa/Tunis is UTC+1 all year
// Orders per weekday, Sunday first.
const DAILY_ORDERS = [36, 22, 24, 26, 30, 42, 48]
const COMMENTS = {
  5: ['Excellent, as always!', 'Le couscous était parfait.', 'Service rapide, merci.', 'Best lablabi in town.'],
  4: ['Très bon, un peu d’attente.', 'Good food, busy evening.', 'Bon rapport qualité-prix.'],
  3: ['Correct, sans plus.', 'The grill was a bit dry.'],
  2: ['Too long to get our order.', 'Plat servi tiède.'],
  1: ['Commande oubliée, déçu.'],
}

function mulberry32(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = mulberry32(2026)
const between = (min, max) => min + rand() * (max - min)
const pick = (list) => list[Math.floor(rand() * list.length)]
const weighted = (entries) => {
  let r = rand() * entries.reduce((sum, [, w]) => sum + w, 0)
  for (const [value, w] of entries) if ((r -= w) <= 0) return value
  return entries.at(-1)[0]
}

async function insertInBatches(table, rows, size = 500) {
  for (let i = 0; i < rows.length; i += size) check(await admin.from(table).insert(rows.slice(i, i + size)))
}

const today = new Date()
today.setUTCHours(0, 0, 0, 0)

// Days in the window that have no orders yet. Re-running the seed later tops
// the history up to yesterday, so the demo dashboard and forecast stay current.
const emptyDays = []
for (let d = HISTORY_DAYS; d >= 1; d -= 1) {
  const day = new Date(today.getTime() - d * 86_400_000)
  const { count } = await admin
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('restaurant_id', restaurantId)
    .gte('created_at', day.toISOString())
    .lt('created_at', new Date(day.getTime() + 86_400_000).toISOString())
  if (!count) emptyDays.push(d)
}

let historyOrders = 0
if (emptyDays.length) {
  const items = check(await admin.from('menu_items').select('id, name, price, prep_station').eq('restaurant_id', restaurantId))
  const byName = Object.fromEntries(items.map((i) => [i.name.fr, i]))
  const staff = check(await admin.from('profiles').select('id, name, role').eq('restaurant_id', restaurantId))
  const waiters = staff.filter((p) => p.role === 'waiter')
  const cook = staff.find((p) => p.role === 'cook')
  const tables = check(await admin.from('tables').select('id').eq('restaurant_id', restaurantId))

  // Popularity weights: couscous and grills sell most, drinks go with most orders.
  const mains = [
    ['Couscous Agneau', 9], ['Couscous Poulet', 8], ['Couscous Poisson', 5], ['Kamounia', 4], ['Mloukhia', 3],
    ['Riz Djerbien', 4], ['Kafteji Royal', 6], ['Makarouna Salsa Escalope', 7], ['Grillade Mixte', 7],
    ['Brochettes de Poulet', 8], ['Escalope Grillée', 6], ['Merguez Grillée', 4], ['Poisson Grillé', 5],
  ]
  const starters = [['Fricassé Thon', 5], ['Lablabi', 6], ['Ojja Merguez', 4]]
  const drinks = [['Jus', 5], ['Thé', 6], ['Café Turc', 4], ['Eau Minérale', 6], ['Soda', 5]]

  const orders = []
  const orderItems = []
  const payments = []
  const feedback = []

  for (const d of emptyDays) {
    const day = new Date(today.getTime() - d * 86_400_000)
    const trend = 0.85 + (0.25 * (HISTORY_DAYS - d)) / HISTORY_DAYS
    const count = Math.round(DAILY_ORDERS[day.getUTCDay()] * trend * between(0.85, 1.15))
    const stamp = day.toISOString().slice(0, 10).replaceAll('-', '')

    const times = Array.from({ length: count }, () => {
      const localHour = rand() < 0.6 ? between(12, 14.5) : between(19, 22.5)
      return new Date(day.getTime() + (localHour - TZ_OFFSET_HOURS) * 3_600_000)
    }).sort((a, b) => a - b)

    times.forEach((createdAt, index) => {
      const id = crypto.randomUUID()
      const lines = [{ item: byName[weighted(mains)], quantity: rand() < 0.3 ? 2 : 1 }]
      if (rand() < 0.6) lines.push({ item: byName[weighted(starters)], quantity: 1 })
      if (rand() < 0.8) lines.push({ item: byName[weighted(drinks)], quantity: 1 + Math.floor(rand() * 3) })
      const total = lines.reduce((sum, l) => sum + Number(l.item.price) * l.quantity, 0)
      const cancelled = rand() < 0.03
      const method = rand() < 0.7 ? 'cash' : 'card'
      const waiter = pick(waiters)
      const servedAt = new Date(createdAt.getTime() + between(25, 45) * 60_000)

      orders.push({
        id,
        restaurant_id: restaurantId,
        order_number: `ORD-${stamp}-${String(index + 1).padStart(4, '0')}`,
        table_id: pick(tables).id,
        waiter_id: waiter.id,
        prepared_by_id: cancelled ? null : cook.id,
        prepared_by_name: cancelled ? null : cook.name,
        served_by_id: cancelled ? null : waiter.id,
        status: cancelled ? 'cancelled' : 'served',
        payment_status: cancelled ? 'unpaid' : 'paid',
        payment_method: method,
        total_amount: total,
        created_at: createdAt.toISOString(),
        updated_at: servedAt.toISOString(),
      })
      lines.forEach((l, position) =>
        orderItems.push({
          order_id: id,
          menu_item_id: l.item.id,
          quantity: l.quantity,
          price: l.item.price,
          status: cancelled ? 'queued' : 'served',
          prep_station: l.item.prep_station,
          position,
        })
      )
      if (cancelled) return

      const paidAt = new Date(servedAt.getTime() + between(20, 50) * 60_000).toISOString()
      payments.push({ order_id: id, restaurant_id: restaurantId, amount: total, method, status: 'completed', paid_at: paidAt, created_at: paidAt })
      if (rand() < 0.12) {
        const rating = weighted([[5, 45], [4, 35], [3, 12], [2, 5], [1, 3]])
        feedback.push({
          restaurant_id: restaurantId,
          order_id: id,
          rating,
          comment: rand() < 0.7 ? pick(COMMENTS[rating]) : null,
          status: d > 7 ? 'reviewed' : 'new',
          reviewed_at: d > 7 ? paidAt : null,
          created_at: paidAt,
        })
      }
    })
  }

  await insertInBatches('orders', orders)
  await insertInBatches('order_items', orderItems, 1000)
  await insertInBatches('payments', payments)
  await insertInBatches('feedback', feedback)
  historyOrders = orders.length
}

console.log('=== Seed complete ===')
console.log(`Restaurant : ${RESTAURANT} (${restaurantId})`)
console.log(`Menu items : ${itemsCreated} created, ${photosMoved} photo(s) moved to Storage`)
console.log(`History    : ${historyOrders ? `${historyOrders} orders added over ${emptyDays.length} empty day(s)` : 'up to date'}`)
console.log(`Logins (password "${PASSWORD}"): manager / cook / waiter / waiter2 / cashier / client @rswork.com`)
