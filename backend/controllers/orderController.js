const Order = require('../models/Order');
const Table = require('../models/Table');
const MenuItem = require('../models/MenuItem');
const Payment = require('../models/Payment');
const Restaurant = require('../models/Restaurant');
const config = require('../config');
const { getIO } = require('../sockets/index');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { ok, created } = require('../utils/apiResponse');
const { toId, isSameRestaurant } = require('../utils/scope');
const { sanitizeText } = require('../utils/sanitizeText');
const { redactOrderForPublic } = require('../utils/orderView');
const { distanceMeters } = require('../utils/geo');
const { isValidOrderSession } = require('../utils/tableSession');
const { sendToRestaurantWaiters, sendToUser } = require('../services/pushService');
const {
  ORDER_STATUSES,
  ITEM_STATUSES,
  canTransitionOrder,
  canTransitionItem,
  deriveOrderStatus,
} = require('../utils/orderWorkflow');

// Who may see customer/staff identity on an order (everyone else gets a
// redacted view — important because order tracking is public).
const canViewOrderPII = (user, order) => {
  if (!user || !order) return false;
  if (user.role === 'superadmin') return true;
  if (['manager', 'cashier', 'cook', 'waiter'].includes(user.role)) {
    return isSameRestaurant(user, order.restaurant);
  }
  if (user.role === 'client') return toId(order.client) === toId(user._id);
  return false;
};

const ACTIVE_STATUSES = ['pending', 'confirmed', 'preparing', 'ready'];

// Notify the waiter responsible for a ready order: the assigned/claiming waiter
// gets a targeted push; if the order has no waiter yet, fall back to the floor.
const notifyOrderReady = (order) => {
  const payload = {
    title: `Table ${order.table?.number ?? ''} ready`,
    body: `${order.orderNumber} is ready to serve`,
    tag: `order-${order._id}`,
    url: '/waiter',
  };
  if (toId(order.waiter)) {
    sendToUser(toId(order.waiter), payload).catch(() => {});
  } else {
    sendToRestaurantWaiters(toId(order.restaurant), payload).catch(() => {});
  }
};

const POPULATE = [
  'restaurant',
  { path: 'table', select: 'number' },
  { path: 'client', select: 'name email phone' },
  { path: 'waiter', select: 'name' },
  'items.menuItem',
];

const canReadOrder = (user, order) => {
  if (!user) return true; // public tracking links
  if (!order) return false;
  if (!isSameRestaurant(user, order.restaurant)) return false;

  const role = user.role;
  if (['manager', 'superadmin', 'cashier', 'cook'].includes(role)) return true;
  if (role === 'waiter') return toId(order.waiter) === toId(user._id);
  if (role === 'client') return toId(order.client) === toId(user._id);
  return false;
};

const canUpdateOrderStatus = (user, order) => {
  if (!user || !order) return false;
  if (!isSameRestaurant(user, order.restaurant)) return false;
  return ['manager', 'superadmin', 'cook', 'waiter'].includes(user.role);
};

const canCancelOrder = (user, order) => {
  if (!user || !order) return false;
  if (!isSameRestaurant(user, order.restaurant)) return false;

  const role = user.role;
  if (['manager', 'superadmin'].includes(role)) return true;
  if (role === 'waiter') return toId(order.waiter) === toId(user._id);
  if (role === 'client') return toId(order.client) === toId(user._id);
  return false;
};

const emitOrderEventToRooms = (io, order, eventName) => {
  if (!io) return;
  const rooms = [
    toId(order.restaurant) ? `restaurant_${toId(order.restaurant)}` : null,
    toId(order.table) ? `table_${toId(order.table)}` : null,
  ].filter(Boolean);
  rooms.forEach((room) => io.to(room).emit(eventName, { success: true, order }));
};

