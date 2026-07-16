const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const config = require('../config');
const sectionService = require('../services/sectionService');

const isAllowedOrigin = (origin) => {
  if (!origin) return true;
  if (config.cors.origins.includes(origin)) return true;
  if (config.cors.allowVercelPreviews && origin.endsWith('.vercel.app')) return true;
  return false;
};

let io;
const initSocket = (server) => {
  io = socketIo(server, {
    cors: {
      origin: (origin, callback) => {
        if (isAllowedOrigin(origin)) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by Socket.IO CORS'));
        }
      },
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) {
        socket.user = null;
        return next();
      }

      const decoded = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] });
      const user = await User.findById(decoded.id);

      socket.user = user || null;
      return next();
    } catch (error) {
      socket.user = null;
      return next();
    }
  });

  io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // A waiter coming online / going offline triggers a (debounced) section
    // rebalance so tables are always spread across the connected waiters.
    const isWaiter = socket.user?.role === 'waiter' && socket.user?.restaurant;
    if (socket.user?.role === 'waiter') {
      socket.join(`waiter_${socket.user._id}`);
      console.log(`Socket ${socket.id} joined personal waiter room: waiter_${socket.user._id}`);
    }
    if (isWaiter) {
      sectionService.waiterConnected(socket.user.restaurant, socket.user._id);
    }
    socket.on('joinRestaurant', (restaurantId) => {
      socket.join(`restaurant_${restaurantId}`);
      console.log(`Socket ${socket.id} joined restaurant room: restaurant_${restaurantId}`);
    });
    socket.on('joinTable', (tableId) => {
      socket.join(`table_${tableId}`);
      console.log(`Socket ${socket.id} joined table room: table_${tableId}`);
    });
    socket.on('disconnect', () => {
      if (isWaiter) {
        sectionService.waiterDisconnected(socket.user.restaurant, socket.user._id);
      }
      console.log(`Socket disconnected: ${socket.id}`);
    });
  });
  return io;
};
module.exports = {
  initSocket,
  getIO: () => io,
};