const PDFDocument = require('pdfkit');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { ok } = require('../utils/apiResponse');
const reportDataService = require('../services/reportDataService');
const aiReportService = require('../services/aiReportService');
const aiClient = require('../services/aiClient');
const { renderAiReport } = require('../services/reportPdf');

const resolveRestaurantId = (req) => {
  if (req.user.role === 'superadmin') return req.query.restaurantId || req.user.restaurant || null;
  return req.user.restaurant || null;
};

// @desc   AI business-intelligence report as JSON (analytics + narrative)
// @route  GET /api/reports/ai-report
exports.getAiReport = asyncHandler(async (req, res) => {
  const restaurantId = resolveRestaurantId(req);
  if (!restaurantId) throw ApiError.forbidden('Restaurant context is required');

  const analytics = await reportDataService.gather(restaurantId, req.query);
  const narrative = await aiReportService.generateNarrative(analytics);
  return ok(res, { analytics, narrative });
});

// @desc   AI business-intelligence report as a PDF
// @route  GET /api/reports/ai-report/pdf
exports.exportAiReportPdf = asyncHandler(async (req, res) => {
  const restaurantId = resolveRestaurantId(req);
  if (!restaurantId) throw ApiError.forbidden('Restaurant context is required');

  const analytics = await reportDataService.gather(restaurantId, req.query);
  const narrative = await aiReportService.generateNarrative(analytics);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename=bi-report-${analytics.period.start}_${analytics.period.end}.pdf`
  );

  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  doc.pipe(res);
  renderAiReport(doc, { analytics, narrative, modelLabel: `${aiClient.provider()}:${aiClient.model()}` });
  doc.end();
});
