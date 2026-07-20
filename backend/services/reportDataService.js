const mongoose = require('mongoose');
const Order = require('../models/Order');
const Restaurant = require('../models/Restaurant');
const forecastService = require('./forecastService');

const oid = (value) =>
  value instanceof mongoose.Types.ObjectId ? value : new mongoose.Types.ObjectId(String(value));

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Revenue = money actually collected: only PAID orders count, matching the
// Payments page. Unpaid/pending tabs and cancelled orders don't inflate it.
const revenueExpr = {
  $sum: { $cond: [{ $eq: ['$paymentStatus', 'paid'] }, { $ifNull: ['$totalAmount', 0] }, 0] },
};

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

async function periodTotals(restaurantId, start, end) {
  const [row] = await Order.aggregate([
    { $match: { restaurant: oid(restaurantId), createdAt: { $gte: start, $lte: end } } },
    {
      $group: {
        _id: null,
        orders: { $sum: 1 },
        revenue: revenueExpr,
        cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
      },
    },
  ]);
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

  const [restaurant, totals, prevTotals, trend, topItems, byHour, byDay, forecast] =
    await Promise.all([
      Restaurant.findById(restaurantId).select('name address phone settings').lean(),
      periodTotals(restaurantId, start, end),
      periodTotals(restaurantId, prevStart, prevEnd),
      Order.aggregate([
        { $match: { restaurant: oid(restaurantId), createdAt: { $gte: start, $lte: end } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            orders: { $sum: 1 },
            revenue: revenueExpr,
          },
        },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, date: '$_id', orders: 1, revenue: 1 } },
      ]),
      Order.aggregate([
        {
          $match: {
            restaurant: oid(restaurantId),
            createdAt: { $gte: start, $lte: end },
            status: { $ne: 'cancelled' },
          },
        },
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.menuItem',
            quantity: { $sum: '$items.quantity' },
            revenue: { $sum: { $multiply: ['$items.quantity', '$items.price'] } },
          },
        },
        { $sort: { quantity: -1 } },
        { $limit: 5 },
        {
          $lookup: {
            from: require('../models/MenuItem').collection.name,
            localField: '_id',
            foreignField: '_id',
            as: 'menuItem',
          },
        },
        { $unwind: { path: '$menuItem', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 0,
            name: { $ifNull: ['$menuItem.name.fr', 'Unknown item'] },
            quantity: 1,
            revenue: 1,
          },
        },
      ]),
      Order.aggregate([
        { $match: { restaurant: oid(restaurantId), createdAt: { $gte: start, $lte: end } } },
        { $group: { _id: { $hour: '$createdAt' }, orders: { $sum: 1 } } },
        { $sort: { orders: -1 } },
      ]),
      Order.aggregate([
        { $match: { restaurant: oid(restaurantId), createdAt: { $gte: start, $lte: end } } },
        {
          $group: {
            _id: { $dayOfWeek: '$createdAt' },
            orders: { $sum: 1 },
            revenue: revenueExpr,
          },
        },
      ]),
      forecastService.getForecast(restaurantId, 7).catch(() => null),
    ]);

  const peakDays = Array.from({ length: 7 }, (_, i) => {
    const row = byDay.find((d) => d._id === i + 1);
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
    trend,
    topItems,
    peakHours: byHour.slice(0, 3).map((h) => ({ hour: h._id, orders: h.orders })),
    busiestDay,
    peakDays,
    forecast,
  };
}

module.exports = { gather, resolveRange };
