const Table = require('../models/Table');
const Order = require('../models/Order');
const QRCode = require('qrcode');
const config = require('../config');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { ok } = require('../utils/apiResponse');
const { toId, isSameRestaurant } = require('../utils/scope');

const DEFAULT_FRONTEND_URL = 'https://layalicarthage.netlify.app';
const ACTIVE_ORDER_STATUSES = ['pending', 'confirmed', 'preparing', 'ready'];

const getClientBaseUrl = () => {
  const configured = String(
    config.clientUrl || process.env.FRONTEND_PUBLIC_URL || DEFAULT_FRONTEND_URL
  ).trim();
  return configured.replace(/\/+$/, '');
};

const buildTableMenuUrl = (tableId) => `${getClientBaseUrl()}/#/menu?tableId=${tableId}`;
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
    const tableIds = await Order.find({ restaurant: restaurantId, waiter: req.user._id }).distinct(
      'table'
    );
    tableFilter = { ...tableFilter, _id: { $in: tableIds } };
  }

  if (role === 'client') {
    const tableIds = await Order.find({ client: req.user._id }).distinct('table');
    tableFilter = { _id: { $in: tableIds } };
  }

  const tables = await Table.find(tableFilter).populate('restaurant');
  return ok(res, { count: tables.length, tables });
});

exports.updateTable = asyncHandler(async (req, res) => {
  const { number, capacity, status } = req.body;
  const table = await Table.findById(req.params.id);
  if (!table) throw ApiError.notFound('Table not found');
  if (!isSameRestaurant(req.user, table.restaurant)) throw ApiError.forbidden();

  if (number) table.number = number;
  if (capacity) table.capacity = capacity;
  if (status) table.status = status;
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

  if (table.status === 'occupied') {
    table.status = 'available';
    await table.save();
  }

  return ok(res, { table }, 'Table released successfully');
});
