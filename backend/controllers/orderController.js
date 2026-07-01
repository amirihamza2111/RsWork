const Order = require('../models/Order');
const Table = require('../models/Table');
const MenuItem = require('../models/MenuItem');
const Payment = require('../models/Payment');
const { getIO } = require('../sockets/index');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { ok, created } = require('../utils/apiResponse');
const { toId, isSameRestaurant } = require('../utils/scope');
const { sanitizeText } = require('../utils/sanitizeText');
const { redactOrderForPublic } = require('../utils/orderView');
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
  const { table, items, notes, paymentMethod, client, waiter } = req.body;

  if (!table || !Array.isArray(items) || items.length === 0) {
    throw ApiError.badRequest('Please provide table and at least one item');
  }

  const tableDocument = await Table.findById(table);
  if (!tableDocument) {
    throw ApiError.badRequest('Invalid table');
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

  // Attach the caller's identity when known, instead of trusting body ids.
  const orderClient = req.user?.role === 'client' ? req.user._id : client || undefined;
  const orderWaiter = req.user?.role === 'waiter' ? req.user._id : waiter || undefined;

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

  // A waiter who picks up an unassigned order becomes its waiter.
  if (req.user.role === 'waiter' && !toId(order.waiter)) {
    order.waiter = req.user._id;
  }

  // Keep item statuses consistent with terminal order states.
  if (status === 'served') {
    order.items.forEach((item) => {
      item.status = 'served';
    });
  }

  order.status = status;
  await order.save();
  await order.populate(POPULATE);

  const io = getIO();
  emitOrderEventToRooms(io, order, 'order_updated');
  emitOrderEventToRooms(io, order, 'orderStatusUpdated'); // backward-compatible

  if (status === 'ready') {
    emitOrderEventToRooms(io, order, 'order_ready');
    if (order.waiter) {
      io?.to(`waiter_${toId(order.waiter)}`).emit('order_ready', {
        orderId: order._id,
        orderNumber: order.orderNumber,
        tableId: toId(order.table),
        message: 'Your order is ready to serve',
      });
    }
  }

  return ok(res, { order }, 'Order updated');
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
    status: { $in: ACTIVE_STATUSES },
  })
    .populate('table', 'number')
    .populate('items.menuItem', 'name prepStation')
    .sort({ createdAt: 1 }); // oldest first = front of the queue

  return ok(res, { count: orders.length, orders });
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

  // When the whole order becomes ready, notify the assigned waiter by table.
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
