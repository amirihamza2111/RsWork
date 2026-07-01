const mongoose = require('mongoose');
const bcryptjs = require('bcryptjs');
const crypto = require('crypto');
const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
    },
    password: {
      type: String,
      required: true,
      select: false,
    },
    role: {
      type: String,
      enum: ['client', 'waiter', 'cashier', 'cook', 'manager', 'superadmin'],
      default: 'client',
    },
    phone: {
      type: String,
      optional: true,
    },
    restaurant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Restaurant',
      optional: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    resetPasswordToken: {
      type: String,
      select: false,
    },
    resetPasswordExpires: {
      type: Date,
      select: false,
    },
    passwordChangedAt: {
      type: Date,
      select: false,
    },
  },
  { timestamps: true }
);
userSchema.pre('save', async function () {
  if (!this.isModified('password')) {
    return;
  }
  const salt = await bcryptjs.genSalt(10);
  this.password = await bcryptjs.hash(this.password, salt);
  // Backdate 1s so a token issued at the same moment isn't wrongly invalidated.
  this.passwordChangedAt = new Date(Date.now() - 1000);
});
userSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcryptjs.compare(candidatePassword, this.password);
};

// Generates a password-reset token: stores its SHA-256 hash (+1h expiry) on the
// user and returns the raw token to be delivered to the user out-of-band.
userSchema.methods.createPasswordResetToken = function () {
  const rawToken = crypto.randomBytes(32).toString('hex');
  this.resetPasswordToken = crypto.createHash('sha256').update(rawToken).digest('hex');
  this.resetPasswordExpires = Date.now() + 60 * 60 * 1000;
  return rawToken;
};

// Hash a raw reset token the same way, for lookup.
userSchema.statics.hashResetToken = function (rawToken) {
  return crypto.createHash('sha256').update(String(rawToken)).digest('hex');
};

userSchema.index({ restaurant: 1, role: 1 });

module.exports = mongoose.model('User', userSchema);