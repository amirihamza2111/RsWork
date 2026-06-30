const mongoose = require('mongoose');
const Order = require('../models/Order');
const config = require('../config');

const DEFAULT_HISTORY_DAYS = 90;
const MAX_HORIZON = 31;

const oid = (value) =>
  value instanceof mongoose.Types.ObjectId ? value : new mongoose.Types.ObjectId(String(value));

const ymd = (d) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate()
  ).padStart(2, '0')}`;

// Fill a contiguous daily range, defaulting missing days to zero.
function fillDaily(grouped, startUTC, numDays) {
  const map = new Map(grouped.map((g) => [g.date, g]));
  const out = [];
  for (let i = 0; i < numDays; i += 1) {
    const d = new Date(startUTC.getTime());
    d.setUTCDate(d.getUTCDate() + i);
    const key = ymd(d);
    const row = map.get(key);
    out.push({ date: key, orders: row ? row.orders : 0, revenue: row ? row.revenue : 0 });
  }
  return out;
}

async function buildDailyHistory(restaurantId, days = DEFAULT_HISTORY_DAYS) {
  const now = new Date();
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999)
  );
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1), 0, 0, 0, 0)
  );

  const grouped = await Order.aggregate([
    { $match: { restaurant: oid(restaurantId), createdAt: { $gte: start, $lte: end } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        orders: { $sum: 1 },
        revenue: {
          $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 0, { $ifNull: ['$totalAmount', 0] }] },
        },
      },
    },
    { $project: { _id: 0, date: '$_id', orders: 1, revenue: 1 } },
  ]);

  return fillDaily(grouped, start, days);
}

// Built-in fallback: average each metric by weekday and project it forward,
// with a ~90% interval from the weekday standard deviation.
function nodeFallbackForecast(history, horizon) {
  const Z = 1.645;
  const byDow = {};
  for (const point of history) {
    const dow = new Date(`${point.date}T00:00:00Z`).getUTCDay();
    byDow[dow] = byDow[dow] || { orders: [], revenue: [] };
    byDow[dow].orders.push(point.orders);
    byDow[dow].revenue.push(point.revenue);
  }
  const avg = (arr) => (arr.length ? arr.reduce((s, x) => s + x, 0) / arr.length : 0);
  const std = (arr) => {
    if (arr.length < 2) return 0;
    const m = avg(arr);
    return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / arr.length);
  };

  const last = history.length
    ? new Date(`${history[history.length - 1].date}T00:00:00Z`)
    : new Date();

  const out = [];
  for (let i = 1; i <= horizon; i += 1) {
    const d = new Date(last.getTime());
    d.setUTCDate(d.getUTCDate() + i);
    const bucket = byDow[d.getUTCDay()] || { orders: [], revenue: [] };
    const oMean = avg(bucket.orders);
    const rMean = avg(bucket.revenue);
    const oStd = std(bucket.orders);
    const rStd = std(bucket.revenue);
    out.push({
      date: ymd(d),
      orders: Math.max(0, Math.round(oMean)),
      ordersLower: Math.max(0, Math.round(oMean - Z * oStd)),
      ordersUpper: Math.max(0, Math.round(oMean + Z * oStd)),
      revenue: Math.max(0, Number(rMean.toFixed(2))),
      revenueLower: Math.max(0, Number((rMean - Z * rStd).toFixed(2))),
      revenueUpper: Math.max(0, Number((rMean + Z * rStd).toFixed(2))),
    });
  }
  return out;
}

async function callPythonForecast(series, horizon) {
  const url = `${config.ml.url.replace(/\/+$/, '')}/forecast`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.ml.timeoutMs);
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ series, horizon }),
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`ML service responded ${resp.status}`);
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

async function getForecast(restaurantId, horizon = 7) {
  const h = Math.min(Math.max(Number(horizon) || 7, 1), MAX_HORIZON);
  const history = await buildDailyHistory(restaurantId);

  try {
    const result = await callPythonForecast(history, h);
    return {
      source: 'ml',
      model: result.model,
      evaluation: result.evaluation || null,
      horizon: h,
      historyPoints: history.length,
      history,
      forecast: result.forecast,
    };
  } catch (err) {
    return {
      source: 'fallback',
      model: { orders: 'seasonal-naive', revenue: 'seasonal-naive' },
      evaluation: null,
      reason: err.message,
      horizon: h,
      historyPoints: history.length,
      history,
      forecast: nodeFallbackForecast(history, h),
    };
  }
}

module.exports = { buildDailyHistory, fillDaily, nodeFallbackForecast, getForecast };
