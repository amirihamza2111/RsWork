const mongoose = require('mongoose');
const tableSchema = new mongoose.Schema(
  {
    number: {
      type: Number,
      required: true,
    },
    restaurant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Restaurant',
      required: true,
    },
    capacity: {
      type: Number,
      default: 4,
    },
    status: {
      type: String,
      enum: ['available', 'occupied', 'reserved'],
      default: 'available',
    },
    // Section assignment: the waiter responsible for this table. Orders placed
    // here are routed to this waiter (targeted "ready" notification, no spam).
    assignedWaiter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    // Dining session: opened when a diner scans the QR, required on public
    // orders, and cleared when the table is released. A leaked/photographed QR
    // from a previous diner can't order once the session is cleared.
    session: {
      id: { type: String },
      expiresAt: { type: Date },
    },
    qrCode: {
      type: String,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// A table number is unique within a restaurant.
tableSchema.index({ restaurant: 1, number: 1 }, { unique: true });

module.exports = mongoose.model('Table', tableSchema);