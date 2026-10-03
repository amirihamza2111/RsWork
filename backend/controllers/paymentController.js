const config = require('../config');
// Initialize Stripe only when configured, so the app can boot cash-first
// without a Stripe key. Card endpoints fail gracefully if it's missing.
const stripe = config.stripe.secretKey ? require('stripe')(config.stripe.secretKey) : null;
const PDFDocument = require('pdfkit');
const orders = require('../db/orders');
const payments = require('../db/payments');
const { toPayment } = require('../db/mappers');
const { getIO } = require('../realtime');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { ok } = require('../utils/apiResponse');
const { toId, requireStaffScope } = require('../utils/scope');
const { parsePagination, meta } = require('../utils/pagination');

// Public diner routes (no user) and superadmins are unscoped; staff are pinned
// to their restaurant.
const getRestaurantScope = (req) => requireStaffScope(req.user);

const isOrderAccessible = (req, order) => {
    const scope = getRestaurantScope(req);
    if (!scope) return true;
    return scope === toId(order?.restaurant);
};

// Fallbacks used only when a restaurant record is missing fields.
const RECEIPT_DEFAULTS = {
    name: 'Restaurant',
    address: '',
    phone: '',
};

const formatCurrency = (value, currency = 'TND') => {
    const amount = Number(value || 0);
    return `${amount.toFixed(2)} ${currency}`;
};

// Plain number (no currency suffix) for the tight per-line columns of an 80mm
// thermal receipt — the currency is shown once, on the TOTAL line.
const formatAmount = (value) => Number(value || 0).toFixed(2);

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

const parseDate = (value) => {
    if (!value) return undefined;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? undefined : d;
};

// Marks the order paid and tells the restaurant's staff screens.
const settleOrder = async (paymentRow, { method } = {}) => {
    await orders.update(paymentRow.orderId, {
        payment_status: 'paid',
        ...(method ? { payment_method: method } : {}),
    });
    const order = await orders.populateById(paymentRow.orderId);
    if (order) {
        getIO()
            .to(`restaurant_${toId(order.restaurant)}`)
            .emit('paymentCompleted', { order, payment: toPayment(paymentRow) });
    }
    return order;
};

// @desc   Public payment config for the diner app. The publishable key is safe
//         to expose; when blank, online card payment is disabled client-side.
// @route  GET /api/payments/config
exports.getPublicConfig = asyncHandler(async (req, res) => {
    return ok(res, {
        cardEnabled: Boolean(stripe && config.stripe.publishableKey),
        publishableKey: config.stripe.publishableKey || null,
        currency: config.stripe.currency,
    });
});

exports.getPayments = asyncHandler(async (req, res) => {
    const { status, method, startDate, endDate } = req.query;
    const restaurantId = getRestaurantScope(req);

    if (!restaurantId && req.user?.role !== 'superadmin') {
        throw ApiError.forbidden('Restaurant context is required');
    }

    const { page, limit, skip } = parsePagination(req.query);
    const { payments: list, total } = await payments.list(
        {
            restaurantId: restaurantId || undefined,
            status: status || undefined,
            method: method || undefined,
            from: parseDate(startDate),
            to: parseDate(endDate),
        },
        { limit, offset: skip }
    );

    return ok(res, { count: list.length, payments: list, ...meta(total, page, limit) });
});

exports.initiateCashPayment = asyncHandler(async (req, res) => {
    const { orderId } = req.body;
    const order = await orders.populateById(orderId);
    if (!order) throw ApiError.notFound('Order not found');
    if (!isOrderAccessible(req, order)) throw ApiError.forbidden();
    if (order.status === 'cancelled') throw ApiError.badRequest('Order is cancelled');
    if (order.paymentStatus === 'paid') throw ApiError.badRequest('Order is already paid');

    // Reuse a pending payment if one already exists for this order (e.g. the
    // diner pre-selected cash at order time) so we don't leave an orphan behind.
    const pending = await payments.findOne({ orderId: order._id, status: 'pending' });
    const payment = pending
        ? await payments.update(pending.id, { method: 'cash', amount: order.totalAmount })
        : await payments.create({
              order: order._id,
              restaurant: toId(order.restaurant),
              amount: order.totalAmount,
              method: 'cash',
              status: 'pending',
          });
    await orders.update(order._id, { payment_status: 'unpaid', payment_method: 'cash' });

    getIO().to(`restaurant_${toId(order.restaurant)}`).emit('cashPaymentRequested', {
        order: { ...order, paymentStatus: 'unpaid', paymentMethod: 'cash' },
        table: order.table,
    });

    return ok(res, { payment: toPayment(payment) }, 'Cash payment requested');
});

