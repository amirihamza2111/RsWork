const express = require('express');
const router = express.Router();
const { protect, authorize, optionalAuth } = require('../middlewares/auth');
const { createOrderValidator } = require('../middlewares/validators');
const validate = require('../middlewares/validate');
const {
  createOrder,
  getOrders,
  getOrderById,
  updateOrderStatus,
  updateOrderItemStatus,
  getTableOrders,
  getKdsOrders,
  getIncomingOrders,
  confirmOrder,
  claimOrder,
  getActiveByTable,
  cancelOrder,
  requestBill,
} = require('../controllers/orderController');

router.post('/', optionalAuth, createOrderValidator, validate, createOrder);

router.get(
  '/',
  protect,
  authorize('manager', 'superadmin', 'waiter', 'cashier', 'cook', 'client'),
  getOrders
);

// Static routes must be declared before the dynamic '/:id' route.
router.get('/kds', protect, authorize('cook', 'waiter', 'manager', 'superadmin'), getKdsOrders);
router.get(
  '/incoming',
  protect,
  authorize('cook', 'waiter', 'manager', 'superadmin'),
  getIncomingOrders
);
router.get('/active', protect, authorize('cashier', 'manager', 'superadmin'), getActiveByTable);
router.get(
  '/table/:tableId',
  protect,
  authorize('manager', 'superadmin', 'waiter', 'cashier', 'cook', 'client'),
  getTableOrders
);

router.get('/:id', optionalAuth, getOrderById);
router.post('/:id/request-bill', optionalAuth, requestBill);

router.put(
  '/:id/confirm',
  protect,
  authorize('manager', 'superadmin', 'waiter', 'cook'),
  confirmOrder
);
router.put('/:id/claim', protect, authorize('manager', 'superadmin', 'waiter'), claimOrder);
router.put(
  '/:id/status',
  protect,
  authorize('manager', 'superadmin', 'waiter', 'cook'),
  updateOrderStatus
);
router.patch(
  '/:id/items/:itemId/status',
  protect,
  authorize('manager', 'superadmin', 'waiter', 'cook'),
  updateOrderItemStatus
);
router.put(
  '/:id/cancel',
  protect,
  authorize('manager', 'superadmin', 'waiter', 'client'),
  cancelOrder
);

module.exports = router;
