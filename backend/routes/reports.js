const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middlewares/auth');
const {
  getDashboardStats,
  getDailyReport,
  getWeeklyReport,
  getMonthlyReport,
  getTopItems,
  getPeakHours,
  getPeakDays,
  getForecast,
} = require('../controllers/reportsController');
const { exportOrdersPDF } = require('../controllers/exportController');
const { getAiReport, exportAiReportPdf } = require('../controllers/aiReportController');
router.get(
  '/dashboard',
  protect,
  authorize('manager', 'superadmin'),
  getDashboardStats
);
router.get(
  '/daily',
  protect,
  authorize('manager', 'superadmin'),
  getDailyReport
);
router.get(
  '/weekly',
  protect,
  authorize('manager', 'superadmin'),
  getWeeklyReport
);
router.get(
  '/monthly',
  protect,
  authorize('manager', 'superadmin'),
  getMonthlyReport
);
router.get(
  '/top-items',
  protect,
  authorize('manager', 'superadmin'),
  getTopItems
);
router.get(
  '/peak-hours',
  protect,
  authorize('manager', 'superadmin'),
  getPeakHours
);
router.get(
  '/peak-days',
  protect,
  authorize('manager', 'superadmin'),
  getPeakDays
);
router.get(
  '/forecast',
  protect,
  authorize('manager', 'superadmin'),
  getForecast
);
router.get(
  '/export/pdf',
  protect,
  authorize('manager', 'superadmin'),
  exportOrdersPDF
);
router.get(
  '/ai-report',
  protect,
  authorize('manager', 'superadmin'),
  getAiReport
);
router.get(
  '/ai-report/pdf',
  protect,
  authorize('manager', 'superadmin'),
  exportAiReportPdf
);
module.exports = router;
