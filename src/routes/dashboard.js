// src/routes/dashboard.js
const express = require('express');
const pool = require('../db/pool');

const router = express.Router();

// GET /api/dashboard/summary - Main dashboard KPIs
router.get('/summary', async (req, res) => {
  try {
    const storeResult = await pool.query(
      'SELECT id FROM shopify_stores WHERE user_id = $1 AND is_active = TRUE LIMIT 1',
      [req.user.id]
    );

    if (storeResult.rows.length === 0) {
      return res.json({
        revenue: { total: 0, today: 0, week: 0, month: 0, growth: 0 },
        orders: { total: 0, today: 0, pending: 0, fulfilled: 0, growth: 0 },
        products: { total: 0, active: 0, low_stock: 0 },
        customers: { total: 0, new_today: 0 },
        noStore: true,
      });
    }

    const storeId = storeResult.rows[0].id;

    // Revenue stats
    const revenueStats = await pool.query(`
      SELECT
        SUM(total_price) AS total,
        SUM(CASE WHEN DATE(shopify_created_at) = CURRENT_DATE THEN total_price ELSE 0 END) AS today,
        SUM(CASE WHEN shopify_created_at >= NOW() - INTERVAL '7 days' THEN total_price ELSE 0 END) AS week,
        SUM(CASE WHEN shopify_created_at >= NOW() - INTERVAL '30 days' THEN total_price ELSE 0 END) AS month,
        SUM(CASE WHEN shopify_created_at >= NOW() - INTERVAL '60 days' 
              AND shopify_created_at < NOW() - INTERVAL '30 days' THEN total_price ELSE 0 END) AS prev_month
      FROM orders WHERE store_id = $1 AND financial_status = 'paid'
    `, [storeId]);

    // Orders stats
    const orderStats = await pool.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(CASE WHEN DATE(shopify_created_at) = CURRENT_DATE THEN 1 END) AS today,
        COUNT(CASE WHEN fulfillment_status IS NULL OR fulfillment_status = 'unfulfilled' THEN 1 END) AS pending,
        COUNT(CASE WHEN fulfillment_status = 'fulfilled' THEN 1 END) AS fulfilled,
        COUNT(CASE WHEN shopify_created_at >= NOW() - INTERVAL '7 days' THEN 1 END) AS this_week,
        COUNT(CASE WHEN shopify_created_at >= NOW() - INTERVAL '14 days'
              AND shopify_created_at < NOW() - INTERVAL '7 days' THEN 1 END) AS prev_week
      FROM orders WHERE store_id = $1
    `, [storeId]);

    // Products stats
    const productStats = await pool.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(CASE WHEN status = 'active' THEN 1 END) AS active,
        COUNT(CASE WHEN inventory_quantity < 5 AND inventory_quantity >= 0 THEN 1 END) AS low_stock
      FROM products WHERE store_id = $1
    `, [storeId]);

    const rev = revenueStats.rows[0];
    const ord = orderStats.rows[0];
    const prod = productStats.rows[0];

    const revenueGrowth = rev.prev_month > 0
      ? (((rev.month - rev.prev_month) / rev.prev_month) * 100).toFixed(1)
      : 0;

    const ordersGrowth = ord.prev_week > 0
      ? (((ord.this_week - ord.prev_week) / ord.prev_week) * 100).toFixed(1)
      : 0;

    res.json({
      revenue: {
        total: parseFloat(rev.total || 0).toFixed(2),
        today: parseFloat(rev.today || 0).toFixed(2),
        week: parseFloat(rev.week || 0).toFixed(2),
        month: parseFloat(rev.month || 0).toFixed(2),
        growth: parseFloat(revenueGrowth),
      },
      orders: {
        total: parseInt(ord.total || 0),
        today: parseInt(ord.today || 0),
        pending: parseInt(ord.pending || 0),
        fulfilled: parseInt(ord.fulfilled || 0),
        growth: parseFloat(ordersGrowth),
      },
      products: {
        total: parseInt(prod.total || 0),
        active: parseInt(prod.active || 0),
        low_stock: parseInt(prod.low_stock || 0),
      },
    });
  } catch (err) {
    console.error('Dashboard summary error:', err);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

// GET /api/dashboard/revenue-chart - Revenue over time
router.get('/revenue-chart', async (req, res) => {
  const { period = '30d' } = req.query;
  
  const intervalMap = {
    '7d': { interval: '7 days', group: 'day', format: 'Mon DD' },
    '30d': { interval: '30 days', group: 'day', format: 'Mon DD' },
    '90d': { interval: '90 days', group: 'week', format: 'Mon DD' },
  };

  const config = intervalMap[period] || intervalMap['30d'];

  try {
    const storeResult = await pool.query(
      'SELECT id FROM shopify_stores WHERE user_id = $1 AND is_active = TRUE LIMIT 1',
      [req.user.id]
    );

    if (storeResult.rows.length === 0) {
      return res.json({ data: [] });
    }

    const storeId = storeResult.rows[0].id;

    const result = await pool.query(`
      SELECT
        DATE_TRUNC('day', shopify_created_at) AS date,
        SUM(total_price) AS revenue,
        COUNT(*) AS orders
      FROM orders
      WHERE store_id = $1
        AND shopify_created_at >= NOW() - INTERVAL '${config.interval}'
        AND financial_status = 'paid'
      GROUP BY DATE_TRUNC('day', shopify_created_at)
      ORDER BY date ASC
    `, [storeId]);

    const data = result.rows.map(row => ({
      date: new Date(row.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      revenue: parseFloat(row.revenue).toFixed(2),
      orders: parseInt(row.orders),
    }));

    res.json({ data });
  } catch (err) {
    console.error('Revenue chart error:', err);
    res.status(500).json({ error: 'Failed to fetch chart data' });
  }
});

// GET /api/dashboard/top-products
router.get('/top-products', async (req, res) => {
  try {
    const storeResult = await pool.query(
      'SELECT id FROM shopify_stores WHERE user_id = $1 AND is_active = TRUE LIMIT 1',
      [req.user.id]
    );

    if (storeResult.rows.length === 0) {
      return res.json({ products: [] });
    }

    const storeId = storeResult.rows[0].id;

    // Get top products by order count from line_items
    const result = await pool.query(`
      SELECT 
        item->>'title' AS title,
        item->>'vendor' AS vendor,
        COUNT(*) AS order_count,
        SUM((item->>'price')::numeric * (item->>'quantity')::numeric) AS revenue
      FROM orders,
        jsonb_array_elements(line_items) AS item
      WHERE store_id = $1
        AND shopify_created_at >= NOW() - INTERVAL '30 days'
      GROUP BY item->>'title', item->>'vendor'
      ORDER BY revenue DESC
      LIMIT 5
    `, [storeId]);

    res.json({ products: result.rows });
  } catch (err) {
    console.error('Top products error:', err);
    res.status(500).json({ error: 'Failed to fetch top products' });
  }
});

module.exports = router;
