// src/server.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { Server } = require('socket.io');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const shopifyRoutes = require('./routes/shopify');
const dashboardRoutes = require('./routes/dashboard');
const ordersRoutes = require('./routes/orders');
const productsRoutes = require('./routes/products');
const analyticsRoutes = require('./routes/analytics');
const webhookRoutes = require('./routes/webhooks');
const alertsRoutes = require('./routes/alerts');

const { authenticateToken } = require('./middleware/auth');
const { setupSocketHandlers } = require('./socket/handlers');

const app = express();
const server = http.createServer(app);

// Socket.io setup
const io = new Server(server, {
  cors: {
    origin: true || 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Make io available globally
app.set('io', io);

// Middleware
app.use(helmet());
app.use(cors({
  origin: true || 'http://localhost:5173',
  credentials: true,
}));
app.use(morgan('combined'));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/api/', limiter);

// Webhooks need raw body
app.use('/webhooks', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});

// Public routes
app.use('/auth', authRoutes);
app.use('/webhooks', webhookRoutes);

// Shopify OAuth (partially public)
app.use('/auth/shopify', shopifyRoutes);

// Protected API routes
app.use('/api/dashboard', authenticateToken, dashboardRoutes);
app.use('/api/orders', authenticateToken, ordersRoutes);
app.use('/api/products', authenticateToken, productsRoutes);
app.use('/api/analytics', authenticateToken, analyticsRoutes);
app.use('/api/alerts', authenticateToken, alertsRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
  });
});

// Socket.io handlers
setupSocketHandlers(io);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 DropFlow API running on port ${PORT}`);
  console.log(`📡 Socket.io ready`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV}`);
});

module.exports = { app, server, io };
