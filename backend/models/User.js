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
    isVerified: {
      type: Boolean,
      default: false,
    },
    emailVerificationToken: {
      type: String,
      select: false,
    },
    emailVerificationExpires: {
      type: Date,
      select: false,
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

// Hash a raw token the same way, for lookup (reset + email verification).
userSchema.statics.hashResetToken = function (rawToken) {
  return crypto.createHash('sha256').update(String(rawToken)).digest('hex');
};

// Email verification code: 6-digit OTP (100000-999999). We store its SHA-256
// hash so the DB never carries the code, and keep it valid for 15 minutes.
userSchema.methods.createEmailVerificationToken = function () {
  // crypto.randomInt is uniformly distributed — avoids the modulo bias of
  // parseInt(randomBytes, 16) % 1_000_000.
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  this.emailVerificationToken = crypto.createHash('sha256').update(code).digest('hex');
  this.emailVerificationExpires = Date.now() + 15 * 60 * 1000;
  return code;
};

userSchema.index({ restaurant: 1, role: 1 });

module.exports = mongoose.model('User', userSchema);