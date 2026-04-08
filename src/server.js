require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const migrate = require('./db/migrate');
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
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
const io = new Server(server, { cors: { origin: '*' } });
app.set('io', io);
app.get('/health', (req, res) => res.json({ status: 'ok', version: '1.0.0' }));
app.use('/auth', authRoutes);
app.use('/webhooks', webhookRoutes);
app.use('/auth/shopify', shopifyRoutes);
app.use('/api/dashboard', authenticateToken, dashboardRoutes);
app.use('/api/orders', authenticateToken, ordersRoutes);
app.use('/api/products', authenticateToken, productsRoutes);
app.use('/api/analytics', authenticateToken, analyticsRoutes);
app.use('/api/alerts', authenticateToken, alertsRoutes);
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
setupSocketHandlers(io);
const PORT = process.env.PORT || 3001;
migrate()
  .then(() => {
    server.listen(PORT, () => console.log('Server running on port ' + PORT));
  })
  .catch((err) => {
    console.error('❌ Failed to run migrations, server will not start:', err);
    process.exit(1);
  });
module.exports = { app, server, io };
