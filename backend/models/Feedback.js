const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema(
  {
    restaurant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Restaurant',
    },
    table: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Table',
    },
    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    category: {
      type: String,
      default: 'Overall',
    },
    comment: {
      type: String,
      maxLength: 500,
    },
    status: {
      type: String,
      enum: ['new', 'reviewed'],
      default: 'new',
    },
    reviewedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

feedbackSchema.index({ restaurant: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('Feedback', feedbackSchema);
