const mongoose = require('mongoose');
const categorySchema = new mongoose.Schema(
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
    order: {
      type: Number,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

categorySchema.index({ restaurant: 1, order: 1 });

module.exports = mongoose.model('Category', categorySchema);