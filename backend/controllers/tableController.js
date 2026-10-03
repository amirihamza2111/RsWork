const crypto = require('crypto');
const QRCode = require('qrcode');
const config = require('../config');
const tables = require('../db/tables');
const orders = require('../db/orders');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { ok } = require('../utils/apiResponse');
const { toId, isSameRestaurant } = require('../utils/scope');
const { autoAssignSections, waiterHeartbeat, waiterLeft } = require('../services/sectionService');
const { isSessionActive } = require('../utils/tableSession');

// Dev-only fallback. In production CLIENT_URL MUST be set (Render env) so table
// QR codes point at the live diner app; a wrong base URL sends scans nowhere.
const DEFAULT_FRONTEND_URL = 'http://localhost:5173';

let warnedMissingClientUrl = false;
const getClientBaseUrl = () => {
  const configured = String(config.clientUrl || process.env.FRONTEND_PUBLIC_URL || '').trim();
  if (!configured) {
    if (config.isProd && !warnedMissingClientUrl) {
      warnedMissingClientUrl = true;
      console.warn(
        `⚠️  CLIENT_URL is not set — table QR codes will point at ${DEFAULT_FRONTEND_URL}. ` +
          'Set CLIENT_URL to your live frontend URL, then regenerate QR codes (Tables → Regenerate QR).'
      );
    }
    return DEFAULT_FRONTEND_URL;
  }
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

  if (!number || !Number.isInteger(tableNumber) || tableNumber <= 0) {
    throw ApiError.badRequest('Please provide a valid table number');
  }
  if (!restaurant) throw ApiError.forbidden('Restaurant context is required');

  if (await tables.findByNumber(restaurant, tableNumber)) {
    throw ApiError.badRequest('Table number already exists');
  }

  const table = await tables.create({
    restaurantId: restaurant,
    number: tableNumber,
    capacity: Number(capacity) || 4,
  });
  const withQr = await tables.update(table._id, { qrCode: await generateTableQRCode(table._id) });
  return ok(res, { table: withQr }, 'Table created', 201);
});

exports.getTables = asyncHandler(async (req, res) => {
  const role = req.user.role;
  const restaurantId = req.user.restaurant;

  if (!restaurantId && role !== 'superadmin') {
    throw ApiError.forbidden('Restaurant context is required');
  }

  let list;
  if (role === 'waiter') {
    // A waiter sees their section (auto-assigned tables) plus any table where
    // they already carry an order (claimed/legacy orders outside the section).
    list = await tables.list({ waiterSection: { restaurantId, waiterId: req.user._id } });
  } else if (role === 'client') {
    const mine = await orders.list({ clientId: req.user._id }, { populate: false });
    list = await tables.list({ ids: [...new Set(mine.map((o) => o.table).filter(Boolean))] });
  } else if (role === 'superadmin') {
    list = await tables.list();
  } else {
    list = await tables.list({ restaurantId });
  }
  return ok(res, { count: list.length, tables: list });
});

exports.updateTable = asyncHandler(async (req, res) => {
  const { number, capacity, status, assignedWaiter } = req.body;
  const table = await tables.findById(req.params.id);
  if (!table) throw ApiError.notFound('Table not found');
  if (!isSameRestaurant(req.user, table.restaurant)) throw ApiError.forbidden();

  const updated = await tables.update(table._id, {
    number: number ? Number(number) : undefined,
    capacity: capacity ? Number(capacity) : undefined,
    status: status || undefined,
    // Section assignment — '' / null clears it, an id sets the responsible waiter.
    assignedWaiter: assignedWaiter !== undefined ? assignedWaiter || null : undefined,
  });
  return ok(res, { table: updated }, 'Table updated');
});

exports.deleteTable = asyncHandler(async (req, res) => {
  const table = await tables.findById(req.params.id);
  if (!table) throw ApiError.notFound('Table not found');
  if (!isSameRestaurant(req.user, table.restaurant)) throw ApiError.forbidden();

  await tables.remove(table._id);
  return ok(res, null, 'Table deleted successfully');
});

// @desc   Force a full section reshuffle across the online waiters
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

// @desc   Waiter board heartbeat — marks the waiter as on the floor
// @route  POST /api/tables/presence
// @access waiter
exports.presenceHeartbeat = asyncHandler(async (req, res) => {
  const restaurantId = toId(req.user.restaurant);
  if (!restaurantId) throw ApiError.forbidden('Restaurant context is required');
  const result = await waiterHeartbeat(restaurantId, req.user._id);
  return ok(res, result);
});

// @desc   Waiter board closed — leave the floor immediately
// @route  DELETE /api/tables/presence
// @access waiter
exports.presenceLeave = asyncHandler(async (req, res) => {
  await waiterLeft(req.user._id);
  return ok(res, { left: true });
});

exports.regenerateAllQRCodes = asyncHandler(async (req, res) => {
  const role = req.user.role;
  const restaurantId = req.user.restaurant;

  if (!restaurantId && role !== 'superadmin') {
    throw ApiError.forbidden('Restaurant context is required');
  }

  const ids = await tables.listIdsForRestaurant(role === 'superadmin' ? null : restaurantId);
  await Promise.all(
    ids.map(async (id) => tables.update(id, { qrCode: await generateTableQRCode(id) }))
  );

  return ok(res, { count: ids.length }, 'QR codes regenerated successfully');
});

exports.getTableByQR = asyncHandler(async (req, res) => {
  const tableId = req.params.id || req.params.tableId;
  const table = await tables.findById(tableId, { populate: true });
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
  let table = await tables.findById(req.params.id, { populate: true });
  if (!table) throw ApiError.notFound('Table not found');

  const now = Date.now();
  if (!isSessionActive(table.session, now)) {
    const updated = await tables.update(table._id, {
      sessionId: crypto.randomUUID(),
      sessionExpiresAt: new Date(now + SESSION_TTL_MS),
      status: table.status === 'available' ? 'occupied' : undefined,
    });
    table = { ...updated, restaurant: table.restaurant };
  }

  return ok(res, {
    table,
    session: { id: table.session.id, expiresAt: table.session.expiresAt },
  });
});

exports.releaseTableSession = asyncHandler(async (req, res) => {
  const tableId = req.params.id;
  const orderId = String(req.body?.orderId || '').trim();

  const table = await tables.findById(tableId);
  if (!table) throw ApiError.notFound('Table not found');

  if (orderId) {
    const order = await orders.findById(orderId);
    if (!order || toId(order.table) !== toId(table._id)) {
      throw ApiError.badRequest('Order does not match the table');
    }
    const status = String(order.status || '').toLowerCase();
    if (status !== 'served' && status !== 'cancelled') {
      throw ApiError.conflict('Order is not completed yet');
    }
  }

  if (await orders.hasActiveForTable(table._id)) {
    throw ApiError.conflict('Table still has active orders');
  }

  // Clearing the session invalidates any leaked/old QR link for this table.
  const updated = await tables.update(table._id, {
    sessionId: null,
    sessionExpiresAt: null,
    status: table.status === 'occupied' ? 'available' : undefined,
  });

  return ok(res, { table: updated }, 'Table released successfully');
});
