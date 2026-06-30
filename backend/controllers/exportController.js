const mongoose = require('mongoose');
const PDFDocument = require('pdfkit');
const Order = require('../models/Order');
const Restaurant = require('../models/Restaurant');
const getRestaurantObjectId = (req) => {
  const r = req.user?.restaurant;
  if (!r) return null;
  return r instanceof mongoose.Types.ObjectId ? r : new mongoose.Types.ObjectId(r);
};
const parseRange = (startDate, endDate) => {
  const now = new Date();
  let start;
  let end;
  if (!startDate && !endDate) {
    end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    start = new Date(end);
    start.setDate(start.getDate() - 30);
    start.setHours(0, 0, 0, 0);
  } else if (startDate && !endDate) {
    start = new Date(startDate);
    if (Number.isNaN(start.getTime())) return null;
    start.setHours(0, 0, 0, 0);
    end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  } else if (!startDate && endDate) {
    end = new Date(endDate);
    if (Number.isNaN(end.getTime())) return null;
    end.setHours(23, 59, 59, 999);
    start = new Date(end);
    start.setDate(start.getDate() - 30);
    start.setHours(0, 0, 0, 0);
  } else {
    start = new Date(startDate);
    end = new Date(endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
  }
  if (start > end) return null;
  return { start, end };
};
const fetchOrdersForExport = async (restaurantId, start, end) => {
  return Order.find({
    restaurant: restaurantId,
    createdAt: { $gte: start, $lte: end },
  })
    .populate('restaurant', 'name')
    .populate('table', 'number')
    .sort({ createdAt: 1 })
    .lean();
};
const formatDateTime = (d) => {
  if (!d) return '';
  return new Date(d).toLocaleString();
};

const DEFAULT_REPORT_RESTAURANT_NAME = 'Layali Carthage';

const toPdfSafeText = (value) => {
  return String(value || '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const resolveRestaurantNameForPdf = (rawName) => {
  const safeName = toPdfSafeText(rawName);
  return safeName || DEFAULT_REPORT_RESTAURANT_NAME;
};

exports.exportOrdersPDF = async (req, res) => {
  try {
    const restaurantId = getRestaurantObjectId(req);
    if (!restaurantId) {
      return res.status(403).json({
        success: false,
        message: 'Restaurant context is required',
      });
    }
    const range = parseRange(req.query.startDate, req.query.endDate);
    if (!range) {
      return res.status(400).json({
        success: false,
        message:
          'Invalid date range. Use startDate and/or endDate; start must be on or before end.',
      });
    }
    const orders = await fetchOrdersForExport(restaurantId, range.start, range.end);
    let restaurantName = '';
    if (orders.length > 0 && orders[0].restaurant?.name) {
      restaurantName = orders[0].restaurant.name;
    } else {
      const r = await Restaurant.findById(restaurantId).select('name').lean();
      if (r?.name) restaurantName = r.name;
    }
    const safeRestaurantName = resolveRestaurantNameForPdf(restaurantName);
    const subtitle = `${range.start.toLocaleDateString()} — ${range.end.toLocaleDateString()}`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=orders.pdf');
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    doc.pipe(res);
    doc.font('Helvetica-Bold').fontSize(20).text('Orders Export Report', { align: 'center' });
    doc.moveDown(0.35);
    doc.font('Helvetica').fontSize(12).text(`Restaurant: ${safeRestaurantName}`, { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(11).text(subtitle, { align: 'center' });
    doc.moveDown(1.5);
    const colX = [50, 160, 240, 320, 400];
    const headers = ['Order #', 'Table', 'Total', 'Status', 'Created'];
    let y = doc.y;
    doc.fontSize(10).font('Helvetica-Bold');
    headers.forEach((h, i) => {
      doc.text(h, colX[i], y, { width: i < headers.length - 1 ? colX[i + 1] - colX[i] - 5 : 150 });
    });
    y += 18;
    doc.font('Helvetica');
    orders.forEach((order) => {
      if (y > 720) {
        doc.addPage();
        y = 50;
      }
      const tableNum =
        order.table && typeof order.table === 'object' && order.table.number != null
          ? String(order.table.number)
          : '—';
      const row = [
        order.orderNumber || '—',
        tableNum,
        order.totalAmount != null ? String(order.totalAmount) : '—',
        order.status || '—',
        formatDateTime(order.createdAt),
      ];
      row.forEach((cell, i) => {
        doc.text(cell, colX[i], y, {
          width: i < row.length - 1 ? colX[i + 1] - colX[i] - 5 : 150,
        });
      });
      y += 16;
    });
    if (orders.length === 0) {
      doc.fontSize(10).text('No orders in this date range.', 50, y);
    }
    doc.end();
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: error.message,
      });
    }
  }
};
