const test = require('node:test');
const assert = require('node:assert');
const { fillDaily, nodeFallbackForecast } = require('../../services/forecastService');

// Build N days of history with a weekday pattern (weekends busier).
function buildHistory(days) {
  const start = new Date(Date.UTC(2026, 2, 1));
  const out = [];
  for (let i = 0; i < days; i += 1) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    const dow = d.getUTCDay();
    const base = dow === 5 || dow === 6 ? 28 : 11;
    out.push({ date: d.toISOString().slice(0, 10), orders: base, revenue: base * 22 });
  }
  return out;
}

test('fillDaily: fills missing days with zeros over the range', () => {
  const start = new Date(Date.UTC(2026, 0, 1));
  const filled = fillDaily([{ date: '2026-01-02', orders: 5, revenue: 100 }], start, 3);
  assert.equal(filled.length, 3);
  assert.deepEqual(filled[0], { date: '2026-01-01', orders: 0, revenue: 0 });
  assert.deepEqual(filled[1], { date: '2026-01-02', orders: 5, revenue: 100 });
  assert.deepEqual(filled[2], { date: '2026-01-03', orders: 0, revenue: 0 });
});

test('nodeFallbackForecast: returns the requested horizon with intervals', () => {
  const out = nodeFallbackForecast(buildHistory(56), 7);
  assert.equal(out.length, 7);
  for (const p of out) {
    assert.ok(['date', 'orders', 'ordersLower', 'ordersUpper', 'revenue', 'revenueLower', 'revenueUpper'].every((k) => k in p));
    assert.ok(p.ordersLower <= p.orders && p.orders <= p.ordersUpper);
    assert.ok(p.orders >= 0 && p.revenue >= 0);
  }
});

test('nodeFallbackForecast: preserves weekly seasonality (weekend > weekday)', () => {
  const out = nodeFallbackForecast(buildHistory(56), 7);
  const weekend = out.filter((p) => [5, 6].includes(new Date(`${p.date}T00:00:00Z`).getUTCDay()));
  const weekday = out.filter((p) => ![5, 6].includes(new Date(`${p.date}T00:00:00Z`).getUTCDay()));
  const avg = (a) => a.reduce((s, p) => s + p.orders, 0) / a.length;
  assert.ok(avg(weekend) > avg(weekday));
});
