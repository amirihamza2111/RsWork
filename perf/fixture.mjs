/**
 * Throwaway restaurant for the k6 load tests, so they never touch the demo data.
 *
 *   node --env-file=.env perf/fixture.mjs create    -> writes perf/.fixture.json
 *   node --env-file=.env perf/fixture.mjs destroy   -> deletes everything it created
 *
 * Needs SUPABASE_SECRET_KEY (repo-root .env). The JSON holds ids, the public
 * URL/key and a throwaway cook login for the run; it is gitignored.
 */
import { readFile, rm, writeFile } from 'node:fs/promises'
import { admin, check } from '../scripts/lib/supabase.mjs'

const FILE = new URL('./.fixture.json', import.meta.url)
const TABLES = 60
const PASSWORD = `perf-${Math.random().toString(36).slice(2, 10)}`

async function create() {
  const tag = Date.now().toString(36)
  const { data: owner, error } = await admin.auth.admin.createUser({
    email: `perf-owner-${tag}@rswork-test.dev`,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { name: 'Perf owner', restaurant_name: `Perf ${tag}`, currency: 'TND' },
  })
  if (error) throw error
  const { restaurant_id: restaurantId } = check(
    await admin.from('profiles').select('restaurant_id').eq('id', owner.user.id).single()
  )

  const cookEmail = `perf-cook-${tag}@rswork-test.dev`
  const { data: cook, error: cookError } = await admin.auth.admin.createUser({
    email: cookEmail,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { name: 'Perf cook' },
    app_metadata: { staff_role: 'cook', restaurant_id: restaurantId },
  })
  if (cookError) throw cookError

  // A realistic menu: the demo restaurant's items, same prices and photos.
  const demo = check(await admin.from('menu_items').select('name, price, image, prep_station').limit(21))
  const [category] = check(
    await admin
      .from('categories')
      .insert({ restaurant_id: restaurantId, name: { fr: 'Carte', en: 'Menu', ar: 'القائمة' } })
      .select('id')
  )
  const items = check(
    await admin
      .from('menu_items')
      .insert(demo.map((m) => ({ ...m, restaurant_id: restaurantId, category_id: category.id })))
      .select('id')
  )
  const tables = check(
    await admin
      .from('tables')
      .insert(Array.from({ length: TABLES }, (_, i) => ({ restaurant_id: restaurantId, number: i + 1 })))
      .select('id')
  )

  const fixture = {
    supabaseUrl: process.env.SUPABASE_URL,
    publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY,
    restaurantId,
    itemIds: items.map((i) => i.id),
    tableIds: tables.map((t) => t.id),
    cook: { email: cookEmail, password: PASSWORD },
    userIds: [owner.user.id, cook.user.id],
  }
  await writeFile(FILE, JSON.stringify(fixture, null, 2))
  console.log(`fixture ready: restaurant ${restaurantId}, ${items.length} items, ${tables.length} tables`)
}

async function destroy() {
  const fixture = JSON.parse(await readFile(FILE, 'utf8'))
  const { count } = await admin.from('orders').select('id', { count: 'exact', head: true }).eq('restaurant_id', fixture.restaurantId)
  check(await admin.from('restaurants').delete().eq('id', fixture.restaurantId))
  for (const id of fixture.userIds) await admin.auth.admin.deleteUser(id)
  await rm(FILE)
  console.log(`fixture removed (restaurant, ${count} orders, ${fixture.userIds.length} users)`)
}

const command = process.argv[2]
if (command === 'create') await create()
else if (command === 'destroy') await destroy()
else console.error('usage: fixture.mjs create|destroy')
process.exit(0)
