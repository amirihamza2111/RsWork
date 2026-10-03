const reports = require('../db/reports');
const restaurants = require('../db/restaurants');
const forecastService = require('./forecastService');

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function resolveRange(startDate, endDate) {
  const now = new Date();
  let end = endDate ? new Date(endDate) : now;
  if (Number.isNaN(end.getTime())) end = now;
  end = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999);

  let start;
  if (startDate) {
    start = new Date(startDate);
    if (Number.isNaN(start.getTime())) start = null;
  }
  if (!start) {
    start = new Date(end);
    start.setDate(start.getDate() - 29); // default: 30-day window
  }
  start = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0, 0);

  const days = Math.max(1, Math.round((end - start) / 86400000) + 1);
  return { start, end, days };
}

// Revenue = money actually collected: only PAID orders count, matching the
// Payments page. Unpaid/pending tabs and cancelled orders don't inflate it.
async function periodTotals(restaurantId, start, end) {
  const row = await reports.periodTotals(restaurantId, start, end);
  const orders = row?.orders || 0;
  const revenue = row?.revenue || 0;
  return {
    orders,
    revenue,
    cancelled: row?.cancelled || 0,
    avgOrderValue: orders > 0 ? revenue / orders : 0,
  };
}

const growthPct = (current, previous) => {
  if (!previous) return current > 0 ? 100 : 0;
  return Number((((current - previous) / previous) * 100).toFixed(1));
};

async function gather(restaurantId, { startDate, endDate } = {}) {
  const { start, end, days } = resolveRange(startDate, endDate);

  // Previous comparable window, immediately before the current one.
  const prevEnd = new Date(start.getTime() - 1);
  const prevStart = new Date(start);
  prevStart.setDate(prevStart.getDate() - days);

  const rid = String(restaurantId);
  const [restaurant, totals, prevTotals, trend, topItems, byHour, byDay, forecast] =
    await Promise.all([
      restaurants.findById(rid),
      periodTotals(rid, start, end),
      periodTotals(rid, prevStart, prevEnd),
      reports.dailySeries(rid, start, end),
      reports
        .topItems(rid, { start, end, limit: 5 })
        .then((rows) => rows.map(({ name, quantity, revenue }) => ({ name, quantity, revenue }))),
      reports.byHour(rid, { start, end }),
      reports.byDayOfWeek(rid, { start, end }),
      forecastService.getForecast(rid, 7).catch(() => null),
    ]);

  const peakDays = Array.from({ length: 7 }, (_, i) => {
    const row = byDay.find((d) => d.day === i + 1);
    return {
      label: DAY_LABELS[i],
      orders: row?.orders || 0,
      revenue: row?.revenue || 0,
    };
  });
  const busiestDay = [...peakDays].sort((a, b) => b.orders - a.orders)[0];

  return {
    restaurant: {
      id: String(restaurantId),
      name: restaurant?.name || 'Restaurant',
      address: restaurant?.address || '',
      phone: restaurant?.phone || '',
      currency: restaurant?.settings?.currency || 'TND',
    },
    period: {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
      days,
    },
    totals,
    comparison: {
      prevOrders: prevTotals.orders,
      prevRevenue: prevTotals.revenue,
      ordersGrowthPct: growthPct(totals.orders, prevTotals.orders),
      revenueGrowthPct: growthPct(totals.revenue, prevTotals.revenue),
    },
    trend: trend.map(({ date, orders, revenue }) => ({ date, orders, revenue })),
    topItems,
    peakHours: byHour.slice(0, 3).map((h) => ({ hour: h.hour, orders: h.orders })),
    busiestDay,
    peakDays,
    forecast,
  };
}

module.exports = { gather, resolveRange };
