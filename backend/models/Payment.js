const mongoose = require('mongoose');
const paymentSchema = new mongoose.Schema(
    {
        order: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Order',
        required: true,
        },
        restaurant: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Restaurant',
        required: true,
        },
        amount: {
        type: Number,
        required: true,
        },
        method: {
        type: String,
        enum: ['cash', 'card'],
        required: true,
        },
        status: {
        type: String,
        enum: ['pending', 'completed', 'failed', 'refunded'],
        default: 'pending',
        },
        stripePaymentIntentId: {
        type: String,
        },
        stripeClientSecret: {
        type: String,
        },
        paidAt: {
        type: Date,
        },
    },
    { timestamps: true }
);

paymentSchema.index({ order: 1 });
paymentSchema.index({ restaurant: 1, createdAt: -1 });
paymentSchema.index({ stripePaymentIntentId: 1 });

module.exports = mongoose.model('Payment', paymentSchema);