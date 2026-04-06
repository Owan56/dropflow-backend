// src/socket/handlers.js
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');

function setupSocketHandlers(io) {
  // Auth middleware for socket connections
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    
    if (!token) {
      return next(new Error('Authentication required'));
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const result = await pool.query(
        'SELECT id, email, full_name FROM users WHERE id = $1',
        [decoded.userId]
      );

      if (result.rows.length === 0) {
        return next(new Error('User not found'));
      }

      socket.user = result.rows[0];
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', async (socket) => {
    const userId = socket.user.id;
    console.log(`🔌 Socket connected: user ${userId}`);

    // Join user room
    socket.join(`user_${userId}`);

    // Fetch user's stores and join store rooms
    try {
      const storeResult = await pool.query(
        'SELECT id FROM shopify_stores WHERE user_id = $1 AND is_active = TRUE',
        [userId]
      );
      for (const store of storeResult.rows) {
        socket.join(`store_${store.id}`);
      }
    } catch (err) {
      console.error('Socket store join error:', err.message);
    }

    // Handle dashboard subscription
    socket.on('subscribe_dashboard', () => {
      socket.join(`dashboard_${userId}`);
      socket.emit('subscribed', { channel: 'dashboard' });
    });

    // Handle ping/pong for connection health
    socket.on('ping', () => {
      socket.emit('pong', { timestamp: Date.now() });
    });

    socket.on('disconnect', () => {
      console.log(`🔌 Socket disconnected: user ${userId}`);
    });
  });

  // Utility: emit to specific user
  io.emitToUser = (userId, event, data) => {
    io.to(`user_${userId}`).emit(event, data);
  };

  return io;
}

module.exports = { setupSocketHandlers };
