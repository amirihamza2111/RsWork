const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middlewares/auth');
const {
    getPayments,
    initiateCashPayment,
    initiateCardPayment,
    confirmCardPayment,
    confirmCashPayment,
    getPaymentByOrder,
    exportPaymentReceiptPdf,
} = require('../controllers/paymentController');
router.get('/', protect, authorize('cashier', 'manager', 'superadmin'), getPayments);
router.post('/cash', protect, authorize('cashier', 'manager', 'superadmin'), initiateCashPayment);
router.post('/card', protect, authorize('cashier', 'manager', 'superadmin'), initiateCardPayment);
router.post('/card/confirm', protect, authorize('cashier', 'manager', 'superadmin'), confirmCardPayment);
router.post('/cash/confirm', protect, authorize('cashier', 'manager'), confirmCashPayment);
router.get('/order/:orderId/receipt/pdf', protect, authorize('cashier', 'manager', 'superadmin'), exportPaymentReceiptPdf);
router.get('/order/:orderId', protect, authorize('cashier', 'manager', 'superadmin'), getPaymentByOrder);
module.exports = router;