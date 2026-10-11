// End-to-end checks against the Supabase project, exercising the same paths the
// app uses: anonymous diners, staff roles, RLS, RPCs, Edge Functions, Realtime.
// Every fixture is namespaced by RUN and deleted afterwards.
import test from 'node:test'
import assert from 'node:assert/strict'
import { admin, check, publicClient, signedIn } from '../scripts/lib/supabase.mjs'

const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const PASSWORD = 'password123'
const email = (label) => `${label}.${RUN}@rswork-test.dev`

const users = []
const restaurants = []
const s = {}

async function createUser(label, { userMetadata = {}, appMetadata = {} } = {}) {
  const { data, error } = await admin.auth.admin.createUser({
    email: email(label),
    password: PASSWORD,
    email_confirm: true,
    user_metadata: userMetadata,
    app_metadata: appMetadata,
  })
  if (error) throw error
  users.push(data.user.id)
  return check(await admin.from('profiles').select('*').eq('id', data.user.id).single())
}

const rpcError = async (promise) => {
  const { error } = await promise
  assert.ok(error, 'expected the call to fail')
  return error
}

const order = (client, items, extra = {}) =>
  client.rpc('place_order', { p_table: s.tableId, p_session: s.sessionId, p_items: items, ...extra })

test.before(async () => {
  // Onboarding path: user metadata creates the restaurant (role is never taken from it).
  s.manager = await createUser('manager', {
    userMetadata: { name: 'Manager', restaurant_name: `Test Bistro ${RUN}`, role: 'superadmin', staff_role: 'superadmin' },
  })
  s.restaurantId = s.manager.restaurant_id
  restaurants.push(s.restaurantId)

  const staff = (label, role) =>
    createUser(label, { userMetadata: { name: label }, appMetadata: { staff_role: role, restaurant_id: s.restaurantId } })
  s.cook = await staff('cook', 'cook')
  s.waiter1 = await staff('waiter1', 'waiter')
  s.waiter2 = await staff('waiter2', 'waiter')
  s.cashier = await staff('cashier', 'cashier')

  s.rival = await createUser('rival', { userMetadata: { name: 'Rival', restaurant_name: `Rival ${RUN}` } })
  restaurants.push(s.rival.restaurant_id)

  s.as = {
    manager: await signedIn(email('manager'), PASSWORD),
    cook: await signedIn(email('cook'), PASSWORD),
    waiter1: await signedIn(email('waiter1'), PASSWORD),
    waiter2: await signedIn(email('waiter2'), PASSWORD),
    cashier: await signedIn(email('cashier'), PASSWORD),
    rival: await signedIn(email('rival'), PASSWORD),
  }
  s.anon = publicClient()
})

test.after(async () => {
  for (const id of restaurants) await admin.from('restaurants').delete().eq('id', id)
  for (const id of users) await admin.auth.admin.deleteUser(id)
})

test('onboarding: sign-up metadata creates a restaurant + manager, never an elevated role', async () => {
  assert.equal(s.manager.role, 'manager')
  const restaurant = check(await admin.from('restaurants').select('owner_id').eq('id', s.restaurantId).single())
  assert.equal(restaurant.owner_id, s.manager.id)
  assert.equal(s.cook.role, 'cook')
  assert.equal(s.cook.restaurant_id, s.restaurantId)
})

test('menu: manager creates categories and items through RLS', async () => {
  const m = s.as.manager
  const category = check(
    await m.from('categories').insert({ restaurant_id: s.restaurantId, name: { fr: 'Plats', en: 'Dishes', ar: 'أطباق' } }).select('id').single()
  )
  const items = check(
    await m
      .from('menu_items')
      .insert([
        { restaurant_id: s.restaurantId, category_id: category.id, name: { fr: 'Pizza', en: 'Pizza', ar: 'بيتزا' }, price: 20, prep_station: 'kitchen' },
        { restaurant_id: s.restaurantId, category_id: category.id, name: { fr: 'Coca', en: 'Coke', ar: 'كوكا' }, price: 5, prep_station: 'bar' },
      ])
      .select('id, prep_station')
  )
  s.pizza = items.find((i) => i.prep_station === 'kitchen').id
  s.coke = items.find((i) => i.prep_station === 'bar').id
  s.tableId = check(await m.from('tables').insert({ restaurant_id: s.restaurantId, number: 7 }).select('id').single()).id
})

