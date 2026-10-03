const { sql } = require('../config/db');
const config = require('../config');
const orders = require('../db/orders');
const tables = require('../db/tables');
const menu = require('../db/menu');
const payments = require('../db/payments');
const restaurants = require('../db/restaurants');
const { isUuid } = require('../db/mappers');
const { getIO } = require('../realtime');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { ok, created } = require('../utils/apiResponse');
const { toId, isSameRestaurant, requireStaffScope } = require('../utils/scope');
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

const { ACTIVE_STATUSES } = orders;

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
  const rooms = [
    toId(order.restaurant) ? `restaurant_${toId(order.restaurant)}` : null,
    toId(order.table) ? `table_${toId(order.table)}` : null,
  ].filter(Boolean);
  rooms.forEach((room) => io.to(room).emit(eventName, { success: true, order }));
};

const emitOrderReady = (io, order, message) => {
  emitOrderEventToRooms(io, order, 'order_ready');
  if (toId(order.waiter)) {
    io.to(`waiter_${toId(order.waiter)}`).emit('order_ready', {
      orderId: order._id,
      orderNumber: order.orderNumber,
      tableId: toId(order.table),
      message,
    });
  }
  notifyOrderReady(order);
};

// @desc   Place an order (public — placed by a diner after scanning the table QR)
// @route  POST /api/orders
exports.createOrder = asyncHandler(async (req, res) => {
  const { table, items, notes, paymentMethod, client, waiter, sessionId } = req.body;

  if (!table || !Array.isArray(items) || items.length === 0) {
    throw ApiError.badRequest('Please provide table and at least one item');
  }

  const tableDocument = await tables.findById(table);
  if (!tableDocument) throw ApiError.badRequest('Invalid table');

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
    const geo = await restaurants.findById(tableDocument.restaurant);
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
  const menuItems = await menu.findItemsForRestaurant(requestedIds, restaurant);
  const menuById = new Map(menuItems.map((m) => [m._id, m]));

  const orderItems = items.map((item) => {
    const menuItem = menuById.get(toId(item.menuItem));
    if (!menuItem) {
      throw ApiError.badRequest('One or more items are invalid for this restaurant');
    }
    if (!menuItem.isAvailable) {
      throw ApiError.badRequest(`Item is not available: ${menuItem.name?.fr || menuItem._id}`);
    }
    const quantity = Math.max(1, Math.floor(Number(item.quantity)) || 1);
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
  const orderClient =
    req.user?.role === 'client' ? req.user._id : isUuid(client) ? client : undefined;
  // Section routing: a waiter who places it owns it; otherwise route to the
  // table's assigned waiter so the "ready" ping targets one person.
  const orderWaiter =
    req.user?.role === 'waiter'
      ? req.user._id
      : (isUuid(waiter) ? waiter : null) || tableDocument.assignedWaiter || undefined;
  const method = ['cash', 'card', 'mobile'].includes(paymentMethod) ? paymentMethod : undefined;

  const orderRow = await sql.begin(async (tx) => {
    // Lock the table so concurrent orders for it are checked one at a time —
    // the caps below can't be bypassed by firing requests in parallel.
    await tables.findById(tableDocument._id, { forUpdate: true, db: tx });

    // Anti-abuse caps: a photographed QR can't flood a table. Cap the number of
    // open orders and the total unpaid tab per table.
    const open = await orders.openTabForTable(tableDocument._id, tx);
    if (open.count >= config.orders.maxActivePerTable) {
      throw ApiError.badRequest('This table has too many open orders — please ask a staff member.');
    }
    if (Number(open.sum) + totalAmount > config.orders.maxOpenTab) {
      throw ApiError.badRequest('This table has reached its open-tab limit — please settle the bill first.');
    }

    const row = await orders.insert(
      tx,
      {
        restaurant,
        table: tableDocument._id,
        client: orderClient,
        waiter: orderWaiter,
        notes: sanitizeText(notes, 1000),
        paymentMethod: method,
        totalAmount,
      },
      orderItems
    );
    await tables.update(tableDocument._id, { status: 'occupied' }, tx);

    if (method === 'cash' || method === 'mobile') {
      await payments.create(
        {
          order: row.id,
          restaurant,
          amount: totalAmount,
          method: method === 'mobile' ? 'card' : 'cash',
          status: 'pending',
        },
        tx
      );
    }
    return row;
  });

  const order = await orders.populateById(orderRow.id);
  const io = getIO();
  emitOrderEventToRooms(io, order, 'new_order');
  emitOrderEventToRooms(io, order, 'newOrder'); // backward-compatible

  // Drinks are brought by the waiter, not the kitchen — flag them on placement.
  if (orderItems.some((item) => item.prepStation === 'bar')) {
    emitOrderEventToRooms(io, order, 'drinks_requested');
  }
  if (method === 'cash' || method === 'mobile') {
    io.to(`restaurant_${toId(restaurant)}`).emit('cashPaymentRequested', {
      success: true,
      order,
      paymentMethod: method,
    });
  }

  return created(res, { order }, 'Order placed');
});

const parseDate = (value) => {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

// Role-based visibility filter shared by the list endpoints.
const scopeFilterFor = (user) => {
  const role = user.role;
  if (role === 'superadmin') return {};
  if (['manager', 'cashier', 'cook'].includes(role)) return { restaurantId: requireStaffScope(user) };
  if (role === 'waiter') return { restaurantId: requireStaffScope(user), waiterId: user._id };
  if (role === 'client') return { clientId: user._id };
  throw ApiError.forbidden();
};

// @desc   List orders (scoped by role)
// @route  GET /api/orders
exports.getOrders = asyncHandler(async (req, res) => {
  const { status, startDate, endDate } = req.query;
  const filter = {
    ...scopeFilterFor(req.user),
    status: status && ORDER_STATUSES.includes(status) ? status : undefined,
    from: parseDate(startDate),
    to: parseDate(endDate),
  };
  const list = await orders.list(filter);
  return ok(res, { count: list.length, orders: list });
});

// @desc   Get one order (public tracking allowed)
// @route  GET /api/orders/:id
exports.getOrderById = asyncHandler(async (req, res) => {
  const order = await orders.populateById(req.params.id);
  if (!order) throw ApiError.notFound('Order not found');
  if (!canReadOrder(req.user, order)) throw ApiError.forbidden();
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

  const order = await orders.findById(req.params.id);
  if (!order) throw ApiError.notFound('Order not found');
  if (!canUpdateOrderStatus(req.user, order)) throw ApiError.forbidden();

  if (order.status !== status && !canTransitionOrder(order.status, status)) {
    throw ApiError.badRequest(`Cannot change order status from '${order.status}' to '${status}'`);
  }

  const set = { status };
  // A waiter who picks up an unassigned order becomes its waiter.
  if (req.user.role === 'waiter' && !toId(order.waiter)) set.waiter_id = req.user._id;
  // Serving is a race — two waiters may tap at once. Record who served.
  if (status === 'served') set.served_by_id = req.user._id;

  // Optimistic concurrency: only transition if the status is still what we read,
  // so the loser of a double-tap gets a clear 409 instead of a silent re-action.
  const moved = await sql.begin(async (tx) => {
    const row = await orders.updateIf(order._id, set, [sql`status = ${order.status}`], tx);
    if (row && status === 'served') await orders.markAllItemsServed(order._id, tx);
    return row;
  });

  if (!moved) {
    const fresh = await orders.findById(order._id);
    throw ApiError.conflict(`Order was already moved to '${fresh?.status ?? 'another status'}'`);
  }

  const updated = await orders.populateById(order._id);
  const io = getIO();
  emitOrderEventToRooms(io, updated, 'order_updated');
  emitOrderEventToRooms(io, updated, 'orderStatusUpdated'); // backward-compatible
  if (status === 'ready') emitOrderReady(io, updated, 'Your order is ready to serve');

  return ok(res, { order: updated }, 'Order updated');
});

// @desc   Active orders for a table
// @route  GET /api/orders/table/:tableId
exports.getTableOrders = asyncHandler(async (req, res) => {
  if (!isUuid(req.params.tableId)) throw ApiError.badRequest('Invalid table id');
  const list = await orders.list({
    ...scopeFilterFor(req.user),
    tableId: req.params.tableId,
    statuses: ACTIVE_STATUSES,
  });
  return ok(res, { count: list.length, orders: list });
});

// @desc   Cancel an order
// @route  PUT /api/orders/:id/cancel
exports.cancelOrder = asyncHandler(async (req, res) => {
  const order = await orders.findById(req.params.id);
  if (!order) throw ApiError.notFound('Order not found');
  if (!canCancelOrder(req.user, order)) throw ApiError.forbidden();

  await orders.update(order._id, { status: 'cancelled' });
  const updated = await orders.populateById(order._id);

  getIO().to(`restaurant_${toId(updated.restaurant)}`).emit('orderCancelled', {
    success: true,
    order: updated,
  });

  return ok(res, { order: updated }, 'Order cancelled successfully');
});

// @desc   Diner asks to pay at the table — notifies the cashier/waiter to come.
// @route  POST /api/orders/:id/request-bill
// @access Public (diner)
exports.requestBill = asyncHandler(async (req, res) => {
  const method = req.body?.method === 'card' ? 'card' : 'cash';
  const order = await orders.findById(req.params.id);
  if (!order) throw ApiError.notFound('Order not found');
  // Don't ping staff for bills that can't be settled (spam guard).
  if (order.paymentStatus === 'paid') throw ApiError.badRequest('Order is already paid');
  if (order.status === 'cancelled') throw ApiError.badRequest('Order is cancelled');

  const table = order.table ? await tables.findById(order.table) : null;
  const payload = {
    orderId: order._id,
    orderNumber: order.orderNumber,
    table: table ? { _id: table._id, number: table.number } : null,
    method,
  };
  const io = getIO();
  io.to(`restaurant_${toId(order.restaurant)}`).emit('bill_requested', payload);
  if (toId(order.waiter)) io.to(`waiter_${toId(order.waiter)}`).emit('bill_requested', payload);

  return ok(res, { requested: true, method }, 'Staff have been notified');
});

// Resolve the restaurant scope for staff endpoints (superadmin may pass ?restaurantId).
const resolveStaffRestaurant = (req) => {
  const id = req.user.role === 'superadmin' ? req.query.restaurantId : toId(req.user.restaurant);
  return isUuid(id) ? id : null;
};

// @desc   Kitchen Display System board — active orders in FIFO order
// @route  GET /api/orders/kds
// @access cook / manager / superadmin
exports.getKdsOrders = asyncHandler(async (req, res) => {
  const restaurant = resolveStaffRestaurant(req);
  if (!restaurant) throw ApiError.forbidden('Restaurant context is required');

  // Show orders immediately — the geofence is the gate. Oldest first = front of the queue.
  const list = await orders.list(
    { restaurantId: restaurant, statuses: ACTIVE_STATUSES },
    { sort: 'asc' }
  );
  return ok(res, { count: list.length, orders: list });
});

// @desc   Incoming orders awaiting staff confirmation (the anti-abuse accept queue)
// @route  GET /api/orders/incoming
// @access waiter / cook / manager / superadmin
exports.getIncomingOrders = asyncHandler(async (req, res) => {
  const restaurant = resolveStaffRestaurant(req);
  if (!restaurant) throw ApiError.forbidden('Restaurant context is required');

  const list = await orders.list({ restaurantId: restaurant, status: 'pending' }, { sort: 'asc' });
  return ok(res, { count: list.length, orders: list });
});

// @desc   Confirm (accept) a pending order so the kitchen can start it
// @route  PUT /api/orders/:id/confirm
// @access waiter / cook / manager / superadmin
exports.confirmOrder = asyncHandler(async (req, res) => {
  const order = await orders.findById(req.params.id);
  if (!order) throw ApiError.notFound('Order not found');
  if (!canUpdateOrderStatus(req.user, order)) throw ApiError.forbidden();

  if (order.status !== 'pending') {
    throw ApiError.badRequest(`Only pending orders can be confirmed (this one is '${order.status}')`);
  }

  const moved = await orders.updateIf(order._id, { status: 'confirmed' }, [sql`status = 'pending'`]);
  if (!moved) throw ApiError.conflict('Order is no longer pending');

  const updated = await orders.populateById(order._id);
  const io = getIO();
  emitOrderEventToRooms(io, updated, 'order_updated');
  emitOrderEventToRooms(io, updated, 'order_confirmed');

  return ok(res, { order: updated }, 'Order confirmed');
});

// @desc   A waiter claims an unassigned order (atomic — first claimer wins)
// @route  PUT /api/orders/:id/claim
// @access waiter / manager / superadmin
exports.claimOrder = asyncHandler(async (req, res) => {
  const order = await orders.findById(req.params.id);
  if (!order) throw ApiError.notFound('Order not found');
  if (!isSameRestaurant(req.user, order.restaurant)) throw ApiError.forbidden();

  const claimed = await orders.updateIf(order._id, { waiter_id: req.user._id }, [
    sql`waiter_id is null`,
  ]);
  if (!claimed) {
    const fresh = await orders.populateById(order._id);
    throw ApiError.conflict(`Already claimed by ${fresh?.waiter?.name || 'another waiter'}`);
  }

  const updated = await orders.populateById(order._id);
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

  // The order row is locked for the whole read-modify-write, so the cook claim
  // and the derived order status can't race another KDS screen.
  const orderId = await sql.begin(async (tx) => {
    const order = await orders.findById(req.params.id, { forUpdate: true, db: tx });
    if (!order) throw ApiError.notFound('Order not found');
    if (!canUpdateOrderStatus(req.user, order)) throw ApiError.forbidden();

    const item = order.items.find((i) => i._id === req.params.itemId);
    if (!item) throw ApiError.notFound('Order item not found');

    if (item.status !== status && !canTransitionItem(item.status, status)) {
      throw ApiError.badRequest(`Cannot change item status from '${item.status}' to '${status}'`);
    }

    const set = {};
    // KDS claim-on-start: the first cook to touch a ticket owns it, so two cooks
    // on separate KDS screens can never prepare the same order.
    if (req.user.role === 'cook') {
      if (order.preparedBy && toId(order.preparedBy) !== toId(req.user._id)) {
        throw ApiError.conflict(`Ticket is being prepared by ${order.preparedByName || 'another cook'}`);
      }
      set.prepared_by_id = req.user._id;
      set.prepared_by_name = req.user.name;
    }

    await orders.setItemStatus(item._id, status, tx);
    item.status = status;
    // Roll the change up to the order-level status (unless cancelled).
    if (order.status !== 'cancelled') set.status = deriveOrderStatus(order);
    if (req.user.role === 'waiter' && !toId(order.waiter)) set.waiter_id = req.user._id;

    if (Object.keys(set).length) await orders.update(order._id, set, tx);
    return order._id;
  });

  const order = await orders.populateById(orderId);
  const io = getIO();
  emitOrderEventToRooms(io, order, 'kds_updated');
  emitOrderEventToRooms(io, order, 'order_updated');

  // When the whole order becomes ready, notify the responsible waiter.
  if (order.status === 'ready') emitOrderReady(io, order, 'Order is ready to serve');

  return ok(res, { order }, 'Item status updated');
});

// @desc   Cashier lookup: active unpaid orders for a table number + amount due
// @route  GET /api/orders/active?tableNumber=12
// @access cashier / manager / superadmin
exports.getActiveByTable = asyncHandler(async (req, res) => {
  const tableNumber = Number(req.query.tableNumber);
  if (!Number.isInteger(tableNumber) || tableNumber <= 0) {
    throw ApiError.badRequest('A valid tableNumber is required');
  }

  const restaurant = resolveStaffRestaurant(req);
  if (!restaurant) throw ApiError.forbidden('Restaurant context is required');

  const table = await tables.findByNumber(restaurant, tableNumber);
  if (!table) throw ApiError.notFound('Table not found');

  const list = await orders.list(
    {
      restaurantId: restaurant,
      tableId: table._id,
      excludeStatus: 'cancelled',
      excludePaymentStatus: 'paid',
    },
    { sort: 'asc' }
  );
  const totalDue = list.reduce((sum, order) => sum + (order.totalAmount || 0), 0);

  return ok(res, {
    table: { id: table._id, number: table.number },
    count: list.length,
    totalDue,
    orders: list,
  });
});
