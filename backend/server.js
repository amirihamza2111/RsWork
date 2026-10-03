require('./instrument'); // must be first — initializes Sentry before app loads
const config = require('./config');
const http = require('http');
const app = require('./app');
const { sql, connectDB } = require('./config/db');
const { flush: flushRealtime } = require('./realtime');

const server = http.createServer(app);

const start = async () => {
  await connectDB();
  // Listen on 0.0.0.0 to accept connections from LAN devices
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`Server running on port ${config.port} [${config.nodeEnv}]`);
  });
};

start();

// Graceful shutdown: stop accepting connections, deliver pending realtime
// messages, then close the Postgres pool.
const shutdown = (signal) => {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  server.close(() => {
    flushRealtime()
      .then(() => sql.end({ timeout: 5 }))
      .finally(() => {
        console.log('Closed remaining connections.');
        process.exit(0);
      });
  });

  // Force-exit if cleanup hangs.
  setTimeout(() => process.exit(1), 10000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});
