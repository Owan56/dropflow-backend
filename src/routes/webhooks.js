// src/routes/webhooks.js
const express = require('express');
const crypto = require('crypto');
const pool = require('../db/pool');
const router = express.Router();

function verifyShopifyWebhook(req) {
  const hmacHeader = req.headers['x-shopify-hmac-sha256'];
  if (!hmacHeader) return false;
  const body = req.body;
  const computed = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
    .update(body)
    .digest('base64');
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(hmacHeader));
}

async function processOrderWebhook(shop, order, eventType, io) {
  try {
    const storeResult = await pool.query(
      'SELECT id, user_id FROM shopify_stores WHERE shop_domain = $1',
      [shop]
    );
    if (storeResult.rows.length === 0) return;

    const { id: storeId, user_id: userId } = storeResult.rows[0];

    await pool.query(
      `INSERT INTO orders (store_id, shopify_id, order_number, customer_name, customer_email,
        total_price, currency, financial_status, fulfillment_status, line_items, shipping_address, shopify_created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (store_id, shopify_id) DO UPDATE
       SET financial_status = $8, fulfillment_status = $9, updated_at = NOW()`,
      [
        storeId, order.id.toString(), order.order_number,
        order.customer ? `${order.customer.first_name} ${order.customer.last_name}` : 'Guest',
        order.email, parseFloat(order.total_price), order.currency,
        order.financial_status, order.fulfillment_status,
        JSON.stringify(order.line_items), JSON.stringify(order.shipping_address), order.created_at,
      ]
    );

    // Create alert for new orders
    if (eventType === 'orders/create') {
      await pool.query(
        `INSERT INTO alerts (user_id, store_id, type, title, message)
         VALUES ($1, $2, 'new_order', 'New Order Received', $3)`,
        [userId, storeId, `Order #${order.order_number} - $${order.total_price} from ${order.email}`]
      );
    }

    // Emit real-time event
    if (io) {
      io.to(`user_${userId}`).emit('order_event', {
        type: eventType,
        order: {
          id: order.id,
          order_number: order.order_number,
          total_price: order.total_price,
          customer_email: order.email,
          fulfillment_status: order.fulfillment_status,
        },
        timestamp: new Date().toISOString(),
      });
    }
  } catch (err) {
    console.error('Webhook processing error:', err);
  }
}

router.post('/orders/create', async (req, res) => {
  if (!verifyShopifyWebhook(req)) return res.status(401).send('Unauthorized');
  res.sendStatus(200);
  const shop = req.headers['x-shopify-shop-domain'];
  const order = JSON.parse(req.body.toString());
  const io = req.app.get('io');
  await processOrderWebhook(shop, order, 'orders/create', io);
});

router.post('/orders/updated', async (req, res) => {
  if (!verifyShopifyWebhook(req)) return res.status(401).send('Unauthorized');
  res.sendStatus(200);
  const shop = req.headers['x-shopify-shop-domain'];
  const order = JSON.parse(req.body.toString());
  const io = req.app.get('io');
  await processOrderWebhook(shop, order, 'orders/updated', io);
});

router.post('/orders/fulfilled', async (req, res) => {
  if (!verifyShopifyWebhook(req)) return res.status(401).send('Unauthorized');
  res.sendStatus(200);
  const shop = req.headers['x-shopify-shop-domain'];
  const order = JSON.parse(req.body.toString());
  const io = req.app.get('io');
  await processOrderWebhook(shop, order, 'orders/fulfilled', io);
});

router.post('/app/uninstalled', async (req, res) => {
  if (!verifyShopifyWebhook(req)) return res.status(401).send('Unauthorized');
  res.sendStatus(200);
  const shop = req.headers['x-shopify-shop-domain'];
  try {
    await pool.query(
      'UPDATE shopify_stores SET is_active = FALSE WHERE shop_domain = $1',
      [shop]
    );
  } catch (err) {
    console.error('Uninstall webhook error:', err);
  }
});

module.exports = router;