// @desc   Place an order (public — placed by a diner after scanning the table QR)
// @route  POST /api/orders
exports.createOrder = asyncHandler(async (req, res) => {
  const { table, items, notes, paymentMethod, client, waiter, sessionId } = req.body;

  if (!table || !Array.isArray(items) || items.length === 0) {
    throw ApiError.badRequest('Please provide table and at least one item');
  }

  const tableDocument = await Table.findById(table);
  if (!tableDocument) {
    throw ApiError.badRequest('Invalid table');
  }

  // Public (diner) orders must carry the table's current, unexpired session id.
  // Staff place orders authenticated, so they bypass this. This is what stops a
  // photographed QR from ordering once the table has been released.
  const isStaff =
    Boolean(req.user) &&
    ['waiter', 'cook', 'cashier', 'manager', 'superadmin'].includes(req.user.role);
  if (!isStaff) {
    if (!isValidOrderSession(tableDocument.session, sessionId)) {
      throw ApiError.forbidden('Your table session is invalid or expired — please rescan the QR code.');
    }

    // Geofence: when the restaurant has a location configured, the diner must be
    // physically near it. Dormant (skipped) until the manager sets coordinates,
    // so it never blocks before it's configured.
    const geo = await Restaurant.findById(tableDocument.restaurant)
      .select('location geofenceRadius')
      .lean();
    if (geo?.location?.lat != null && geo.location.lng != null) {
      const { lat, lng } = req.body;
      if (typeof lat !== 'number' || typeof lng !== 'number') {
        throw ApiError.forbidden('Please enable location so we can confirm you are at the restaurant.');
      }
      const dist = distanceMeters(geo.location, { lat, lng });
      if (dist > (geo.geofenceRadius || 250)) {
        throw ApiError.forbidden('You appear to be away from the restaurant, so ordering is disabled.');
      }
    }
  }

  // Restaurant is derived from the table, never trusted from the request body.
  const restaurant = tableDocument.restaurant;

  // Look up real prices from the DB; ignore any prices sent by the client.
  const requestedIds = items.map((item) => toId(item.menuItem)).filter(Boolean);
  const menuItems = await MenuItem.find({ _id: { $in: requestedIds }, restaurant });
  const menuById = new Map(menuItems.map((m) => [String(m._id), m]));

  const orderItems = items.map((item) => {
    const menuItem = menuById.get(toId(item.menuItem));
    if (!menuItem) {
      throw ApiError.badRequest('One or more items are invalid for this restaurant');
    }
    if (!menuItem.isAvailable) {
      throw ApiError.badRequest(`Item is not available: ${menuItem.name?.fr || menuItem._id}`);
    }
    const quantity = Math.max(1, Number(item.quantity) || 1);
    return {
      menuItem: menuItem._id,
      quantity,
      price: menuItem.price, // server-side price
      options: sanitizeText(item.options, 200),
      comment: sanitizeText(item.comment, 300),
      prepStation: menuItem.prepStation === 'bar' ? 'bar' : 'kitchen',
    };
  });

  const totalAmount = orderItems.reduce((sum, item) => sum + item.price * item.quantity, 0);

  // Anti-abuse caps (Problem 3): a photographed QR can't flood a table. Cap the
  // number of open orders and the total unpaid tab per table.
  const openFilter = {
    table: tableDocument._id,
    status: { $in: ACTIVE_STATUSES },
    paymentStatus: { $ne: 'paid' },
  };
  const activeCount = await Order.countDocuments(openFilter);
  if (activeCount >= config.orders.maxActivePerTable) {
    throw ApiError.badRequest('This table has too many open orders — please ask a staff member.');
  }
  const [openAgg] = await Order.aggregate([
    { $match: openFilter },
    { $group: { _id: null, sum: { $sum: '$totalAmount' } } },
  ]);
  if ((openAgg?.sum || 0) + totalAmount > config.orders.maxOpenTab) {
    throw ApiError.badRequest('This table has reached its open-tab limit — please settle the bill first.');
  }

  // Attach the caller's identity when known, instead of trusting body ids.
  const orderClient = req.user?.role === 'client' ? req.user._id : client || undefined;
  // Section routing (Problem 1): a waiter who places it owns it; otherwise route
  // to the table's assigned waiter so the "ready" ping targets one person.
  const orderWaiter =
    req.user?.role === 'waiter'
      ? req.user._id
      : waiter || tableDocument.assignedWaiter || undefined;

  const order = await Order.create({
    restaurant,
    table,
    client: orderClient,
    waiter: orderWaiter,
    items: orderItems,
    notes: sanitizeText(notes, 1000),
    paymentMethod,
    totalAmount,
  });

  await Table.updateOne({ _id: tableDocument._id }, { $set: { status: 'occupied' } });
  await order.populate(POPULATE);

  const io = getIO();
  emitOrderEventToRooms(io, order, 'new_order');
  emitOrderEventToRooms(io, order, 'newOrder'); // backward-compatible

  // Drinks are brought by the waiter, not the kitchen — flag them on placement.
  if (orderItems.some((item) => item.prepStation === 'bar')) {
    emitOrderEventToRooms(io, order, 'drinks_requested');
  }

  if (paymentMethod === 'cash' || paymentMethod === 'mobile') {
    await Payment.create({
      order: order._id,
      restaurant,
      amount: totalAmount,
      method: paymentMethod === 'mobile' ? 'card' : 'cash',
      status: 'pending',
    });
    io?.to(`restaurant_${toId(restaurant)}`).emit('cashPaymentRequested', {
      success: true,
      order,
      paymentMethod,
    });
  }

  return created(res, { order }, 'Order placed');
});

