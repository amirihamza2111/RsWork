const crypto = require('crypto');
const Table = require('../models/Table');
const Order = require('../models/Order');
const QRCode = require('qrcode');
const config = require('../config');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { ok } = require('../utils/apiResponse');
const { toId, isSameRestaurant } = require('../utils/scope');
const { autoAssignSections } = require('../services/sectionService');
const { isSessionActive } = require('../utils/tableSession');

const DEFAULT_FRONTEND_URL = 'https://layalicarthage.netlify.app';
const ACTIVE_ORDER_STATUSES = ['pending', 'confirmed', 'preparing', 'ready'];

const getClientBaseUrl = () => {
  const configured = String(
    config.clientUrl || process.env.FRONTEND_PUBLIC_URL || DEFAULT_FRONTEND_URL
  ).trim();
  return configured.replace(/\/+$/, '');
};

// The frontend uses BrowserRouter (history routing), so the QR must point to a
// real path — not a '/#/' hash route, which BrowserRouter would never match.
const buildTableMenuUrl = (tableId) => `${getClientBaseUrl()}/menu?tableId=${tableId}`;
const generateTableQRCode = (tableId) => QRCode.toDataURL(buildTableMenuUrl(tableId));

exports.createTable = asyncHandler(async (req, res) => {
  const { number, capacity } = req.body;
  const restaurant = req.user.restaurant;
  const tableNumber = Number(number);

  if (!number || !Number.isFinite(tableNumber) || tableNumber <= 0) {
    throw ApiError.badRequest('Please provide a valid table number');
  }
  if (!restaurant) throw ApiError.forbidden('Restaurant context is required');

  const existing = await Table.findOne({ restaurant, number: tableNumber });
  if (existing) throw ApiError.badRequest('Table number already exists');

  const table = await Table.create({
    number: tableNumber,
    capacity: Number(capacity) || 4,
    restaurant,
  });

  table.qrCode = await generateTableQRCode(table._id);
  await table.save();
  return ok(res, { table }, 'Table created', 201);
});

exports.getTables = asyncHandler(async (req, res) => {
  const role = req.user.role;
  const restaurantId = req.user.restaurant;

  if (!restaurantId && role !== 'superadmin') {
    throw ApiError.forbidden('Restaurant context is required');
  }

  let tableFilter = role === 'superadmin' ? {} : { restaurant: restaurantId };

  if (role === 'waiter') {
    // A waiter sees their section (auto-assigned tables) plus any table where
    // they already carry an order (claimed/legacy orders outside the section).
    const tableIds = await Order.find({ restaurant: restaurantId, waiter: req.user._id }).distinct(
      'table'
    );
    tableFilter = {
      ...tableFilter,
      $or: [{ assignedWaiter: req.user._id }, { _id: { $in: tableIds } }],
    };
  }

  if (role === 'client') {
    const tableIds = await Order.find({ client: req.user._id }).distinct('table');
    tableFilter = { _id: { $in: tableIds } };
  }

  const tables = await Table.find(tableFilter)
    .populate('restaurant')
    .populate('assignedWaiter', 'name');
  return ok(res, { count: tables.length, tables });
});

exports.updateTable = asyncHandler(async (req, res) => {
  const { number, capacity, status, assignedWaiter } = req.body;
  const table = await Table.findById(req.params.id);
  if (!table) throw ApiError.notFound('Table not found');
  if (!isSameRestaurant(req.user, table.restaurant)) throw ApiError.forbidden();

  if (number) table.number = number;
  if (capacity) table.capacity = capacity;
  if (status) table.status = status;
  // Section assignment — '' / null clears it, an id sets the responsible waiter.
  if (assignedWaiter !== undefined) {
    table.assignedWaiter = assignedWaiter || undefined;
  }
  await table.save();
  return ok(res, { table }, 'Table updated');
});

