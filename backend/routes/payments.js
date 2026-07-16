const express = require('express');
const router = express.Router();
const { protect, authorize, optionalAuth } = require('../middlewares/auth');
const {
    getPublicConfig,
    getPayments,
    initiateCashPayment,
    initiateCardPayment,
    confirmCardPayment,
    confirmCashPayment,
    getPaymentByOrder,
    exportPaymentReceiptPdf,
} = require('../controllers/paymentController');
// Public: diner app config + online card payment from the table (no account).
// The amount always comes from the order server-side, never from the client.
router.get('/config', getPublicConfig);
router.post('/card/diner', optionalAuth, initiateCardPayment);
router.post('/card/diner/confirm', optionalAuth, confirmCardPayment);
router.get('/', protect, authorize('cashier', 'manager', 'superadmin'), getPayments);
router.post('/cash', protect, authorize('cashier', 'manager', 'superadmin'), initiateCashPayment);
router.post('/card', protect, authorize('cashier', 'manager', 'superadmin'), initiateCardPayment);
router.post('/card/confirm', protect, authorize('cashier', 'manager', 'superadmin'), confirmCardPayment);
router.post('/cash/confirm', protect, authorize('cashier', 'manager'), confirmCashPayment);
router.get('/order/:orderId/receipt/pdf', protect, authorize('cashier', 'manager', 'superadmin'), exportPaymentReceiptPdf);
router.get('/order/:orderId', protect, authorize('cashier', 'manager', 'superadmin'), getPaymentByOrder);
module.exports = router;