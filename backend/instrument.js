// Sentry must be initialized before any other module is required so it can
// auto-instrument Express, HTTP, etc. server.js requires this file first.
// No-ops entirely when SENTRY_DSN is unset (local dev stays quiet).
const Sentry = require('@sentry/node');
const config = require('./config');

const enabled = Boolean(process.env.SENTRY_DSN);

if (enabled) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: config.nodeEnv,
    // Full tracing in dev, light sampling in prod to control volume/cost.
    tracesSampleRate: config.isProd ? 0.1 : 1.0,
    sendDefaultPii: false,
  });
}

module.exports = { Sentry, enabled };