// @desc   List orders (scoped by role)
// @route  GET /api/orders
exports.getOrders = asyncHandler(async (req, res) => {
  const user = req.user;
  const { status, startDate, endDate } = req.query;
  const role = user.role;

  let filter;
  if (role === 'superadmin') {
    filter = {};
  } else if (['manager', 'cashier', 'cook'].includes(role)) {
    filter = { restaurant: user.restaurant };
  } else if (role === 'waiter') {
    filter = { restaurant: user.restaurant, waiter: user._id };
  } else if (role === 'client') {
    filter = { client: user._id };
  } else {
    throw ApiError.forbidden();
  }

  if (status) filter.status = status;
  if (startDate || endDate) {
    filter.createdAt = {};
    if (startDate) filter.createdAt.$gte = new Date(startDate);
    if (endDate) filter.createdAt.$lte = new Date(endDate);
  }

  const orders = await Order.find(filter).populate(POPULATE).sort({ createdAt: -1 });
  return ok(res, { count: orders.length, orders });
});

// @desc   Get one order (public tracking allowed)
// @route  GET /api/orders/:id
exports.getOrderById = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id).populate(POPULATE);
  if (!order) {
    throw ApiError.notFound('Order not found');
  }
  if (!canReadOrder(req.user, order)) {
    throw ApiError.forbidden();
  }
  // Public/anonymous trackers get a PII-redacted view.
  const view = canViewOrderPII(req.user, order) ? order : redactOrderForPublic(order);
  return ok(res, { order: view });
});

// @desc   Update order status
// @route  PUT /api/orders/:id/status
exports.updateOrderStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!status || !ORDER_STATUSES.includes(status)) {
    throw ApiError.badRequest('Please provide a valid status');
  }

  const order = await Order.findById(req.params.id);
  if (!order) {
    throw ApiError.notFound('Order not found');
  }
  if (!canUpdateOrderStatus(req.user, order)) {
    throw ApiError.forbidden();
  }

  if (order.status !== status && !canTransitionOrder(order.status, status)) {
    throw ApiError.badRequest(`Cannot change order status from '${order.status}' to '${status}'`);
  }

  const set = { status };
  // A waiter who picks up an unassigned order becomes its waiter.
  if (req.user.role === 'waiter' && !toId(order.waiter)) set.waiter = req.user._id;
  // Serving is a race — two waiters may tap at once. Record who served and mark
  // every item served in the same atomic write.
  if (status === 'served') {
    set.servedBy = req.user._id;
    set['items.$[].status'] = 'served';
  }

  // Optimistic concurrency: only transition if the status is still what we read,
  // so the loser of a double-tap gets a clear 409 instead of a silent re-action.
  const updated = await Order.findOneAndUpdate(
    { _id: order._id, status: order.status },
    { $set: set },
    { new: true }
  ).populate(POPULATE);

  if (!updated) {
    const fresh = await Order.findById(order._id).select('status');
    throw ApiError.conflict(`Order was already moved to '${fresh?.status ?? 'another status'}'`);
  }

  const io = getIO();
  emitOrderEventToRooms(io, updated, 'order_updated');
  emitOrderEventToRooms(io, updated, 'orderStatusUpdated'); // backward-compatible

  if (status === 'ready') {
    emitOrderEventToRooms(io, updated, 'order_ready');
    if (updated.waiter) {
      io?.to(`waiter_${toId(updated.waiter)}`).emit('order_ready', {
        orderId: updated._id,
        orderNumber: updated.orderNumber,
        tableId: toId(updated.table),
        message: 'Your order is ready to serve',
      });
    }
    notifyOrderReady(updated);
  }

  return ok(res, { order: updated }, 'Order updated');
});

// @desc   Active orders for a table
// @route  GET /api/orders/table/:tableId
exports.getTableOrders = asyncHandler(async (req, res) => {
  const role = req.user.role;
  const filter = {
    table: req.params.tableId,
    status: { $in: ['pending', 'confirmed', 'preparing', 'ready'] },
  };

  if (role === 'superadmin') {
    // no extra scope
  } else if (['manager', 'cashier', 'cook'].includes(role)) {
    filter.restaurant = req.user.restaurant;
  } else if (role === 'waiter') {
    filter.restaurant = req.user.restaurant;
    filter.waiter = req.user._id;
  } else if (role === 'client') {
    filter.client = req.user._id;
  } else {
    throw ApiError.forbidden();
  }

  const orders = await Order.find(filter).populate(POPULATE).sort({ createdAt: -1 });
  return ok(res, { count: orders.length, orders });
});