exports.initiateCardPayment = asyncHandler(async (req, res) => {
    if (!stripe) throw ApiError.badRequest('Card payments are not configured');
    const { orderId } = req.body;
    const order = await orders.findById(orderId);
    if (!order) throw ApiError.notFound('Order not found');
    if (!isOrderAccessible(req, order)) throw ApiError.forbidden();
    if (order.status === 'cancelled') throw ApiError.badRequest('Order is cancelled');
    if (order.paymentStatus === 'paid') throw ApiError.badRequest('Order is already paid');

    // Reuse the pending card payment when the amount hasn't changed, so repeated
    // taps (or refreshes) don't pile up orphan PaymentIntents.
    const pending = await payments.findOne({ orderId: order._id, method: 'card', status: 'pending' });
    if (pending?.stripeClientSecret && Number(pending.amount) === Number(order.totalAmount)) {
        return ok(res, { clientSecret: pending.stripeClientSecret, paymentId: pending.id });
    }

    const amountInCents = Math.round(order.totalAmount * 100);
    const paymentIntent = await stripe.paymentIntents.create({
        amount: amountInCents,
        currency: config.stripe.currency,
        automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
        metadata: { orderId: String(order._id) },
    });

    const intentFields = {
        amount: order.totalAmount,
        stripePaymentIntentId: paymentIntent.id,
        stripeClientSecret: paymentIntent.client_secret,
    };
    const payment = pending
        ? await payments.update(pending.id, intentFields)
        : await payments.create({
              order: order._id,
              restaurant: toId(order.restaurant),
              method: 'card',
              status: 'pending',
              ...intentFields,
          });

    return ok(res, { clientSecret: payment.stripeClientSecret, paymentId: payment.id });
});

exports.confirmCardPayment = asyncHandler(async (req, res) => {
    if (!stripe) throw ApiError.badRequest('Card payments are not configured');
    const { paymentIntentId } = req.body;
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (paymentIntent.status !== 'succeeded') {
        throw ApiError.badRequest('Payment not successful yet');
    }

    const payment = await payments.findOne({
        stripePaymentIntentId: paymentIntentId,
        restaurantId: getRestaurantScope(req),
    });
    if (!payment) throw ApiError.notFound('Payment record not found');

    // The webhook may have settled it already; only the first settle notifies.
    const completed = await payments.completeOnce(payment.id);
    if (completed) await settleOrder(completed, { method: 'card' });

    const fresh = completed || (await payments.findOne({ id: payment.id }));
    return ok(res, { payment: toPayment(fresh) }, 'Payment completed');
});

exports.confirmCashPayment = asyncHandler(async (req, res) => {
    const { paymentId } = req.body;
    const payment = await payments.findOne({
        id: paymentId,
        restaurantId: getRestaurantScope(req),
    });
    if (!payment) throw ApiError.notFound('Payment not found');

    const completed = await payments.completeOnce(payment.id);
    if (completed) await settleOrder(completed);

    const fresh = completed || (await payments.findOne({ id: payment.id }));
    return ok(res, { payment: toPayment(fresh) }, 'Payment completed');
});

