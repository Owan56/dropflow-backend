// src/routes/products.js
const express = require('express');
const pool = require('../db/pool');
const router = express.Router();

router.get('/', async (req, res) => {
  const { page = 1, limit = 20, status, search, sort = 'created_at' } = req.query;
  const offset = (page - 1) * limit;

  try {
    const storeResult = await pool.query(
      'SELECT id FROM shopify_stores WHERE user_id = $1 AND is_active = TRUE LIMIT 1',
      [req.user.id]
    );
    if (storeResult.rows.length === 0) return res.json({ products: [], total: 0 });

    const storeId = storeResult.rows[0].id;
    let whereClause = 'WHERE store_id = $1';
    const params = [storeId];
    let paramIdx = 2;

    if (status) {
      whereClause += ` AND status = $${paramIdx++}`;
      params.push(status);
    }
    if (search) {
      whereClause += ` AND (title ILIKE $${paramIdx} OR vendor ILIKE $${paramIdx})`;
      params.push(`%${search}%`);
      paramIdx++;
    }

    const countResult = await pool.query(`SELECT COUNT(*) FROM products ${whereClause}`, params);
    const result = await pool.query(
      `SELECT * FROM products ${whereClause} ORDER BY ${sort} DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, parseInt(limit), offset]
    );

    res.json({ products: result.rows, total: parseInt(countResult.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

module.exports = router;