test('menu: a manager cannot write into another restaurant', async () => {
  const { error } = await s.as.rival.from('menu_items').update({ price: 1 }).eq('id', s.pizza)
  assert.ifError(error) // RLS filters the row out rather than erroring
  const pizza = check(await admin.from('menu_items').select('price').eq('id', s.pizza).single())
  assert.equal(Number(pizza.price), 20)
  const { error: insertError } = await s.as.rival
    .from('tables')
    .insert({ restaurant_id: s.restaurantId, number: 99 })
  assert.ok(insertError)
})

test('diner: the public menu is readable anonymously; tenant data is not', async () => {
  const menu = check(await s.anon.from('menu_items').select('id').eq('restaurant_id', s.restaurantId))
  assert.equal(menu.length, 2)
  for (const table of ['orders', 'profiles', 'payments', 'tables', 'restaurants', 'feedback']) {
    const rows = check(await s.anon.from(table).select('*').limit(1))
    assert.equal(rows.length, 0, `${table} must not be readable anonymously`)
  }
})

test('diner: a table session is required and resumed on refresh', async () => {
  const first = check(await s.anon.rpc('open_table_session', { p_table: s.tableId }))
  const again = check(await s.anon.rpc('open_table_session', { p_table: s.tableId }))
  assert.equal(first.session.id, again.session.id)
  assert.equal(first.table.restaurant._id, s.restaurantId)
  s.sessionId = first.session.id

  const error = await rpcError(
    s.anon.rpc('place_order', { p_table: s.tableId, p_session: 'stolen', p_items: [{ menuItem: s.pizza, quantity: 1 }] })
  )
  assert.equal(error.code, 'PT403')
})

test('diner: realtime announces the new order on the public table channel', async () => {
  const listener = publicClient()
  const channel = listener.channel(`table:${s.tableId}`)
  const received = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no realtime event within 10s')), 10_000)
    channel.on('broadcast', { event: 'new_order' }, ({ payload }) => {
      clearTimeout(timer)
      resolve(payload)
    })
  })
  await new Promise((resolve) => channel.subscribe((status) => status === 'SUBSCRIBED' && resolve()))

  const placed = check(
    await order(s.anon, [
      { menuItem: s.pizza, quantity: 2, price: 1 }, // client prices are ignored
      { menuItem: s.coke, quantity: 1, price: 1, comment: '<b>no ice</b>' },
    ])
  )
  s.orderId = placed._id
  s.kitchenItem = placed.items.find((i) => i.prepStation === 'kitchen')._id
  assert.equal(Number(placed.totalAmount), 45)
  assert.match(placed.orderNumber, /^ORD-\d{8}-\d{4}$/)
  assert.equal(placed.items.find((i) => i.prepStation === 'bar').comment, 'no ice')
  assert.ok(!('client' in placed) && !('waiter' in placed), 'anonymous view is PII-free')

  const payload = await received
  assert.equal(payload.orderId, s.orderId)
  assert.ok(!('client' in payload))
  await listener.removeChannel(channel)
  listener.realtime.disconnect() // an open socket would keep the test process alive
})

test('diner: order numbers are per restaurant (two restaurants can both have #0001)', async () => {
  const r = s.as.rival
  const rivalId = s.rival.restaurant_id
  const category = check(await r.from('categories').insert({ restaurant_id: rivalId, name: { fr: 'A', en: 'A', ar: 'A' } }).select('id').single())
  const item = check(await r.from('menu_items').insert({ restaurant_id: rivalId, category_id: category.id, name: { fr: 'A', en: 'A', ar: 'A' }, price: 3 }).select('id').single())
  const table = check(await r.from('tables').insert({ restaurant_id: rivalId, number: 1 }).select('id').single())
  const session = check(await s.anon.rpc('open_table_session', { p_table: table.id })).session.id
  const placed = check(await s.anon.rpc('place_order', { p_table: table.id, p_session: session, p_items: [{ menuItem: item.id }] }))
  assert.match(placed.orderNumber, /-0001$/)
})

test('diner: invalid items are rejected', async () => {
  const error = await rpcError(order(s.anon, [{ menuItem: '00000000-0000-4000-8000-000000000000', quantity: 1 }]))
  assert.equal(error.code, 'PT400')
})

