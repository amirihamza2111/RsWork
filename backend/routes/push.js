const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middlewares/auth');
const { subscribe, unsubscribe, getVapidPublicKey } = require('../controllers/pushController');

// Public endpoint so the frontend can fetch the VAPID public key without hard-coding it.
router.get('/vapid-public-key', getVapidPublicKey);

router.post(
  '/subscribe',
  protect,
  authorize('waiter', 'cook', 'manager', 'superadmin'),
  subscribe
);
router.post(
  '/unsubscribe',
  protect,
  authorize('waiter', 'cook', 'manager', 'superadmin'),
  unsubscribe
);

module.exports = router;
