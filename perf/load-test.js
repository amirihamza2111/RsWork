/**
 * k6 load test — RsWork (Vercel frontend + Supabase API).
 *
 *   node --env-file=.env perf/fixture.mjs create
 *   k6 run -e SITE=https://rs-work-ge7g.vercel.app perf/load-test.js
 *   node --env-file=.env perf/fixture.mjs destroy
 *
 * Runs against a throwaway restaurant (perf/.fixture.json), never the demo.
 * Three scenarios at once:
 *   diners   — ramp 15 → 50 → 100 virtual diners: load the menu page, open the
 *              table session, read the menu; 1–3 s of reading between visits
 *   ordering — a steady 2 orders/s spread over 60 tables (under the anti-abuse
 *              cap of 5 open orders per table), each followed by tracking
 *   kitchen  — 10 KDS screens polling the order board as the cook (RLS + RPC)
 * Thresholds fail the run on >1% errors or a p95 latency over 800 ms.
 * Every failed request is logged with its endpoint and status.
 */
import http from 'k6/http'
import exec from 'k6/execution'
import { check, sleep } from 'k6'

const fx = JSON.parse(open('./.fixture.json'))
const SITE = __ENV.SITE || 'http://localhost:4173'
const API = fx.supabaseUrl

export const options = {
  scenarios: {
    diners: {
      executor: 'ramping-vus',
      exec: 'diner',
      stages: [
        { duration: '20s', target: 15 }, // normal service
        { duration: '30s', target: 50 }, // busy evening
        { duration: '30s', target: 100 }, // stress: 100 diners at once
        { duration: '20s', target: 0 },
      ],
    },
    ordering: {
      executor: 'constant-arrival-rate',
      exec: 'order',
      rate: 2,
      timeUnit: '1s',
      duration: '90s',
      preAllocatedVUs: 10,
      maxVUs: 30,
    },
    kitchen: {
      executor: 'constant-vus',
      exec: 'kitchen',
      vus: 10,
      duration: '100s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<800'],
    'http_req_duration{scenario:diners}': ['p(95)<800'],
    'http_req_duration{scenario:ordering}': ['p(95)<800'],
    'http_req_duration{scenario:kitchen}': ['p(95)<800'],
  },
}

const anon = { apikey: fx.publishableKey, 'Content-Type': 'application/json' }
const pick = (list) => list[Math.floor(Math.random() * list.length)]

function expectOk(res, name, status = 200) {
  const ok = check(res, { [`${name} ${status}`]: (r) => r.status === status })
  if (!ok) console.error(`FAIL  ${res.status}  ${name}  (${res.timings.duration.toFixed(0)}ms)  ${String(res.body).slice(0, 160)}`)
  return ok
}

const rpc = (name, body, headers = anon) =>
  http.post(`${API}/rest/v1/rpc/${name}`, JSON.stringify(body), { headers, tags: { name: `rpc ${name}` } })

export function setup() {
  const res = http.post(
    `${API}/auth/v1/token?grant_type=password`,
    JSON.stringify({ email: fx.cook.email, password: fx.cook.password }),
    { headers: anon }
  )
  if (res.status !== 200) throw new Error(`cook sign-in failed: ${res.status} ${res.body}`)
  return { cookToken: res.json('access_token') }
}

// A diner scans a table QR: the page, the session, then the menu.
export function diner() {
  const table = pick(fx.tableIds)
  expectOk(http.get(`${SITE}/menu?tableId=${table}`, { tags: { name: 'page /menu' } }), 'page /menu')
  expectOk(rpc('open_table_session', { p_table: table }), 'open_table_session')
  expectOk(
    http.get(`${API}/rest/v1/categories?select=id,name,sort_order&restaurant_id=eq.${fx.restaurantId}&order=sort_order`, {
      headers: anon,
      tags: { name: 'GET categories' },
    }),
    'GET categories'
  )
  expectOk(
    http.get(
      `${API}/rest/v1/menu_items?select=id,name,description,price,image,is_available,category_id,prep_station&restaurant_id=eq.${fx.restaurantId}`,
      { headers: anon, tags: { name: 'GET menu_items' } }
    ),
    'GET menu_items'
  )
  sleep(Math.random() * 2 + 1) // a diner reads the menu for 1–3 s
}

// Round-robin over the tables keeps every table under the 5-open-orders cap.
export function order() {
  const table = fx.tableIds[exec.scenario.iterationInTest % fx.tableIds.length]
  const session = rpc('open_table_session', { p_table: table })
  if (!expectOk(session, 'open_table_session')) return
  const placed = rpc('place_order', {
    p_table: table,
    p_session: session.json('session.id'),
    p_items: [
      { menuItem: pick(fx.itemIds), quantity: 1 },
      { menuItem: pick(fx.itemIds), quantity: 2 },
    ],
  })
  if (!expectOk(placed, 'place_order')) return
  expectOk(rpc('get_order', { p_order: placed.json('_id') }), 'get_order')
}

// A kitchen screen refreshing its board.
export function kitchen(data) {
  const headers = { ...anon, Authorization: `Bearer ${data.cookToken}` }
  expectOk(rpc('kds_orders', { p_restaurant: fx.restaurantId }, headers), 'kds_orders')
  sleep(5)
}
