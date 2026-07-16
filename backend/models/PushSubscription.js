const mongoose = require('mongoose');

const schema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    restaurant: { type: mongoose.Schema.Types.ObjectId, ref: 'Restaurant', required: true },
    endpoint: { type: String, required: true },
    subscription: { type: Object, required: true },
  },
  { timestamps: true }
);

schema.index({ user: 1 });
schema.index({ restaurant: 1 });
schema.index({ endpoint: 1 }, { unique: true });

module.exports = mongoose.model('PushSubscription', schema);
