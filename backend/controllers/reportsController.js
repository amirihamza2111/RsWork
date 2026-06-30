const mongoose = require('mongoose');
const Order = require('../models/Order');
const Table = require('../models/Table');
const MenuItem = require('../models/MenuItem');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { ok } = require('../utils/apiResponse');
const forecastService = require('../services/forecastService');

const getRestaurantObjectId = (req) => {
  const r = req.user?.restaurant;
  if (!r) return null;
  return r instanceof mongoose.Types.ObjectId ? r : new mongoose.Types.ObjectId(r);
};

const requireRestaurant = (req) => {
  const restaurantId = getRestaurantObjectId(req);
  if (!restaurantId) throw ApiError.forbidden('Restaurant context is required');
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
const revenueSumExpr = {
  $cond: [
    { $eq: ['$status', 'cancelled'] },
    0,
    { $ifNull: ['$totalAmount', 0] },
  ],
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
      totalOrders: row ? row.totalOrders : 0,
      totalRevenue: row ? row.totalRevenue : 0,
    });
  }
  return out;
};
exports.getDashboardStats = asyncHandler(async (req, res) => {
    const restaurantId = requireRestaurant(req);
    const now = new Date();
    const dayStart = startOfDay(now);
    const dayEnd = endOfDay(now);
    const [facetResult] = await Order.aggregate([
      { $match: { restaurant: restaurantId } },
      {
        $facet: {
          todayOrders: [
            {
              $match: {
                createdAt: { $gte: dayStart, $lte: dayEnd },
              },
            },
            {
              $group: {
                _id: null,
                totalOrders: { $sum: 1 },
                totalRevenue: { $sum: revenueSumExpr },
              },
            },
          ],
          pendingOrders: [
            { $match: { status: 'pending' } },
            { $count: 'count' },
          ],
        },
      },
    ]);
    const today = facetResult.todayOrders[0] ?? {
      totalOrders: 0,
      totalRevenue: 0,
    };
    const pendingCount = facetResult.pendingOrders[0]?.count ?? 0;
    const occupiedTables = await Table.countDocuments({
      restaurant: restaurantId,
      status: 'occupied',
    });
    return ok(res, {
      totalOrdersToday: today.totalOrders ?? 0,
      totalRevenueToday: today.totalRevenue ?? 0,
      pendingOrders: pendingCount,
      occupiedTables,
    });
});
exports.getDailyReport = asyncHandler(async (req, res) => {
    const restaurantId = requireRestaurant(req);
    const day = parseDateQuery(req.query.date);
    const dayStart = startOfDay(day);
    const dayEnd = endOfDay(day);
    const [metrics] = await Order.aggregate([
      {
        $match: {
          restaurant: restaurantId,
          createdAt: { $gte: dayStart, $lte: dayEnd },
        },
      },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: revenueSumExpr },
        },
      },
    ]);
    const totalOrders = metrics?.totalOrders ?? 0;
    const totalRevenue = metrics?.totalRevenue ?? 0;
    const averageOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
    const ordersList = await Order.aggregate([
      {
        $match: {
          restaurant: restaurantId,
          createdAt: { $gte: dayStart, $lte: dayEnd },
        },
      },
      {
        $lookup: {
          from: Table.collection.name,
          localField: 'table',
          foreignField: '_id',
          as: 'tableDoc',
        },
      },
      { $unwind: { path: '$tableDoc', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          orderNumber: 1,
          table: '$tableDoc.number',
          totalAmount: 1,
          status: 1,
          createdAt: 1,
        },
      },
      { $sort: { orderNumber: 1 } },
    ]);
    return ok(res, {
      date: req.query.date
        ? String(req.query.date)
        : `${dayStart.getFullYear()}-${String(dayStart.getMonth() + 1).padStart(2, '0')}-${String(dayStart.getDate()).padStart(2, '0')}`,
      totalOrders,
      totalRevenue,
      averageOrderValue,
      orders: ordersList,
    });
});
exports.getWeeklyReport = asyncHandler(async (req, res) => {
    const restaurantId = requireRestaurant(req);
    const now = new Date();
    const rangeStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 6, 0, 0, 0, 0)
    );
    const end = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999)
    );
    const grouped = await Order.aggregate([
      {
        $match: {
          restaurant: restaurantId,
          createdAt: { $gte: rangeStart, $lte: end },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
          },
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: revenueSumExpr },
        },
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          date: '$_id',
          totalOrders: 1,
          totalRevenue: 1,
        },
      },
    ]);
    const report = fillDateRangeUTC(rangeStart, 7, grouped);
    return ok(res, { report });
});
exports.getMonthlyReport = asyncHandler(async (req, res) => {
    const restaurantId = requireRestaurant(req);
    const now = new Date();
    const rangeStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 29, 0, 0, 0, 0)
    );
    const end = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999)
    );
    const grouped = await Order.aggregate([
      {
        $match: {
          restaurant: restaurantId,
          createdAt: { $gte: rangeStart, $lte: end },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
          },
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: revenueSumExpr },
        },
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          date: '$_id',
          totalOrders: 1,
          totalRevenue: 1,
        },
      },
    ]);
    const report = fillDateRangeUTC(rangeStart, 30, grouped);
    return ok(res, { report });
});
exports.getTopItems = asyncHandler(async (req, res) => {
    const restaurantId = requireRestaurant(req);
    const topItems = await Order.aggregate([
      { $match: { restaurant: restaurantId } },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.menuItem',
          totalQuantity: { $sum: '$items.quantity' },
          totalRevenue: {
            $sum: {
              $multiply: ['$items.quantity', '$items.price'],
            },
          },
        },
      },
      { $sort: { totalQuantity: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: MenuItem.collection.name,
          localField: '_id',
          foreignField: '_id',
          as: 'menuItem',
        },
      },
      { $unwind: { path: '$menuItem', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          itemName: {
            $ifNull: ['$menuItem.name.fr', 'Unknown item'],
          },
          totalQuantity: 1,
          totalRevenue: 1,
        },
      },
    ]);
    return ok(res, { topItems });
});
exports.getPeakHours = asyncHandler(async (req, res) => {
    const restaurantId = requireRestaurant(req);
    const byHour = await Order.aggregate([
      { $match: { restaurant: restaurantId } },
      {
        $group: {
          _id: { $hour: '$createdAt' },
          totalOrders: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);
    const map = new Map(byHour.map((h) => [h._id, h.totalOrders]));
    const hours = [];
    for (let hour = 0; hour < 24; hour += 1) {
      hours.push({
        hour,
        totalOrders: map.get(hour) ?? 0,
      });
    }
    return ok(res, { hours });
});

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

exports.getPeakDays = asyncHandler(async (req, res) => {
  const restaurantId = requireRestaurant(req);

  // $dayOfWeek returns 1 (Sunday) .. 7 (Saturday).
  const byDay = await Order.aggregate([
    { $match: { restaurant: restaurantId } },
    {
      $group: {
        _id: { $dayOfWeek: '$createdAt' },
        totalOrders: { $sum: 1 },
        totalRevenue: { $sum: revenueSumExpr },
      },
    },
  ]);

  const map = new Map(byDay.map((d) => [d._id, d]));
  const days = [];
  for (let i = 1; i <= 7; i += 1) {
    const row = map.get(i);
    days.push({
      day: i,
      label: DAY_LABELS[i - 1],
      totalOrders: row ? row.totalOrders : 0,
      totalRevenue: row ? row.totalRevenue : 0,
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
