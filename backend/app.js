const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const config = require('./config');
const { apiLimiter } = require('./middlewares/rateLimiters');
const errorHandler = require('./middlewares/errorHandler');

const app = express();
app.set('trust proxy', 1);
app.use(helmet());

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

app.use(apiLimiter);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

app.get('/health', (req, res) => {
  res.status(200).json({ success: true, message: 'Server is running' });
});

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
  });
});

app.use(errorHandler);

module.exports = app;
