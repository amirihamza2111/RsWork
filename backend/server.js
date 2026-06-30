const config = require('./config');
const http = require('http');
const mongoose = require('mongoose');
const app = require('./app');
const connectDB = require('./config/mongodb');
const { initSocket } = require('./sockets/index');

const server = http.createServer(app);

const start = async () => {
  await connectDB();
  initSocket(server);
  server.listen(config.port, () => {
    console.log(`Server running on port ${config.port} [${config.nodeEnv}]`);
  });
};

start();

// Graceful shutdown: stop accepting connections, then close the DB.
const shutdown = (signal) => {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  server.close(() => {
    mongoose.connection.close(false).finally(() => {
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
