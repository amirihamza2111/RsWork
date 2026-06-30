const mongoose = require('mongoose');
const Counter = require('./Counter');
const orderSchema = new mongoose.Schema(
  {
    orderNumber: {
      type: String,
      unique: true,
    },
    restaurant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Restaurant',
      required: true,
    },
    table: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Table',
      required: true,
    },
    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    waiter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    items: [
      {
        menuItem: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'MenuItem',
          required: true,
        },
        quantity: {
          type: Number,
          required: true,
        },
        price: {
          type: Number,
          required: true,
        },
        options: {
          type: String,
        },
        comment: {
          type: String,
        },
        // Per-item lifecycle so the KDS Kanban can track each dish individually.
        status: {
          type: String,
          enum: ['queued', 'preparing', 'ready', 'served'],
          default: 'queued',
        },
        // Snapshot of where the item is prepared, so the KDS can route without
        // re-reading the menu item (and stays correct if the menu later changes).
        prepStation: {
          type: String,
          enum: ['kitchen', 'bar'],
          default: 'kitchen',
        },
      },
    ],
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'preparing', 'ready', 'served', 'cancelled'],
      default: 'pending',
    },
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'paid', 'partial'],
      default: 'unpaid',
    },
    paymentMethod: {
      type: String,
      enum: ['cash', 'card', 'mobile'],
      default: 'cash',
    },
    totalAmount: {
      type: Number,
    },
    notes: {
      type: String,
    },
  },
  { timestamps: true }
);
orderSchema.pre('save', async function () {
  if (this.orderNumber) return;
  const now = new Date();
  const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
    now.getDate()
  ).padStart(2, '0')}`;
  const seq = await Counter.next(`ORD-${this.restaurant}-${ymd}`);
  this.orderNumber = `ORD-${ymd}-${String(seq).padStart(4, '0')}`;
});

orderSchema.index({ restaurant: 1, createdAt: -1 });
orderSchema.index({ restaurant: 1, status: 1 });
orderSchema.index({ table: 1, status: 1 });
orderSchema.index({ client: 1, createdAt: -1 });
orderSchema.index({ waiter: 1, status: 1 });

module.exports = mongoose.model('Order', orderSchema);