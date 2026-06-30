const config = require('../config');
// Initialize Stripe only when configured, so the app can boot cash-first
// without a Stripe key. Card endpoints fail gracefully if it's missing.
const stripe = config.stripe.secretKey ? require('stripe')(config.stripe.secretKey) : null;
const PDFDocument = require('pdfkit');
const Order = require('../models/Order');
const Payment = require('../models/Payment');
const { getIO } = require('../sockets/index');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { ok } = require('../utils/apiResponse');
const { toId, getRestaurantScope: scopeOf } = require('../utils/scope');

const getRestaurantScope = (req) => scopeOf(req.user);

const isOrderAccessible = (req, order) => {
    const scope = getRestaurantScope(req);
    if (!scope) return true;
    return scope === toId(order?.restaurant);
};

const RECEIPT_RESTAURANT = {
    name: 'Layali Carthage',
    address: 'Rue Zouhour Beni Khalled',
    phone: '+216 76 77 77 77',
};

const formatCurrencyTnd = (value) => {
    const amount = Number(value || 0);
    return `${amount.toFixed(2)} TND`;
};

const formatReceiptDateTime = (value) => {
    const date = value ? new Date(value) : new Date();
    return date.toLocaleString('fr-TN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
};

const getReceiptItemName = (item) => {
    if (!item) return 'Item';
    if (typeof item.name === 'string' && item.name.trim()) return item.name.trim();

    const menuItem = item.menuItem;
    if (menuItem && typeof menuItem === 'object') {
        if (typeof menuItem.name === 'string' && menuItem.name.trim()) {
            return menuItem.name.trim();
        }

        if (menuItem.name && typeof menuItem.name === 'object') {
            return (
                menuItem.name.fr
                || menuItem.name.en
                || menuItem.name.ar
                || 'Item'
            );
        }
    }

    return 'Item';
};

const normalizeReceiptItems = (order) => {
    const items = Array.isArray(order?.items) ? order.items : [];
    return items.map((item) => {
        const quantity = Number(item?.quantity || 1);
        const unitPrice = Number(item?.price || 0);
        return {
            name: getReceiptItemName(item),
            quantity,
            unitPrice,
            lineTotal: quantity * unitPrice,
        };
    });
};

const estimateReceiptHeight = (items) => {
    const baseHeight = 260;
    const estimatedNameLines = items.reduce((sum, item) => {
        const name = String(item?.name || '');
        const wrappedLines = Math.max(1, Math.ceil(name.length / 22));
        return sum + wrappedLines;
    }, 0);

    return Math.max(360, baseHeight + estimatedNameLines * 14 + items.length * 6);
};

const sanitizeTicketSegment = (value) => {
    return String(value || 'receipt').replace(/[^a-z0-9-_]/gi, '_');
};

exports.getPayments = asyncHandler(async (req, res) => {
    const { status, method, startDate, endDate } = req.query;
    const restaurantId = getRestaurantScope(req);

    if (!restaurantId && req.user?.role !== 'superadmin') {
        throw ApiError.forbidden('Restaurant context is required');
    }

    const filter = restaurantId ? { restaurant: restaurantId } : {};
    if (status) filter.status = status;
    if (method) filter.method = method;
    if (startDate || endDate) {
        filter.createdAt = {};
        if (startDate) filter.createdAt.$gte = new Date(startDate);
        if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    const payments = await Payment.find(filter)
        .select('-stripeClientSecret')
        .populate('order')
        .sort({ createdAt: -1 });

    return ok(res, { count: payments.length, payments });
});

exports.initiateCashPayment = asyncHandler(async (req, res) => {
    const { orderId } = req.body;
    const order = await Order.findById(orderId).populate('table');
    if (!order) throw ApiError.notFound('Order not found');
    if (!isOrderAccessible(req, order)) throw ApiError.forbidden();

    const payment = await Payment.create({
        order: order._id,
        restaurant: order.restaurant,
        amount: order.totalAmount,
        method: 'cash',
        status: 'pending',
    });
    order.paymentStatus = 'unpaid';
    order.paymentMethod = 'cash';
    await order.save();

    getIO()?.to(`restaurant_${toId(order.restaurant)}`).emit('cashPaymentRequested', {
        order,
        table: order.table,
    });

    return ok(res, { payment }, 'Cash payment requested');
});

exports.initiateCardPayment = asyncHandler(async (req, res) => {
    if (!stripe) throw ApiError.badRequest('Card payments are not configured');
    const { orderId } = req.body;
    const order = await Order.findById(orderId);
    if (!order) throw ApiError.notFound('Order not found');
    if (!isOrderAccessible(req, order)) throw ApiError.forbidden();

    const amountInCents = Math.round(order.totalAmount * 100);
    const paymentIntent = await stripe.paymentIntents.create({
        amount: amountInCents,
        currency: config.stripe.currency,
        automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
        metadata: { orderId: order._id.toString() },
    });

    const payment = await Payment.create({
        order: order._id,
        restaurant: order.restaurant,
        amount: order.totalAmount,
        method: 'card',
        status: 'pending',
        stripePaymentIntentId: paymentIntent.id,
        stripeClientSecret: paymentIntent.client_secret,
    });

    return ok(res, { clientSecret: payment.stripeClientSecret, paymentId: payment._id });
});

exports.confirmCardPayment = asyncHandler(async (req, res) => {
    if (!stripe) throw ApiError.badRequest('Card payments are not configured');
    const { paymentIntentId } = req.body;
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (paymentIntent.status !== 'succeeded') {
        throw ApiError.badRequest('Payment not successful yet');
    }

    const restaurantScope = getRestaurantScope(req);
    const paymentFilter = restaurantScope
        ? { stripePaymentIntentId: paymentIntentId, restaurant: restaurantScope }
        : { stripePaymentIntentId: paymentIntentId };

    const payment = await Payment.findOne(paymentFilter);
    if (!payment) throw ApiError.notFound('Payment record not found');

    payment.status = 'completed';
    payment.paidAt = Date.now();
    await payment.save();

    const order = await Order.findById(payment.order);
    if (order) {
        order.paymentStatus = 'paid';
        order.paymentMethod = 'card';
        await order.save();
        getIO()?.to(`restaurant_${toId(order.restaurant)}`).emit('paymentCompleted', { order, payment });
    }

    return ok(res, { payment: { ...payment.toObject(), stripeClientSecret: undefined } }, 'Payment completed');
});

exports.confirmCashPayment = asyncHandler(async (req, res) => {
    const { paymentId } = req.body;
    const restaurantScope = getRestaurantScope(req);
    const paymentFilter = restaurantScope
        ? { _id: paymentId, restaurant: restaurantScope }
        : { _id: paymentId };

    const payment = await Payment.findOne(paymentFilter);
    if (!payment) throw ApiError.notFound('Payment not found');

    payment.status = 'completed';
    payment.paidAt = Date.now();
    await payment.save();

    const order = await Order.findById(payment.order);
    if (order) {
        order.paymentStatus = 'paid';
        await order.save();
        getIO()?.to(`restaurant_${toId(order.restaurant)}`).emit('paymentCompleted', { order, payment });
    }

    return ok(res, { payment: { ...payment.toObject(), stripeClientSecret: undefined } }, 'Payment completed');
});

exports.getPaymentByOrder = asyncHandler(async (req, res) => {
    const restaurantScope = getRestaurantScope(req);
    const paymentFilter = restaurantScope
        ? { order: req.params.orderId, restaurant: restaurantScope }
        : { order: req.params.orderId };

    const payment = await Payment.findOne(paymentFilter).select('-stripeClientSecret');
    if (!payment) throw ApiError.notFound('Payment not found for this order');
    return ok(res, { payment });
});

exports.exportPaymentReceiptPdf = async (req, res) => {
    try {
        const { orderId } = req.params;

        const order = await Order.findById(orderId)
            .populate('table', 'number')
            .populate('items.menuItem');

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        if (!isOrderAccessible(req, order)) {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }

        const orderPaymentStatus = String(order.paymentStatus || '').toLowerCase();
        const restaurantScope = getRestaurantScope(req);
        const completedPaymentFilter = restaurantScope
            ? { order: order._id, restaurant: restaurantScope, status: 'completed' }
            : { order: order._id, status: 'completed' };

        const completedPayment = await Payment.findOne(completedPaymentFilter)
            .select('_id')
            .lean();

        const canExportReceipt = orderPaymentStatus === 'paid' || Boolean(completedPayment);

        if (!canExportReceipt) {
            return res.status(400).json({
                success: false,
                message: 'Receipt is available only for paid orders',
            });
        }

        if (orderPaymentStatus !== 'paid' && completedPayment) {
            order.paymentStatus = 'paid';
            await order.save();
        }

        const thermalWidth = 226.77; // ~80mm in points
        const margin = 14;
        const contentWidth = thermalWidth - margin * 2;

        const ticketNumber = order.orderNumber || String(order._id).slice(-8).toUpperCase();
        const tableNumber = order?.table?.number ?? '-';
        const printedAt = formatReceiptDateTime(new Date());

        const items = normalizeReceiptItems(order);
        const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
        const taxAmount = 0;
        const totalAmount = Number(order.totalAmount ?? subtotal + taxAmount);

        const pageHeight = estimateReceiptHeight(items);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader(
            'Content-Disposition',
            `attachment; filename=facture-${sanitizeTicketSegment(ticketNumber)}.pdf`
        );

        const doc = new PDFDocument({
            size: [thermalWidth, pageHeight],
            margin,
        });

        doc.pipe(res);

        let y = margin;
        const right = thermalWidth - margin;

        const drawDivider = () => {
            doc
                .moveTo(margin, y)
                .lineTo(right, y)
                .lineWidth(0.5)
                .strokeColor('#444444')
                .stroke();
            y += 7;
        };

        doc.font('Helvetica-Bold').fontSize(13).text(RECEIPT_RESTAURANT.name, margin, y, {
            width: contentWidth,
            align: 'center',
        });
        y += 16;

        doc.font('Helvetica').fontSize(8.5).text(RECEIPT_RESTAURANT.address, margin, y, {
            width: contentWidth,
            align: 'center',
        });
        y += 11;

        doc.font('Helvetica').fontSize(8.5).text(RECEIPT_RESTAURANT.phone, margin, y, {
            width: contentWidth,
            align: 'center',
        });
        y += 13;

        drawDivider();

        doc.font('Helvetica').fontSize(8.8).text(`Table: ${tableNumber}`, margin, y);
        y += 12;
        doc.text(`Ticket: ${ticketNumber}`, margin, y);
        y += 12;
        doc.text(`Date: ${printedAt}`, margin, y);
        y += 12;

        drawDivider();

        const nameWidth = 96;
        const qtyX = margin + nameWidth + 4;
        const qtyWidth = 18;
        const unitX = qtyX + qtyWidth + 4;
        const unitWidth = 34;
        const totalX = unitX + unitWidth + 4;
        const totalWidth = right - totalX;

        doc.font('Helvetica-Bold').fontSize(8.2);
        doc.text('Item', margin, y, { width: nameWidth });
        doc.text('Qty', qtyX, y, { width: qtyWidth, align: 'right' });
        doc.text('PU', unitX, y, { width: unitWidth, align: 'right' });
        doc.text('Total', totalX, y, { width: totalWidth, align: 'right' });
        y += 10;

        doc
            .moveTo(margin, y)
            .lineTo(right, y)
            .lineWidth(0.3)
            .strokeColor('#666666')
            .stroke();
        y += 6;

        doc.font('Helvetica').fontSize(8.5);
        items.forEach((item) => {
            const lineName = String(item.name || 'Item');
            const lineHeight = doc.heightOfString(lineName, { width: nameWidth });

            doc.text(lineName, margin, y, {
                width: nameWidth,
                align: 'left',
            });

            doc.text(String(item.quantity), qtyX, y, {
                width: qtyWidth,
                align: 'right',
            });

            doc.text(formatCurrencyTnd(item.unitPrice), unitX, y, {
                width: unitWidth,
                align: 'right',
            });

            doc.text(formatCurrencyTnd(item.lineTotal), totalX, y, {
                width: totalWidth,
                align: 'right',
            });

            y += Math.max(10, lineHeight) + 4;
        });

        drawDivider();

        doc.font('Helvetica').fontSize(9);
        doc.text('Sous-total', margin, y);
        doc.text(formatCurrencyTnd(subtotal), right, y, { align: 'right' });
        y += 12;

        doc.text('Taxe (0%)', margin, y);
        doc.text(formatCurrencyTnd(taxAmount), right, y, { align: 'right' });
        y += 13;

        doc
            .rect(margin, y - 3, contentWidth, 17)
            .lineWidth(0.8)
            .strokeColor('#222222')
            .stroke();

        doc.font('Helvetica-Bold').fontSize(11);
        doc.text('TOTAL', margin + 4, y + 2);
        doc.text(formatCurrencyTnd(totalAmount), right - 4, y + 2, { align: 'right' });
        y += 22;

        drawDivider();

        doc.font('Helvetica-Bold').fontSize(10).text('Merci pour votre visite', margin, y, {
            width: contentWidth,
            align: 'center',
        });
        y += 12;

        doc.font('Helvetica').fontSize(8.5).text('Heureux de vous servir et de vous revoir', margin, y, {
            width: contentWidth,
            align: 'center',
        });

        doc.end();
    } catch (error) {
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: error.message });
        }
    }
};