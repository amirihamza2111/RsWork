const mongoose = require('mongoose');

// Precomputed "frequently bought together" pairs for one restaurant.
// One document per antecedent item, holding its top co-ordered items.
const recommendationSchema = new mongoose.Schema(
  {
    restaurant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Restaurant',
      required: true,
    },
    item: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MenuItem',
      required: true,
    },
    recommendations: [
      {
        menuItem: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem' },
        count: { type: Number, default: 0 }, // orders containing both items
        score: { type: Number, default: 0 }, // confidence: count / support(item)
      },
    ],
    generatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

recommendationSchema.index({ restaurant: 1, item: 1 }, { unique: true });

module.exports = mongoose.model('Recommendation', recommendationSchema);