test('kds: cooking the kitchen item rolls the order to ready (drinks never block)', async () => {
  const board = check(await s.as.cook.rpc('kds_orders', { p_restaurant: s.restaurantId }))
  assert.ok(board.some((o) => o._id === s.orderId))

  const preparing = check(await s.as.cook.rpc('set_item_status', { p_order: s.orderId, p_item: s.kitchenItem, p_status: 'preparing' }))
  assert.equal(preparing.status, 'preparing')
  assert.equal(preparing.preparedByName, 'cook')
  const ready = check(await s.as.cook.rpc('set_item_status', { p_order: s.orderId, p_item: s.kitchenItem, p_status: 'ready' }))
  assert.equal(ready.status, 'ready')

  const error = await rpcError(s.as.cook.rpc('set_order_status', { p_order: s.orderId, p_status: 'pending' }))
  assert.equal(error.code, 'PT400')
})

test('waiter: concurrent claims have exactly one winner', async () => {
  const results = await Promise.all([
    s.as.waiter1.rpc('claim_order', { p_order: s.orderId }),
    s.as.waiter2.rpc('claim_order', { p_order: s.orderId }),
  ])
  const failures = results.filter((r) => r.error)
  assert.equal(failures.length, 1)
  assert.equal(failures[0].error.code, 'PT409')
  assert.match(failures[0].error.message, /Already claimed by waiter[12]/)
})

test('cashier: lookup, cash payment settled exactly once', async () => {
  const lookup = check(await s.as.cashier.rpc('active_orders_by_table', { p_restaurant: s.restaurantId, p_table_number: 7 }))
  assert.equal(Number(lookup.totalDue), 45)

  const { payment } = check(await s.as.cashier.rpc('start_cash_payment', { p_order: s.orderId }))
  const [a, b] = await Promise.all([
    s.as.cashier.rpc('confirm_cash_payment', { p_payment: payment._id }),
    s.as.cashier.rpc('confirm_cash_payment', { p_payment: payment._id }),
  ])
  assert.ifError(a.error)
  assert.ifError(b.error)
  const stored = check(await admin.from('orders').select('payment_status').eq('id', s.orderId).single())
  assert.equal(stored.payment_status, 'paid')
  const payments = check(await admin.from('payments').select('id').eq('order_id', s.orderId))
  assert.equal(payments.length, 1)
})

test('table: served + paid frees the table and retires its QR session', async () => {
  check(await s.as.manager.rpc('set_order_status', { p_order: s.orderId, p_status: 'served' }))
  const table = check(await admin.from('tables').select('status, session_id').eq('id', s.tableId).single())
  assert.equal(table.status, 'available')
  assert.equal(table.session_id, null)
  assert.equal((await rpcError(order(s.anon, [{ menuItem: s.coke, quantity: 1 }]))).code, 'PT403')

  // The next guests scan again and get a fresh session.
  s.sessionId = check(await s.anon.rpc('open_table_session', { p_table: s.tableId })).session.id
})

test('feedback: one per order, and managers can only mark it reviewed', async () => {
  const sent = check(await s.anon.rpc('submit_feedback', { p_rating: 5, p_order: s.orderId, p_comment: 'Great' }))
  assert.equal((await rpcError(s.anon.rpc('submit_feedback', { p_rating: 1, p_order: s.orderId }))).code, 'PT409')

  const { error } = await s.as.manager.from('feedback').update({ rating: 1 }).eq('id', sent._id)
  assert.ok(error, 'rating must not be editable')
  check(await s.as.manager.from('feedback').update({ status: 'reviewed', reviewed_at: new Date().toISOString() }).eq('id', sent._id))
  const stored = check(await admin.from('feedback').select('rating, status').eq('id', sent._id).single())
  assert.deepEqual(stored, { rating: 5, status: 'reviewed' })
})

test('security: staff RPCs refuse other restaurants and anonymous callers', async () => {
  assert.equal((await rpcError(s.as.rival.rpc('kds_orders', { p_restaurant: s.restaurantId }))).code, 'PT403')
  assert.equal((await rpcError(s.as.rival.rpc('claim_order', { p_order: s.orderId }))).code, 'PT403')
  const anon = await rpcError(s.anon.rpc('report_dashboard', { p_restaurant: s.restaurantId }))
  assert.ok(['42501', 'PGRST202', 'PT401'].includes(anon.code), `got ${anon.code}`)
})

