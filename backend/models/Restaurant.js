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
    // Geofence: diners can only order when physically near the restaurant.
    // Dormant until a location is set (so it never blocks before it's configured).
    location: {
      lat: { type: Number },
      lng: { type: Number },
    },
    geofenceRadius: {
      type: Number,
      default: 250, // metres
    },
    // Day (YYYY-MM-DD) of the last waiter-section assignment. The first
    // rebalance of a new day does a full shuffle so sections rotate daily.
    sectionsDay: {
      type: String,
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