exports.deleteTable = asyncHandler(async (req, res) => {
  const table = await Table.findById(req.params.id);
  if (!table) throw ApiError.notFound('Table not found');
  if (!isSameRestaurant(req.user, table.restaurant)) throw ApiError.forbidden();

  await table.deleteOne();
  return ok(res, null, 'Table deleted successfully');
});

// @desc   Force a full section reshuffle across the connected waiters
// @route  POST /api/tables/auto-assign
// @access manager / superadmin
exports.autoAssignTables = asyncHandler(async (req, res) => {
  const restaurantId =
    req.user.role === 'superadmin' ? req.body?.restaurantId : toId(req.user.restaurant);
  if (!restaurantId) throw ApiError.forbidden('Restaurant context is required');

  const result = await autoAssignSections(restaurantId, { force: true });
  if (result.skipped) {
    throw ApiError.badRequest(
      result.reason === 'no connected waiters'
        ? 'No waiter is currently online — sections are assigned when waiters connect.'
        : 'Nothing to assign yet.'
    );
  }
  return ok(res, result, `Sections reassigned across ${result.waiters} waiter(s)`);
});

exports.regenerateAllQRCodes = asyncHandler(async (req, res) => {
  const role = req.user.role;
  const restaurantId = req.user.restaurant;

  if (!restaurantId && role !== 'superadmin') {
    throw ApiError.forbidden('Restaurant context is required');
  }

  const filter = role === 'superadmin' ? {} : { restaurant: restaurantId };
  const tables = await Table.find(filter);

  await Promise.all(
    tables.map(async (table) => {
      table.qrCode = await generateTableQRCode(table._id);
      await table.save();
    })
  );

  return ok(res, { count: tables.length }, 'QR codes regenerated successfully');
});

exports.getTableByQR = asyncHandler(async (req, res) => {
  const tableId = req.params.id || req.params.tableId;
  const table = await Table.findById(tableId).populate('restaurant');
  if (!table) throw ApiError.notFound('Table not found');
  return ok(res, { table });
});

// Diner dining sessions live for 2h — long enough for a meal, short enough that
// a leaked QR can't be replayed indefinitely.
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

// @desc   Open (or resume) a dining session for a table — called when a diner
//         scans the QR. Returns the table (with restaurant) + the session id the
//         diner must send when placing an order.
// @route  POST /api/tables/:id/session
// @access Public
exports.openTableSession = asyncHandler(async (req, res) => {
  const table = await Table.findById(req.params.id).populate('restaurant');
  if (!table) throw ApiError.notFound('Table not found');

  const now = Date.now();
  if (!isSessionActive(table.session, now)) {
    table.session = {
      id: crypto.randomUUID(),
      expiresAt: new Date(now + SESSION_TTL_MS),
    };
    if (table.status === 'available') table.status = 'occupied';
    await table.save();
  }

  return ok(res, {
    table,
    session: { id: table.session.id, expiresAt: table.session.expiresAt },
  });
});

exports.releaseTableSession = asyncHandler(async (req, res) => {
  const tableId = req.params.id;
  const orderId = String(req.body?.orderId || '').trim();

  const table = await Table.findById(tableId);
  if (!table) throw ApiError.notFound('Table not found');

  if (orderId) {
    const order = await Order.findById(orderId).select('table status');
    if (!order || toId(order.table) !== toId(table._id)) {
      throw ApiError.badRequest('Order does not match the table');
    }
    const status = String(order.status || '').toLowerCase();
    if (status !== 'served' && status !== 'cancelled') {
      throw ApiError.conflict('Order is not completed yet');
    }
  }

  const hasActiveOrders = await Order.exists({
    table: table._id,
    status: { $in: ACTIVE_ORDER_STATUSES },
  });
  if (hasActiveOrders) {
    throw ApiError.conflict('Table still has active orders');
  }

  // Clearing the session invalidates any leaked/old QR link for this table.
  table.session = { id: undefined, expiresAt: undefined };
  if (table.status === 'occupied') table.status = 'available';
  await table.save();

  return ok(res, { table }, 'Table released successfully');
});