// @desc   Cancel an order
// @route  PUT /api/orders/:id/cancel
exports.cancelOrder = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) {
    throw ApiError.notFound('Order not found');
  }
  if (!canCancelOrder(req.user, order)) {
    throw ApiError.forbidden();
  }

  order.status = 'cancelled';
  await order.save();
  await order.populate(POPULATE);

  getIO()?.to(`restaurant_${toId(order.restaurant)}`).emit('orderCancelled', {
    success: true,
    order,
  });

  return ok(res, { order }, 'Order cancelled successfully');
});

// @desc   Diner asks to pay at the table — notifies the cashier/waiter to come.
// @route  POST /api/orders/:id/request-bill
// @access Public (diner)
exports.requestBill = asyncHandler(async (req, res) => {
  const method = req.body?.method === 'card' ? 'card' : 'cash';
  const order = await Order.findById(req.params.id).populate('table', 'number');
  if (!order) throw ApiError.notFound('Order not found');
  // Don't ping staff for bills that can't be settled (spam guard).
  if (order.paymentStatus === 'paid') throw ApiError.badRequest('Order is already paid');
  if (order.status === 'cancelled') throw ApiError.badRequest('Order is cancelled');

  const io = getIO();
  const payload = {
    orderId: order._id,
    orderNumber: order.orderNumber,
    table: order.table,
    method,
  };
  io?.to(`restaurant_${toId(order.restaurant)}`).emit('bill_requested', payload);
  if (toId(order.waiter)) {
    io?.to(`waiter_${toId(order.waiter)}`).emit('bill_requested', payload);
  }

  return ok(res, { requested: true, method }, 'Staff have been notified');
});

// Resolve the restaurant scope for staff endpoints (superadmin may pass ?restaurantId).
const resolveStaffRestaurant = (req) => {
  if (req.user.role === 'superadmin') return req.query.restaurantId || null;
  return toId(req.user.restaurant) || null;
};

// @desc   Kitchen Display System board — active orders in FIFO order
// @route  GET /api/orders/kds
// @access cook / manager / superadmin
exports.getKdsOrders = asyncHandler(async (req, res) => {
  const restaurant = resolveStaffRestaurant(req);
  if (!restaurant) {
    throw ApiError.forbidden('Restaurant context is required');
  }

  const orders = await Order.find({
    restaurant,
    status: { $in: ACTIVE_STATUSES }, // show orders immediately — the geofence is the gate
  })
    .populate('table', 'number')
    .populate('waiter', 'name')
    .populate('items.menuItem', 'name prepStation')
    .sort({ createdAt: 1 }); // oldest first = front of the queue

  return ok(res, { count: orders.length, orders });
});

// @desc   Incoming orders awaiting staff confirmation (the anti-abuse accept queue)
// @route  GET /api/orders/incoming
// @access waiter / cook / manager / superadmin
exports.getIncomingOrders = asyncHandler(async (req, res) => {
  const restaurant = resolveStaffRestaurant(req);
  if (!restaurant) {
    throw ApiError.forbidden('Restaurant context is required');
  }

  const orders = await Order.find({ restaurant, status: 'pending' })
    .populate(POPULATE)
    .sort({ createdAt: 1 });

  return ok(res, { count: orders.length, orders });
});

// @desc   Confirm (accept) a pending order so the kitchen can start it
// @route  PUT /api/orders/:id/confirm
// @access waiter / cook / manager / superadmin
exports.confirmOrder = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) throw ApiError.notFound('Order not found');
  if (!canUpdateOrderStatus(req.user, order)) throw ApiError.forbidden();

  if (order.status !== 'pending') {
    throw ApiError.badRequest(`Only pending orders can be confirmed (this one is '${order.status}')`);
  }

  const updated = await Order.findOneAndUpdate(
    { _id: order._id, status: 'pending' },
    { $set: { status: 'confirmed' } },
    { new: true }
  ).populate(POPULATE);

  if (!updated) throw ApiError.conflict('Order is no longer pending');

  const io = getIO();
  emitOrderEventToRooms(io, updated, 'order_updated');
  emitOrderEventToRooms(io, updated, 'order_confirmed');

  return ok(res, { order: updated }, 'Order confirmed');
});

