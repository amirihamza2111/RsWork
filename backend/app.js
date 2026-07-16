const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const morgan = require('morgan');
const config = require('./config');
const { apiLimiter } = require('./middlewares/rateLimiters');
const errorHandler = require('./middlewares/errorHandler');
const { sanitizeRequest } = require('./middlewares/sanitize');

const app = express();
app.set('trust proxy', 1);
// The 'simple' query parser does not build nested objects from bracket
// notation, which neutralises `?key[$ne]=...` NoSQL operator injection.
app.set('query parser', 'simple');
app.use(helmet());
// Gzip/deflate response bodies — the trilingual menu JSON shrinks ~5-10x.
app.use(compression());

const isAllowedOrigin = (origin) => {
  // Allow non-browser clients (no Origin header) such as curl / mobile apps.
  if (!origin) return true;
  if (config.cors.origins.includes(origin)) return true;
  if (config.cors.allowVercelPreviews && origin.endsWith('.vercel.app')) return true;
  return false;
};

app.use(
  cors({
    origin(origin, callback) {
      if (isAllowedOrigin(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  })
);

if (!config.isProd) {
  app.use(morgan('dev'));
}

// Stripe webhook needs the raw body for signature verification, and is mounted
// before the JSON parser AND the rate limiter (so event bursts aren't dropped).
app.post(
  '/api/payments/webhook',
  express.raw({ type: 'application/json' }),
  require('./controllers/paymentController').handleStripeWebhook
);

app.use(apiLimiter);
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(sanitizeRequest);

app.use('/api/payments', require('./routes/payments'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/restaurants', require('./routes/restaurants'));
app.use('/api/tables', require('./routes/tables'));
app.use('/api/menu', require('./routes/menu'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/staff', require('./routes/staff'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/feedbacks', require('./routes/feedbacks'));
app.use('/api/push', require('./routes/push'));

app.get('/health', (req, res) => {
  res.status(200).json({ success: true, message: 'Server is running' });
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
  });
});

// Sentry's error handler must sit after routes and before our own — it reports
// the error to Sentry, then lets errorHandler shape the client response.
const { Sentry, enabled: sentryEnabled } = require('./instrument');
if (sentryEnabled) {
  Sentry.setupExpressErrorHandler(app);
}

app.use(errorHandler);

module.exports = app;
