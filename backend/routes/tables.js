const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middlewares/auth');
const {
  createTable,
  getTables,
  updateTable,
  deleteTable,
  regenerateAllQRCodes,
  autoAssignTables,
  presenceHeartbeat,
  presenceLeave,
  getTableByQR,
  openTableSession,
  releaseTableSession,
} = require('../controllers/tableController');
router.post('/', protect, authorize('manager'), createTable);
router.get('/', protect, getTables);
router.post('/regenerate-all-qr', protect, authorize('manager', 'superadmin'), regenerateAllQRCodes);
router.post('/auto-assign', protect, authorize('manager', 'superadmin'), autoAssignTables);
router.post('/presence', protect, authorize('waiter'), presenceHeartbeat);
router.delete('/presence', protect, authorize('waiter'), presenceLeave);
router.post('/:id/session', openTableSession);
router.post('/:id/release', releaseTableSession);
router.put('/:id', protect, authorize('manager'), updateTable);
router.delete('/:id', protect, authorize('manager'), deleteTable);
router.get('/qr/:id', getTableByQR);
module.exports = router;