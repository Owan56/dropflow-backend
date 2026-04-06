// src/routes/analytics.js
const express = require('express');
const pool = require('../db/pool');
const router = express.Router();

router.get('/overview', async (req, res) => {
  const { period = '30d' } = req.query;
  const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;

  try {
    const storeResult = await pool.query(
      'SELECT id FROM shopify_stores WHERE user_id = $1 AND is_active = TRUE LIMIT 1',
      [req.user.id]
    );
    if (storeResult.rows.length === 0) return res.json({ data: [] });

    const storeId = storeResult.rows[0].id;

    // Revenue by day
    const dailyRevenue = await pool.query(`
      SELECT
        DATE_TRUNC('day', shopify_created_at) AS date,
        SUM(total_price) AS revenue,
        COUNT(*) AS orders,
        AVG(total_price) AS avg_order_value
      FROM orders
      WHERE store_id = $1
        AND shopify_created_at >= NOW() - INTERVAL '${days} days'
        AND financial_status = 'paid'
      GROUP BY DATE_TRUNC('day', shopify_created_at)
      ORDER BY date
    `, [storeId]);

    // Fulfillment breakdown
    const fulfillmentBreakdown = await pool.query(`
      SELECT
        COALESCE(fulfillment_status, 'unfulfilled') AS status,
        COUNT(*) AS count
      FROM orders
      WHERE store_id = $1
        AND shopify_created_at >= NOW() - INTERVAL '${days} days'
      GROUP BY fulfillment_status
    `, [storeId]);

    // Financial status breakdown
    const financialBreakdown = await pool.query(`
      SELECT financial_status, COUNT(*), SUM(total_price) AS revenue
      FROM orders
      WHERE store_id = $1
        AND shopify_created_at >= NOW() - INTERVAL '${days} days'
      GROUP BY financial_status
    `, [storeId]);

    res.json({
      dailyRevenue: dailyRevenue.rows.map(r => ({
        date: new Date(r.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        revenue: parseFloat(r.revenue || 0),
        orders: parseInt(r.orders),
        avg: parseFloat(r.avg_order_value || 0).toFixed(2),
      })),
      fulfillmentBreakdown: fulfillmentBreakdown.rows,
      financialBreakdown: financialBreakdown.rows,
    });
  } catch (err) {
    console.error('Analytics error:', err);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

module.exports = router;