// @desc   Stripe webhook — the reliable, async source of truth for card payments
// @route  POST /api/payments/webhook  (raw body, no auth; verified by signature)
exports.handleStripeWebhook = async (req, res) => {
    if (!stripe) {
        return res.status(503).json({ success: false, message: 'Stripe is not configured' });
    }
    if (!config.stripe.webhookSecret) {
        return res.status(503).json({ success: false, message: 'Webhook secret is not configured' });
    }

    let event;
    try {
        event = stripe.webhooks.constructEvent(
            req.body,
            req.headers['stripe-signature'],
            config.stripe.webhookSecret
        );
    } catch (err) {
        return res.status(400).json({ success: false, message: `Webhook signature failed: ${err.message}` });
    }

    try {
        if (event.type === 'payment_intent.succeeded') {
            const intent = event.data.object;
            const payment = await payments.findOne({ stripePaymentIntentId: intent.id });
            const completed = payment ? await payments.completeOnce(payment.id) : null;
            if (completed) await settleOrder(completed, { method: 'card' });
        } else if (event.type === 'payment_intent.payment_failed') {
            await payments.markFailedByIntent(event.data.object.id);
        }

        return res.status(200).json({ received: true });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
};

exports.getPaymentByOrder = asyncHandler(async (req, res) => {
    const payment = await payments.findOne({
        orderId: req.params.orderId,
        restaurantId: getRestaurantScope(req),
    });
    if (!payment) throw ApiError.notFound('Payment not found for this order');
    return ok(res, { payment: toPayment(payment) });
});

exports.exportPaymentReceiptPdf = async (req, res) => {
    try {
        const { orderId } = req.params;

        const order = await orders.populateById(orderId);

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found' });
        }

        if (!isOrderAccessible(req, order)) {
            return res.status(403).json({ success: false, message: 'Forbidden' });
        }

        const orderPaymentStatus = String(order.paymentStatus || '').toLowerCase();
        const completedPayment = await payments.findOne({
            orderId: order._id,
            restaurantId: getRestaurantScope(req),
            status: 'completed',
        });

        const canExportReceipt = orderPaymentStatus === 'paid' || Boolean(completedPayment);

        if (!canExportReceipt) {
            return res.status(400).json({
                success: false,
                message: 'Receipt is available only for paid orders',
            });
        }

        if (orderPaymentStatus !== 'paid' && completedPayment) {
            await orders.update(order._id, { payment_status: 'paid' });
        }

        const thermalWidth = 226.77; // ~80mm in points
        const margin = 14;
        const contentWidth = thermalWidth - margin * 2;

        const ticketNumber = order.orderNumber || String(order._id).slice(-8).toUpperCase();
        const tableNumber = order?.table?.number ?? '-';
        const printedAt = formatReceiptDateTime(new Date());

        // Restaurant identity + currency come from the order's restaurant record.
        const restaurantInfo =
            order.restaurant && typeof order.restaurant === 'object' ? order.restaurant : null;
        const receiptRestaurant = {
            name: restaurantInfo?.name || RECEIPT_DEFAULTS.name,
            address: restaurantInfo?.address || RECEIPT_DEFAULTS.address,
            phone: restaurantInfo?.phone || RECEIPT_DEFAULTS.phone,
        };
        const currency = restaurantInfo?.settings?.currency || 'TND';
        const formatMoney = (value) => formatCurrency(value, currency);

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

        doc.font('Helvetica-Bold').fontSize(13).text(receiptRestaurant.name, margin, y, {
            width: contentWidth,
            align: 'center',
        });
        y += 16;

        doc.font('Helvetica').fontSize(8.5).text(receiptRestaurant.address, margin, y, {
            width: contentWidth,
            align: 'center',
        });
        y += 11;

        doc.font('Helvetica').fontSize(8.5).text(receiptRestaurant.phone, margin, y, {
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

            doc.text(formatAmount(item.unitPrice), unitX, y, {
                width: unitWidth,
                align: 'right',
            });

            doc.text(formatAmount(item.lineTotal), totalX, y, {
                width: totalWidth,
                align: 'right',
            });

            y += Math.max(10, lineHeight) + 4;
        });

        drawDivider();

        // Right-align amounts across the full content width. Passing the right
        // edge as x with no width makes PDFKit compute a ~0-width box and wrap
        // every character — the cause of the shattered vertical totals.
        doc.font('Helvetica').fontSize(9);
        doc.text('Sous-total', margin, y);
        doc.text(formatMoney(subtotal), margin, y, { width: contentWidth, align: 'right' });
        y += 12;

        doc.text('Taxe (0%)', margin, y);
        doc.text(formatMoney(taxAmount), margin, y, { width: contentWidth, align: 'right' });
        y += 13;

        doc
            .rect(margin, y - 3, contentWidth, 17)
            .lineWidth(0.8)
            .strokeColor('#222222')
            .stroke();

        doc.font('Helvetica-Bold').fontSize(11);
        doc.text('TOTAL', margin + 4, y + 2);
        doc.text(formatMoney(totalAmount), margin + 4, y + 2, {
            width: contentWidth - 8,
            align: 'right',
        });
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