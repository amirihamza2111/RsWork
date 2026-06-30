const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middlewares/auth');
const {
  createTable,
  getTables,
  updateTable,
  deleteTable,
  regenerateAllQRCodes,
  getTableByQR,
  releaseTableSession,
} = require('../controllers/tableController');
router.post('/', protect, authorize('manager'), createTable);
router.get('/', protect, getTables);
router.post('/regenerate-all-qr', protect, authorize('manager', 'superadmin'), regenerateAllQRCodes);
router.post('/:id/release', releaseTableSession);
router.put('/:id', protect, authorize('manager'), updateTable);
router.delete('/:id', protect, authorize('manager'), deleteTable);
router.get('/qr/:id', getTableByQR);
module.exports = router;