const mongoose = require('mongoose');
const menuItemSchema = new mongoose.Schema(
  {
    name: {
      ar: {
        type: String,
        required: true,
      },
      fr: {
        type: String,
        required: true,
      },
      en: {
        type: String,
        required: true,
      },
    },
    description: {
      ar: {
        type: String,
      },
      fr: {
        type: String,
      },
      en: {
        type: String,
      },
    },
    price: {
      type: Number,
      required: true,
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: true,
    },
    restaurant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Restaurant',
      required: true,
    },
    image: {
      type: String,
      validate: {
        validator: function (v) {
          return !v || /^https?:\/\/.+/.test(v);
        },
        message: 'Image must be a valid URL',
      },
    },
    isAvailable: {
      type: Boolean,
      default: true,
    },
    // Routing for the KDS: 'kitchen' items go to the cook, 'bar' items (drinks)
    // are brought by the waiter directly.
    prepStation: {
      type: String,
      enum: ['kitchen', 'bar'],
      default: 'kitchen',
    },
    isVegetarian: {
      type: Boolean,
      default: false,
    },
    isGlutenFree: {
      type: Boolean,
      default: false,
    },
    allergens: [
      {
        type: String,
      },
    ],
    preparationTime: {
      type: Number,
    },
  },
  { timestamps: true }
);

menuItemSchema.index({ restaurant: 1, category: 1 });
menuItemSchema.index({ restaurant: 1, isAvailable: 1 });

module.exports = mongoose.model('MenuItem', menuItemSchema);