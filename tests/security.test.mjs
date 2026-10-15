// Security checks against the live Supabase project: SQL injection, stored
// XSS, IDOR / tenant isolation, overposting (mass assignment), JWT validation
// and password-reset authorization. Fixtures are namespaced by RUN and deleted.
import test from 'node:test'
import assert from 'node:assert/strict'
import { admin, check, publicClient, signedIn } from '../scripts/lib/supabase.mjs'

const RUN = `sec${Date.now().toString(36)}`
const PASSWORD = 'password123'
const email = (label) => `${label}.${RUN}@rswork-test.dev`
const { SUPABASE_URL: URL_, SUPABASE_PUBLISHABLE_KEY: KEY } = process.env

const users = []
const restaurants = []
const s = {}

async function createUser(label, { userMetadata = {}, appMetadata = {} } = {}) {
  const { data, error } = await admin.auth.admin.createUser({
    email: email(label),
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { name: label, ...userMetadata },
    app_metadata: appMetadata,
  })
  if (error) throw error
  users.push(data.user.id)
  return check(await admin.from('profiles').select('*').eq('id', data.user.id).single())
}
const staff = (label, role, restaurantId) => createUser(label, { appMetadata: { staff_role: role, restaurant_id: restaurantId } })
const rpcError = async (promise) => {
  const { error } = await promise
  assert.ok(error, 'expected the call to be refused')
  return error
}
// Raw REST call, to send exactly the headers/tokens an attacker would.
const raw = (path, { token, method = 'GET', body } = {}) =>
  fetch(`${URL_}${path}`, {
    method,
    headers: { apikey: KEY, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')

async function seedRestaurant(managerClient, restaurantId) {
  const category = check(
    await managerClient.from('categories').insert({ restaurant_id: restaurantId, name: { fr: 'Plats', en: 'Dishes', ar: 'أطباق' } }).select('id').single()
  )
  const item = check(
    await managerClient
      .from('menu_items')
      .insert({ restaurant_id: restaurantId, category_id: category.id, name: { fr: 'Plat', en: 'Dish', ar: 'طبق' }, price: 10 })
      .select('id')
      .single()
  )
  const table = check(await managerClient.from('tables').insert({ restaurant_id: restaurantId, number: 1 }).select('id').single())
  return { itemId: item.id, tableId: table.id }
}

test.before(async () => {
  s.managerA = await createUser('managerA', { userMetadata: { restaurant_name: `Sec A ${RUN}` } })
  s.managerB = await createUser('managerB', { userMetadata: { restaurant_name: `Sec B ${RUN}` } })
  s.A = s.managerA.restaurant_id
  s.B = s.managerB.restaurant_id
  restaurants.push(s.A, s.B)
  s.cookA = await staff('cookA', 'cook', s.A)
  s.waiterA = await staff('waiterA', 'waiter', s.A)
  s.cashierA = await staff('cashierA', 'cashier', s.A)
  s.client = await createUser('client')

  s.as = {}
  for (const label of ['managerA', 'managerB', 'cookA', 'waiterA', 'cashierA', 'client']) {
    s.as[label] = await signedIn(email(label), PASSWORD)
  }
  s.anon = publicClient()
  s.tokenA = (await s.as.managerA.auth.getSession()).data.session.access_token

  Object.assign(s, { a: await seedRestaurant(s.as.managerA, s.A), b: await seedRestaurant(s.as.managerB, s.B) })
  const session = check(await s.anon.rpc('open_table_session', { p_table: s.a.tableId })).session.id
  s.sessionA = session
  s.orderA = check(
    await s.anon.rpc('place_order', { p_table: s.a.tableId, p_session: session, p_items: [{ menuItem: s.a.itemId, quantity: 1 }] })
  )._id
})

test.after(async () => {
  for (const id of restaurants) await admin.from('restaurants').delete().eq('id', id)
  for (const id of users) await admin.auth.admin.deleteUser(id)
})

/* ------------------------------------------------------------ SQL injection */

test('sqli: string parameters are data, never SQL', async () => {
  const payload = "x'); delete from public.orders; drop table public.orders; --"
  const fb = check(await s.anon.rpc('submit_feedback', { p_rating: 3, p_order: s.orderA, p_category: payload, p_comment: payload }))
  assert.equal(fb.comment, payload, 'stored verbatim (no HTML in it to strip)')
  const billed = check(await s.anon.rpc('request_bill', { p_order: s.orderA, p_method: "card' or '1'='1" }))
  assert.equal(billed.method, 'cash', 'unknown methods fall back to cash')
  const stillThere = check(await admin.from('orders').select('id').eq('id', s.orderA))
  assert.equal(stillThere.length, 1, 'orders table and row intact')
})

test('sqli: injected ids are rejected as invalid uuids', async () => {
  const error = await rpcError(s.anon.rpc('get_order', { p_order: "00000000-0000-0000-0000-000000000000' or 1=1 --" }))
  assert.equal(error.code, '22P02')
})

test('sqli: PostgREST filters are parameterized', async () => {
  const rows = check(await s.anon.from('menu_items').select('id').eq('name->>fr', "' OR '1'='1"))
  assert.equal(rows.length, 0)
  const res = await raw(`/rest/v1/menu_items?select=id&restaurant_id=eq.${s.A}%27%20or%20%271%27%3D%271`)
  assert.ok(res.status >= 400, `malformed filter refused (got ${res.status})`)
})

/* ---------------------------------------------------------------- stored XSS */

test('xss: diner free text is stripped of HTML before it is stored', async () => {
  const session = check(await s.anon.rpc('open_table_session', { p_table: s.b.tableId })).session.id
  const order = check(
    await s.anon.rpc('place_order', {
      p_table: s.b.tableId,
      p_session: session,
      p_notes: '<img src=x onerror=alert(1)>No onions<script>steal()</script>',
      p_items: [{ menuItem: s.b.itemId, quantity: 1, comment: '<svg onload=alert(2)>well done', options: '<a href="javascript:x">big</a>' }],
    })
  )
  const stored = check(await admin.from('orders').select('notes').eq('id', order._id).single())
  const item = check(await admin.from('order_items').select('comment, options').eq('order_id', order._id).single())
  for (const value of [stored.notes, item.comment, item.options]) assert.doesNotMatch(value, /[<>]/)
  assert.equal(stored.notes, 'No onionssteal()')
})

/* -------------------------------------------------- IDOR / tenant isolation */

test('idor: a manager cannot read another restaurant’s data', async () => {
  for (const table of ['orders', 'order_items', 'payments', 'feedback', 'tables', 'restaurants', 'waiter_presence']) {
    const rows = check(await s.as.managerB.from(table).select('*'))
    const leaked = rows.filter((r) => r.restaurant_id === s.A || r.id === s.A || r.order_id === s.orderA)
    assert.equal(leaked.length, 0, `${table} leaked rows of restaurant A`)
  }
  const profiles = check(await s.as.managerB.from('profiles').select('id, restaurant_id'))
  assert.ok(profiles.every((p) => p.restaurant_id !== s.A), 'profiles of restaurant A leaked')
})

test('idor: a manager cannot change or delete another restaurant’s rows', async () => {
  check(await s.as.managerB.from('menu_items').update({ price: 0.01 }).eq('id', s.a.itemId))
  check(await s.as.managerB.from('tables').delete().eq('id', s.a.tableId))
  check(await s.as.managerB.from('feedback').update({ status: 'reviewed' }).eq('order_id', s.orderA))
  assert.equal(Number(check(await admin.from('menu_items').select('price').eq('id', s.a.itemId).single()).price), 10)
  assert.equal(check(await admin.from('tables').select('id').eq('id', s.a.tableId)).length, 1)
  assert.equal(check(await admin.from('feedback').select('status').eq('order_id', s.orderA).single()).status, 'new')
})

test('idor: staff RPCs refuse another restaurant’s ids', async () => {
  const m = s.as.managerB
  const calls = [
    m.rpc('kds_orders', { p_restaurant: s.A }),
    m.rpc('set_order_status', { p_order: s.orderA, p_status: 'cancelled' }),
    m.rpc('claim_order', { p_order: s.orderA }),
    m.rpc('start_cash_payment', { p_order: s.orderA }),
    m.rpc('active_orders_by_table', { p_restaurant: s.A, p_table_number: 1 }),
    m.rpc('update_restaurant', { p_restaurant: s.A, p_patch: { name: 'pwned' } }),
    m.rpc('report_dashboard', { p_restaurant: s.A }),
    m.rpc('report_ai_analytics', { p_restaurant: s.A }),
  ]
  for (const call of calls) assert.equal((await rpcError(call)).code, 'PT403')
  const ai = await m.functions.invoke('ai-report', { body: { restaurantId: s.A } })
  assert.equal(ai.error?.context?.status, 403)
})

test('idor: roles only get their own actions (least privilege)', async () => {
  assert.equal((await rpcError(s.as.cookA.rpc('update_restaurant', { p_restaurant: s.A, p_patch: { name: 'x' } }))).code, 'PT403')
  assert.equal((await rpcError(s.as.cookA.rpc('report_dashboard', { p_restaurant: s.A }))).code, 'PT403')
  assert.equal((await rpcError(s.as.waiterA.rpc('start_cash_payment', { p_order: s.orderA }))).code, 'PT403')
  assert.equal((await rpcError(s.as.client.rpc('kds_orders', { p_restaurant: s.A }))).code, 'PT403')
  const { error } = await s.as.cookA.from('menu_items').insert({ restaurant_id: s.A, category_id: null, name: { fr: 'x', en: 'x', ar: 'x' }, price: 1 })
  assert.ok(error, 'a cook cannot edit the menu')
  const created = await s.as.waiterA.functions.invoke('staff-admin', {
    body: { action: 'create', name: 'x', email: email('x'), password: PASSWORD, role: 'manager' },
  })
  assert.equal(created.error?.context?.status, 403, 'a waiter cannot create accounts')
})

test('idor: a public order lookup never exposes customer or staff identity', async () => {
  const order = check(await s.anon.rpc('get_order', { p_order: s.orderA }))
  assert.ok(!('client' in order) && !('waiter' in order))
  const other = check(await s.as.client.rpc('get_order', { p_order: s.orderA }))
  assert.ok(!('client' in other), 'another customer gets the PII-free view too')
})

test('idor: storage writes and deletes are confined to the restaurant folder', async () => {
  const png = new Blob([Uint8Array.from([137, 80, 78, 71])], { type: 'image/png' })
  const path = `${s.A}/${RUN}.png`
  assert.ifError((await s.as.managerA.storage.from('menu-images').upload(path, png)).error)
  await s.as.managerB.storage.from('menu-images').remove([path])
  const { data } = await admin.storage.from('menu-images').list(s.A)
  assert.ok(data.some((f) => f.name === `${RUN}.png`), 'manager B deleted a file of restaurant A')
  assert.ok((await s.as.managerB.storage.from('menu-images').upload(`${s.A}/../${s.A}/evil.png`, png)).error)
  await admin.storage.from('menu-images').remove([path])
})

/* ------------------------------------------- overposting / mass assignment */

test('overposting: users cannot raise their own role or move restaurants', async () => {
  await s.as.client.from('profiles').update({ role: 'superadmin', restaurant_id: s.A }).eq('id', s.client.id)
  await s.as.cookA.from('profiles').update({ role: 'manager' }).eq('id', s.cookA.id)
  assert.equal(check(await admin.from('profiles').select('role').eq('id', s.client.id).single()).role, 'client')
  assert.equal(check(await admin.from('profiles').select('role').eq('id', s.cookA.id).single()).role, 'cook')
})

test('overposting: update_restaurant only accepts whitelisted fields', async () => {
  check(
    await s.as.managerA.rpc('update_restaurant', {
      p_restaurant: s.A,
      p_patch: { name: `Sec A2 ${RUN}`, owner_id: s.managerB.id, is_active: false, id: s.B },
    })
  )
  const r = check(await admin.from('restaurants').select('name, owner_id, is_active').eq('id', s.A).single())
  assert.equal(r.name, `Sec A2 ${RUN}`)
  assert.equal(r.owner_id, s.managerA.id, 'owner cannot be reassigned through the patch')
  assert.equal(r.is_active, true)
})

test('overposting: rows cannot be moved into another restaurant', async () => {
  const moved = await s.as.managerA.from('menu_items').update({ restaurant_id: s.B }).eq('id', s.a.itemId)
  assert.ok(moved.error, 'moving a menu item to restaurant B must fail')
  const inserted = await s.as.managerA.from('tables').insert({ restaurant_id: s.B, number: 99 })
  assert.ok(inserted.error)
})

test('overposting: orders, payments and items cannot be written directly', async () => {
  assert.ok((await s.anon.from('orders').insert({ restaurant_id: s.A, total_amount: 0 })).error)
  assert.ok((await s.as.managerA.from('payments').insert({ order_id: s.orderA, restaurant_id: s.A, amount: 0, method: 'cash', status: 'completed' })).error)
  await s.as.managerA.from('orders').update({ total_amount: 0, payment_status: 'paid' }).eq('id', s.orderA)
  const order = check(await admin.from('orders').select('total_amount, payment_status').eq('id', s.orderA).single())
  assert.equal(Number(order.total_amount), 10)
  assert.equal(order.payment_status, 'unpaid')
})

/* ----------------------------------------------------------- JWT validation */

test('jwt: forged and tampered tokens are rejected', async () => {
  const [header, payload] = s.tokenA.split('.')
  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString())
  const forged = {
    'alg none': `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ ...claims, role: 'service_role' })}.`,
    'tampered claims': `${header}.${b64url({ ...claims, role: 'service_role', sub: s.managerB.id })}.${s.tokenA.split('.')[2]}`,
    'bad signature': `${header}.${payload}.${Buffer.from('not-the-signature').toString('base64url')}`,
    expired: `${header}.${b64url({ ...claims, exp: 1 })}.${s.tokenA.split('.')[2]}`,
  }
  for (const [label, token] of Object.entries(forged)) {
    const rest = await raw('/rest/v1/orders?select=id', { token })
    assert.equal(rest.status, 401, `REST accepted a ${label} token`)
    const fn = await fetch(`${URL_}/functions/v1/staff-admin`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'deactivate', userId: s.cookA.id }),
    })
    assert.equal(fn.status, 401, `Edge Function accepted a ${label} token`)
  }
  assert.equal((await raw('/rest/v1/orders?select=id', { token: s.tokenA })).status, 200, 'the genuine token works')
})

/* -------------------------------------------- password reset authorization */

test('password reset: only a manager of the same restaurant, never the owner’s', async () => {
  const byWaiter = await s.as.waiterA.functions.invoke('staff-admin', { body: { action: 'update', userId: s.cookA.id, password: 'hacked-123' } })
  assert.equal(byWaiter.error?.context?.status, 403)
  const byOtherRestaurant = await s.as.managerB.functions.invoke('staff-admin', {
    body: { action: 'update', userId: s.cookA.id, password: 'hacked-123' },
  })
  assert.equal(byOtherRestaurant.error?.context?.status, 403)
  const anonymous = await fetch(`${URL_}/functions/v1/staff-admin`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'update', userId: s.cookA.id, password: 'hacked-123' }),
  })
  assert.equal(anonymous.status, 401)
  await signedIn(email('cookA'), PASSWORD) // still the original password
})
