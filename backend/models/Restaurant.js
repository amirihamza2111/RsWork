const mongoose = require('mongoose');
const restaurantSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ['restaurant', 'cafe', 'fastfood', 'hotel', 'bar'],
      default: 'restaurant',
    },
    address: {
      type: String,
    },
    phone: {
      type: String,
    },
    logo: {
      type: String,
      validate: {
        validator: function (v) {
          return !v || /^https?:\/\/.+/.test(v);
        },
        message: 'Logo must be a valid URL',
      },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    settings: {
      currency: {
        type: String,
      },
      language: {
        type: String,
        enum: ['ar', 'fr', 'en'],
      },
      timezone: {
        type: String,
      },
    },
  },
  { timestamps: true }
);
module.exports = mongoose.model('Restaurant', restaurantSchema);