// @desc   A waiter claims an unassigned order (atomic — first claimer wins)
// @route  PUT /api/orders/:id/claim
// @access waiter / manager / superadmin
exports.claimOrder = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) throw ApiError.notFound('Order not found');
  if (!isSameRestaurant(req.user, order.restaurant)) throw ApiError.forbidden();

  const updated = await Order.findOneAndUpdate(
    { _id: order._id, waiter: { $in: [null, undefined] } },
    { $set: { waiter: req.user._id } },
    { new: true }
  ).populate(POPULATE);

  if (!updated) {
    const fresh = await Order.findById(order._id).populate('waiter', 'name');
    throw ApiError.conflict(`Already claimed by ${fresh?.waiter?.name || 'another waiter'}`);
  }

  emitOrderEventToRooms(getIO(), updated, 'order_updated');
  return ok(res, { order: updated }, 'Order claimed');
});

// @desc   Update a single item's KDS status (cook begins/finishes a dish)
// @route  PATCH /api/orders/:id/items/:itemId/status
// @access cook / manager / superadmin / waiter
exports.updateOrderItemStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!status || !ITEM_STATUSES.includes(status)) {
    throw ApiError.badRequest('Please provide a valid item status');
  }

  const order = await Order.findById(req.params.id);
  if (!order) {
    throw ApiError.notFound('Order not found');
  }
  if (!canUpdateOrderStatus(req.user, order)) {
    throw ApiError.forbidden();
  }

  const item = order.items.id(req.params.itemId);
  if (!item) {
    throw ApiError.notFound('Order item not found');
  }

  if (item.status !== status && !canTransitionItem(item.status, status)) {
    throw ApiError.badRequest(`Cannot change item status from '${item.status}' to '${status}'`);
  }

  // KDS claim-on-start (Problem 2): the first cook to touch a ticket owns it, so
  // two cooks on separate KDS screens can never prepare the same order. Atomic —
  // the claim only succeeds if the ticket is unclaimed or already this cook's.
  if (req.user.role === 'cook') {
    const claimed = await Order.findOneAndUpdate(
      {
        _id: order._id,
        $or: [{ preparedBy: { $in: [null, undefined] } }, { preparedBy: req.user._id }],
      },
      { $set: { preparedBy: req.user._id, preparedByName: req.user.name } },
      { new: true }
    );
    if (!claimed) {
      throw ApiError.conflict(
        `Ticket is being prepared by ${order.preparedByName || 'another cook'}`
      );
    }
    order.preparedBy = claimed.preparedBy;
    order.preparedByName = claimed.preparedByName;
  }

  item.status = status;
  // Roll the change up to the order-level status (unless cancelled/served).
  if (order.status !== 'cancelled') {
    order.status = deriveOrderStatus(order);
  }

  if (req.user.role === 'waiter' && !toId(order.waiter)) {
    order.waiter = req.user._id;
  }

  await order.save();
  await order.populate(POPULATE);

  const io = getIO();
  emitOrderEventToRooms(io, order, 'kds_updated');
  emitOrderEventToRooms(io, order, 'order_updated');

  // When the whole order becomes ready, notify the responsible waiter.
  if (order.status === 'ready') {
    emitOrderEventToRooms(io, order, 'order_ready');
    if (order.waiter) {
      io?.to(`waiter_${toId(order.waiter)}`).emit('order_ready', {
        orderId: order._id,
        orderNumber: order.orderNumber,
        tableId: toId(order.table),
        message: 'Order is ready to serve',
      });
    }
    notifyOrderReady(order);
  }

  return ok(res, { order }, 'Item status updated');
});

// @desc   Cashier lookup: active unpaid orders for a table number + amount due
// @route  GET /api/orders/active?tableNumber=12
// @access cashier / manager / superadmin
exports.getActiveByTable = asyncHandler(async (req, res) => {
  const tableNumber = Number(req.query.tableNumber);
  if (!Number.isFinite(tableNumber) || tableNumber <= 0) {
    throw ApiError.badRequest('A valid tableNumber is required');
  }

  const restaurant = resolveStaffRestaurant(req);
  if (!restaurant) {
    throw ApiError.forbidden('Restaurant context is required');
  }

  const table = await Table.findOne({ restaurant, number: tableNumber });
  if (!table) {
    throw ApiError.notFound('Table not found');
  }

  const orders = await Order.find({
    restaurant,
    table: table._id,
    status: { $ne: 'cancelled' },
    paymentStatus: { $ne: 'paid' },
  })
    .populate('items.menuItem', 'name')
    .sort({ createdAt: 1 });

  const totalDue = orders.reduce((sum, order) => sum + (order.totalAmount || 0), 0);

  return ok(res, {
    table: { id: table._id, number: table.number },
    count: orders.length,
    totalDue,
    orders,
  });
});
