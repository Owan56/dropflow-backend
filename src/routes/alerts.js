// src/routes/alerts.js
const express = require('express');
const pool = require('../db/pool');
const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM alerts WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.user.id]
    );
    res.json({ alerts: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

router.patch('/:id/read', async (req, res) => {
  try {
    await pool.query(
      'UPDATE alerts SET is_read = TRUE WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    res.json({ message: 'Alert marked as read' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update alert' });
  }
});

router.patch('/read-all', async (req, res) => {
  try {
    await pool.query('UPDATE alerts SET is_read = TRUE WHERE user_id = $1', [req.user.id]);
    res.json({ message: 'All alerts marked as read' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update alerts' });
  }
});

router.get('/unread-count', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT COUNT(*) FROM alerts WHERE user_id = $1 AND is_read = FALSE',
      [req.user.id]
    );
    res.json({ count: parseInt(result.rows[0].count) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch count' });
  }
});

module.exports = router;
