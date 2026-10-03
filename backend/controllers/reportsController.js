const reports = require('../db/reports');
const orders = require('../db/orders');
const tables = require('../db/tables');
const { isUuid } = require('../db/mappers');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { ok } = require('../utils/apiResponse');
const { toId } = require('../utils/scope');
const forecastService = require('../services/forecastService');

const requireRestaurant = (req) => {
  const restaurantId = toId(req.user?.restaurant);
  if (!isUuid(restaurantId)) throw ApiError.forbidden('Restaurant context is required');
  return restaurantId;
};
const startOfDay = (date) => {
  const d = new Date(date);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
};
const endOfDay = (date) => {
  const d = new Date(date);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
};
const parseDateQuery = (dateStr) => {
  if (!dateStr) return new Date();
  const parts = String(dateStr).split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return new Date();
  return new Date(parts[0], parts[1] - 1, parts[2]);
};
const fillDateRangeUTC = (startUTC, numDays, grouped) => {
  const map = new Map(grouped.map((g) => [g.date, g]));
  const out = [];
  for (let i = 0; i < numDays; i += 1) {
    const d = new Date(startUTC.getTime());
    d.setUTCDate(d.getUTCDate() + i);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    const row = map.get(key);
    out.push({
      date: key,
      totalOrders: row ? row.orders : 0,
      totalRevenue: row ? row.revenue : 0,
    });
  }
  return out;
};
const lastNDaysUTC = (days) => {
  const now = new Date();
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (days - 1), 0, 0, 0, 0)
  );
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999)
  );
  return { start, end };
};

// Revenue = money actually collected: only PAID orders count. This keeps the
// dashboard consistent with the Payments page and stops unpaid/pending tabs (or
// cancelled orders) from inflating the figure.
exports.getDashboardStats = asyncHandler(async (req, res) => {
  const restaurantId = requireRestaurant(req);
  const now = new Date();
  const [today, occupiedTables] = await Promise.all([
    reports.todayStats(restaurantId, startOfDay(now), endOfDay(now)),
    tables.countOccupied(restaurantId),
  ]);
  return ok(res, {
    totalOrdersToday: today.totalOrders ?? 0,
    totalRevenueToday: today.totalRevenue ?? 0,
    pendingOrders: today.pendingOrders ?? 0,
    occupiedTables,
  });
});

exports.getDailyReport = asyncHandler(async (req, res) => {
  const restaurantId = requireRestaurant(req);
  const day = parseDateQuery(req.query.date);
  const dayStart = startOfDay(day);
  const dayEnd = endOfDay(day);
  const [metrics, ordersList] = await Promise.all([
    reports.periodTotals(restaurantId, dayStart, dayEnd),
    orders.listForDay(restaurantId, dayStart, dayEnd),
  ]);
  const totalOrders = metrics?.orders ?? 0;
  const totalRevenue = metrics?.revenue ?? 0;
  return ok(res, {
    date: req.query.date
      ? String(req.query.date)
      : `${dayStart.getFullYear()}-${String(dayStart.getMonth() + 1).padStart(2, '0')}-${String(dayStart.getDate()).padStart(2, '0')}`,
    totalOrders,
    totalRevenue,
    averageOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : 0,
    orders: ordersList,
  });
});

const rollingReport = (days) =>
  asyncHandler(async (req, res) => {
    const restaurantId = requireRestaurant(req);
    const { start, end } = lastNDaysUTC(days);
    const grouped = await reports.dailySeries(restaurantId, start, end);
    return ok(res, { report: fillDateRangeUTC(start, days, grouped) });
  });

exports.getWeeklyReport = rollingReport(7);
exports.getMonthlyReport = rollingReport(30);

exports.getTopItems = asyncHandler(async (req, res) => {
  const restaurantId = requireRestaurant(req);
  const rows = await reports.topItems(restaurantId, { limit: 5 });
  const topItems = rows.map((r) => ({
    itemName: r.name,
    totalQuantity: r.quantity,
    totalRevenue: r.revenue,
  }));
  return ok(res, { topItems });
});

exports.getPeakHours = asyncHandler(async (req, res) => {
  const restaurantId = requireRestaurant(req);
  const byHour = await reports.byHour(restaurantId);
  const map = new Map(byHour.map((h) => [h.hour, h.orders]));
  const hours = [];
  for (let hour = 0; hour < 24; hour += 1) {
    hours.push({ hour, totalOrders: map.get(hour) ?? 0 });
  }
  return ok(res, { hours });
});

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

exports.getPeakDays = asyncHandler(async (req, res) => {
  const restaurantId = requireRestaurant(req);
  // day: 1 (Sunday) .. 7 (Saturday).
  const byDay = await reports.byDayOfWeek(restaurantId);
  const map = new Map(byDay.map((d) => [d.day, d]));
  const days = [];
  for (let i = 1; i <= 7; i += 1) {
    const row = map.get(i);
    days.push({
      day: i,
      label: DAY_LABELS[i - 1],
      totalOrders: row ? row.orders : 0,
      totalRevenue: row ? row.revenue : 0,
    });
  }
  return ok(res, { days });
});

// @desc   Forecast next N days of orders & revenue (via the ML microservice)
// @route  GET /api/reports/forecast?horizon=7
// @access Manager / Superadmin
exports.getForecast = asyncHandler(async (req, res) => {
  const restaurantId = requireRestaurant(req);
  const result = await forecastService.getForecast(restaurantId, req.query.horizon);
  return ok(res, result);
});
