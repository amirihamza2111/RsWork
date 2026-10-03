const config = require('../config');
const { sql } = require('../config/db');
const { supabaseAdmin } = require('../config/supabase');
const profiles = require('../db/profiles');
const restaurants = require('../db/restaurants');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { ok, created } = require('../utils/apiResponse');
const { sendEmailSafe } = require('../services/emailService');
const { verificationEmail, passwordResetEmail } = require('../services/emailTemplates');

// Sign-in, sign-out, session refresh, OTP verification and password changes
// happen in the browser through the Supabase Auth client. The API owns the
// flows that need privileged access: creating accounts together with their
// app profile/restaurant, and issuing OTPs / reset links sent via our email
// provider (Supabase's built-in SMTP is heavily rate-limited).

const normalizeEmail = (email) => String(email).trim().toLowerCase();

const resetUrl = (tokenHash) =>
  `${config.clientUrl}/reset-password?token=${encodeURIComponent(tokenHash)}`;

const authFailure = (error, fallback) => {
  if (/already (been )?registered|already exists/i.test(error?.message || '')) {
    return ApiError.badRequest('User already exists');
  }
  if (error?.status && error.status < 500) return ApiError.badRequest(error.message);
  return new ApiError(502, fallback);
};

// Creates an unconfirmed auth user and returns it with its 6-digit email OTP.
const createUnconfirmedUser = async ({ email, password, name }) => {
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: 'signup',
    email,
    password,
    options: { data: { name } },
  });
  if (error) throw authFailure(error, 'Could not create account');
  return { authUser: data.user, otp: data.properties?.email_otp };
};

const deleteAuthUser = (id) => supabaseAdmin.auth.admin.deleteUser(id).catch(() => {});

const sendVerification = (user, otp) =>
  sendEmailSafe({ to: user.email, ...verificationEmail(user.name, otp) });

// @desc   Register a new client account (email must be verified before sign-in)
// @route  POST /api/auth/register
exports.register = asyncHandler(async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) {
    throw ApiError.badRequest('Please provide name, email, and password');
  }

  const normalizedEmail = normalizeEmail(email);
  if (await profiles.emailExists(normalizedEmail)) throw ApiError.badRequest('User already exists');

  // Self-registration always creates a client. Staff accounts are created by a
  // manager/superadmin via /api/staff.
  const { authUser, otp } = await createUnconfirmedUser({ email: normalizedEmail, password, name });
  let user;
  try {
    user = await profiles.create({ id: authUser.id, name, email: normalizedEmail, role: 'client' });
  } catch (err) {
    await deleteAuthUser(authUser.id);
    throw err;
  }

  await sendVerification(user, otp);
  const payload = { user };
  if (!config.isProd) payload.verifyToken = otp; // testable without email
  return created(res, payload, 'Registered — check your email for the verification code');
});

// @desc   Current user
// @route  GET /api/auth/me
exports.getMe = asyncHandler(async (req, res) => {
  const user = await profiles.findById(req.user._id);
  if (!user) throw ApiError.notFound('User not found');
  return ok(res, { user: { ...user, restaurant: req.user.restaurant } });
});

// @desc   Onboard a new restaurant together with its first manager account
// @route  POST /api/auth/register-restaurant
// @access Public
exports.registerRestaurant = asyncHandler(async (req, res) => {
  const {
    restaurantName,
    name,
    email,
    password,
    confirmPassword,
    type,
    address,
    phone,
    currency,
    language,
  } = req.body;

  if (!restaurantName || !name || !email || !password) {
    throw ApiError.badRequest('Please provide restaurantName, name, email, and password');
  }
  // confirmPassword is optional in the body (older clients still work), but if
  // sent it must match — this prevents password typos during onboarding.
  if (confirmPassword !== undefined && confirmPassword !== password) {
    throw ApiError.badRequest('Passwords do not match');
  }

  const normalizedEmail = normalizeEmail(email);
  if (await profiles.emailExists(normalizedEmail)) throw ApiError.badRequest('User already exists');

  const { authUser, otp } = await createUnconfirmedUser({ email: normalizedEmail, password, name });

  let user;
  let restaurant;
  try {
    // Restaurant, manager profile and ownership commit together or not at all.
    [user, restaurant] = await sql.begin(async (tx) => {
      const r = await restaurants.create(
        {
          name: restaurantName,
          type: type || 'restaurant',
          address,
          phone,
          settings: { currency: currency || 'TND', language: language || 'fr' },
        },
        tx
      );
      const u = await profiles.create(
        { id: authUser.id, name, email: normalizedEmail, role: 'manager', restaurantId: r._id },
        tx
      );
      const owned = await restaurants.update(r._id, { ownerId: u._id }, tx);
      return [u, owned];
    });
  } catch (err) {
    // Compensate so we never leave an orphaned auth user behind.
    await deleteAuthUser(authUser.id);
    throw err;
  }

  await sendVerification(user, otp);
  const payload = { user, restaurant };
  if (!config.isProd) payload.verifyToken = otp;
  return created(res, payload, 'Restaurant registered — check your email for the verification code');
});

// @desc   Begin a password reset (emails a one-time reset link)
// @route  POST /api/auth/forgot-password
// @access Public
exports.forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) throw ApiError.badRequest('Please provide email');

  // Always respond the same way so we don't reveal which emails exist.
  const message = 'If that account exists, a reset link has been sent';
  const user = await profiles.findByEmail(email);
  if (!user || !user.isActive) return ok(res, null, message);

  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: 'recovery',
    email: user.email,
  });
  if (error) return ok(res, null, message);

  const tokenHash = data.properties?.hashed_token;
  await sendEmailSafe({ to: user.email, ...passwordResetEmail(user.name, resetUrl(tokenHash)) });

  // Also expose the token in non-production so the flow is testable without email.
  return ok(res, config.isProd ? null : { resetToken: tokenHash }, message);
});

// @desc   Resend the email verification code
// @route  POST /api/auth/resend-verification
// @access Public
exports.resendVerification = asyncHandler(async (req, res) => {
  const { email } = req.body;
  if (!email) throw ApiError.badRequest('Please provide email');

  const message = 'If that account exists and is unverified, a new code has been sent';
  const user = await profiles.findByEmail(email);
  if (!user || user.isVerified) return ok(res, null, message);

  // A magic-link OTP confirms the email when verified, like the signup OTP.
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: 'magiclink',
    email: user.email,
  });
  if (error) return ok(res, null, message);

  const otp = data.properties?.email_otp;
  await sendVerification(user, otp);
  return ok(res, config.isProd ? null : { verifyToken: otp }, message);
});
