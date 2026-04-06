// src/routes/orders.js
const express = require('express');
const pool = require('../db/pool');
const router = express.Router();

router.get('/', async (req, res) => {
  const { page = 1, limit = 20, status, search } = req.query;
  const offset = (page - 1) * limit;

  try {
    const storeResult = await pool.query(
      'SELECT id FROM shopify_stores WHERE user_id = $1 AND is_active = TRUE LIMIT 1',
      [req.user.id]
    );
    if (storeResult.rows.length === 0) return res.json({ orders: [], total: 0 });

    const storeId = storeResult.rows[0].id;
    let whereClause = 'WHERE store_id = $1';
    const params = [storeId];
    let paramIdx = 2;

    if (status) {
      whereClause += ` AND fulfillment_status = $${paramIdx++}`;
      params.push(status);
    }
    if (search) {
      whereClause += ` AND (customer_name ILIKE $${paramIdx} OR customer_email ILIKE $${paramIdx} OR order_number::text ILIKE $${paramIdx})`;
      params.push(`%${search}%`);
      paramIdx++;
    }

    const countResult = await pool.query(`SELECT COUNT(*) FROM orders ${whereClause}`, params);
    const result = await pool.query(
      `SELECT * FROM orders ${whereClause} ORDER BY shopify_created_at DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, parseInt(limit), offset]
    );

    res.json({ orders: result.rows, total: parseInt(countResult.rows[0].count), page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error('Orders error:', err);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT o.* FROM orders o
       JOIN shopify_stores s ON o.store_id = s.id
       WHERE o.id = $1 AND s.user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Order not found' });
    res.json({ order: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch order' });
  }
});

module.exports = router;