test('diner: anti-abuse caps limit open orders per table', async () => {
  const codes = []
  for (let i = 0; i < 6; i += 1) {
    const { error } = await order(s.anon, [{ menuItem: s.coke, quantity: 1 }])
    codes.push(error?.code ?? 'ok')
  }
  assert.equal(codes.filter((c) => c === 'ok').length, 5)
  assert.equal(codes.at(-1), 'PT400')
})

test('reports: dashboard, weekly and top items come from SQL', async () => {
  const m = s.as.manager
  const dashboard = check(await m.rpc('report_dashboard', { p_restaurant: s.restaurantId }))
  assert.equal(dashboard.totalOrdersToday, 6)
  assert.equal(Number(dashboard.totalRevenueToday), 45)
  assert.equal(check(await m.rpc('report_weekly', { p_restaurant: s.restaurantId })).length, 7)
  const top = check(await m.rpc('report_top_items', { p_restaurant: s.restaurantId }))
  assert.equal(top[0].itemName, 'Coca')
})

test('edge: ai-report returns analytics + a narrative (AI or template)', async () => {
  const { data, error } = await s.as.manager.functions.invoke('ai-report', { body: { restaurantId: s.restaurantId } })
  assert.ifError(error)
  assert.equal(data.analytics.totals.orders, 6)
  assert.equal(data.analytics.forecast.forecast.length, 7)
  assert.equal(typeof data.narrative.executiveSummary, 'string')
})

test('edge: staff-admin provisions and deactivates staff', async () => {
  const cookEmail = email('newcook')
  const { data, error } = await s.as.manager.functions.invoke('staff-admin', {
    body: { action: 'create', name: 'New Cook', email: cookEmail, password: PASSWORD, role: 'cook', restaurantId: s.restaurantId },
  })
  assert.ifError(error)
  users.push(data.user._id)
  assert.equal(data.user.role, 'cook')

  const escalation = await s.as.manager.functions.invoke('staff-admin', {
    body: { action: 'create', name: 'X', email: email('boss'), password: PASSWORD, role: 'superadmin' },
  })
  assert.ok(escalation.error, 'managers cannot create superadmins')

  await signedIn(cookEmail, PASSWORD)
  const off = await s.as.manager.functions.invoke('staff-admin', { body: { action: 'deactivate', userId: data.user._id } })
  assert.ifError(off.error)
  await assert.rejects(signedIn(cookEmail, PASSWORD))

  const foreign = await s.as.rival.functions.invoke('staff-admin', { body: { action: 'deactivate', userId: s.cook.id } })
  assert.ok(foreign.error, 'a manager cannot touch another restaurant’s staff')
})

test('edge: managers reset forgotten passwords, but never the owner’s', async () => {
  const reset = await s.as.manager.functions.invoke('staff-admin', {
    body: { action: 'update', userId: s.waiter2.id, password: 'new-pass-123' },
  })
  assert.ifError(reset.error)
  await signedIn(email('waiter2'), 'new-pass-123')
  await assert.rejects(signedIn(email('waiter2'), PASSWORD))

  const tooShort = await s.as.manager.functions.invoke('staff-admin', {
    body: { action: 'update', userId: s.waiter2.id, password: '123' },
  })
  assert.ok(tooShort.error)

  // A second manager of the same restaurant cannot take over the owner's account.
  const { data } = await s.as.manager.functions.invoke('staff-admin', {
    body: { action: 'create', name: 'Co-manager', email: email('comanager'), password: PASSWORD, role: 'manager', restaurantId: s.restaurantId },
  })
  users.push(data.user._id)
  const coManager = await signedIn(email('comanager'), PASSWORD)
  const takeover = await coManager.functions.invoke('staff-admin', {
    body: { action: 'update', userId: s.manager.id, password: 'hijacked-123' },
  })
  assert.equal(takeover.error?.context?.status, 403)
  await signedIn(email('manager'), PASSWORD)
})

test('storage: managers upload only into their restaurant folder', async () => {
  const png = new Blob([Uint8Array.from([137, 80, 78, 71])], { type: 'image/png' })
  const own = await s.as.manager.storage.from('menu-images').upload(`${s.restaurantId}/${RUN}.png`, png)
  assert.ifError(own.error)
  const foreign = await s.as.rival.storage.from('menu-images').upload(`${s.restaurantId}/${RUN}-x.png`, png)
  assert.ok(foreign.error)
  await admin.storage.from('menu-images').remove([`${s.restaurantId}/${RUN}.png`])
})
