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