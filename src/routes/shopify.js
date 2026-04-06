// src/routes/shopify.js
const express = require('express');
const crypto = require('crypto');
const pool = require('../db/pool');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// GET /auth/shopify/install - Initiate OAuth
router.get('/install', authenticateToken, (req, res) => {
  const { shop } = req.query;

  if (!shop || !shop.match(/^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/)) {
    return res.status(400).json({ error: 'Invalid shop domain' });
  }

  const state = crypto.randomBytes(16).toString('hex');
  const scopes = process.env.SHOPIFY_SCOPES || 'read_orders,read_products,read_customers';
  const redirectUri = process.env.SHOPIFY_REDIRECT_URI;
  const apiKey = process.env.SHOPIFY_API_KEY;

  const installUrl = `https://${shop}/admin/oauth/authorize?client_id=${apiKey}&scope=${scopes}&redirect_uri=${redirectUri}&state=${state}&grant_options[]=per-user`;

  // In production, store state in Redis/session
  res.json({ installUrl, state });
});

// GET /auth/shopify/callback - Handle OAuth callback
router.get('/callback', async (req, res) => {
  const { code, shop, state, hmac } = req.query;

  if (!code || !shop) {
    return res.redirect(`${process.env.FRONTEND_URL}/connect?error=missing_params`);
  }

  // Verify HMAC
  const params = Object.keys(req.query)
    .filter(key => key !== 'hmac')
    .sort()
    .map(key => `${key}=${req.query[key]}`)
    .join('&');

  const digest = crypto
    .createHmac('sha256', process.env.SHOPIFY_API_SECRET)
    .update(params)
    .digest('hex');

  if (digest !== hmac) {
    return res.redirect(`${process.env.FRONTEND_URL}/connect?error=invalid_hmac`);
  }

  try {
    // Exchange code for access token
    const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.SHOPIFY_API_KEY,
        client_secret: process.env.SHOPIFY_API_SECRET,
        code,
      }),
    });

    const { access_token } = await tokenResponse.json();

    if (!access_token) {
      throw new Error('No access token received');
    }

    // Fetch shop details
    const shopResponse = await fetch(`https://${shop}/admin/api/2024-01/shop.json`, {
      headers: { 'X-Shopify-Access-Token': access_token },
    });
    const { shop: shopData } = await shopResponse.json();

    // Find or create user based on shop email
    let userId;
    const existingStore = await pool.query(
      'SELECT user_id FROM shopify_stores WHERE shop_domain = $1',
      [shop]
    );

    if (existingStore.rows.length > 0) {
      userId = existingStore.rows[0].user_id;
      // Update access token
      await pool.query(
        `UPDATE shopify_stores 
         SET access_token = $1, shop_name = $2, shop_email = $3, updated_at = NOW()
         WHERE shop_domain = $4`,
        [access_token, shopData.name, shopData.email, shop]
      );
    } else {
      // Create user from Shopify store owner
      let userResult = await pool.query(
        'SELECT id FROM users WHERE email = $1',
        [shopData.email]
      );

      if (userResult.rows.length === 0) {
        userResult = await pool.query(
          `INSERT INTO users (email, full_name) VALUES ($1, $2) RETURNING id`,
          [shopData.email, shopData.shop_owner || shopData.name]
        );
      }

      userId = userResult.rows[0].id;

      // Save store
      await pool.query(
        `INSERT INTO shopify_stores 
         (user_id, shop_domain, access_token, shop_name, shop_email, currency, timezone, plan_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [userId, shop, access_token, shopData.name, shopData.email,
         shopData.currency, shopData.iana_timezone, shopData.plan_name]
      );
    }

    // Register webhooks
    await registerWebhooks(shop, access_token, userId);

    // Redirect to frontend with success
    const jwt = require('jsonwebtoken');
    const token = jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.redirect(`${process.env.FRONTEND_URL}/dashboard?token=${token}&shop=${shop}&installed=true`);
  } catch (err) {
    console.error('Shopify callback error:', err);
    res.redirect(`${process.env.FRONTEND_URL}/connect?error=oauth_failed`);
  }
});

// Register Shopify webhooks
async function registerWebhooks(shop, accessToken, userId) {
  const webhooks = [
    { topic: 'orders/create', address: `${process.env.BACKEND_URL || 'https://api.dropflow.io'}/webhooks/orders/create` },
    { topic: 'orders/updated', address: `${process.env.BACKEND_URL || 'https://api.dropflow.io'}/webhooks/orders/updated` },
    { topic: 'orders/fulfilled', address: `${process.env.BACKEND_URL || 'https://api.dropflow.io'}/webhooks/orders/fulfilled` },
    { topic: 'products/create', address: `${process.env.BACKEND_URL || 'https://api.dropflow.io'}/webhooks/products/create` },
    { topic: 'app/uninstalled', address: `${process.env.BACKEND_URL || 'https://api.dropflow.io'}/webhooks/app/uninstalled` },
  ];

  for (const webhook of webhooks) {
    try {
      const response = await fetch(`https://${shop}/admin/api/2024-01/webhooks.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': accessToken,
        },
        body: JSON.stringify({ webhook }),
      });
      const data = await response.json();
      
      if (data.webhook) {
        const storeResult = await pool.query('SELECT id FROM shopify_stores WHERE shop_domain = $1', [shop]);
        if (storeResult.rows.length > 0) {
          await pool.query(
            'INSERT INTO webhooks (store_id, topic, address, shopify_id) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
            [storeResult.rows[0].id, webhook.topic, webhook.address, data.webhook.id.toString()]
          );
        }
      }
    } catch (err) {
      console.error(`Failed to register webhook ${webhook.topic}:`, err.message);
    }
  }
}

// GET /auth/shopify/stores - List connected stores
router.get('/stores', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, shop_domain, shop_name, shop_email, currency, plan_name, is_active, installed_at
       FROM shopify_stores WHERE user_id = $1`,
      [req.user.id]
    );
    res.json({ stores: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stores' });
  }
});

// DELETE /auth/shopify/stores/:id - Disconnect store
router.delete('/stores/:id', authenticateToken, async (req, res) => {
  try {
    await pool.query(
      'UPDATE shopify_stores SET is_active = FALSE WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    res.json({ message: 'Store disconnected' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to disconnect store' });
  }
});

// POST /auth/shopify/sync/:storeId - Trigger manual sync
router.post('/sync/:storeId', authenticateToken, async (req, res) => {
  try {
    const storeResult = await pool.query(
      'SELECT * FROM shopify_stores WHERE id = $1 AND user_id = $2',
      [req.params.storeId, req.user.id]
    );

    if (storeResult.rows.length === 0) {
      return res.status(404).json({ error: 'Store not found' });
    }

    const store = storeResult.rows[0];
    const io = req.app.get('io');

    // Sync orders
    await syncOrders(store, io);
    // Sync products
    await syncProducts(store, io);

    res.json({ message: 'Sync completed' });
  } catch (err) {
    console.error('Sync error:', err);
    res.status(500).json({ error: 'Sync failed' });
  }
});

async function syncOrders(store, io) {
  try {
    const response = await fetch(
      `https://${store.shop_domain}/admin/api/2024-01/orders.json?status=any&limit=250`,
      { headers: { 'X-Shopify-Access-Token': store.access_token } }
    );
    const { orders } = await response.json();

    for (const order of orders || []) {
      await pool.query(
        `INSERT INTO orders (store_id, shopify_id, order_number, customer_name, customer_email,
          total_price, currency, financial_status, fulfillment_status, line_items, shipping_address, shopify_created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (store_id, shopify_id) DO UPDATE
         SET financial_status = $8, fulfillment_status = $9`,
        [
          store.id, order.id.toString(), order.order_number,
          order.customer ? `${order.customer.first_name} ${order.customer.last_name}` : 'Guest',
          order.email,
          parseFloat(order.total_price), order.currency,
          order.financial_status, order.fulfillment_status,
          JSON.stringify(order.line_items), JSON.stringify(order.shipping_address),
          order.created_at,
        ]
      );
    }

    if (io) {
      io.to(`store_${store.id}`).emit('sync_complete', { type: 'orders', count: orders?.length || 0 });
    }
  } catch (err) {
    console.error('Order sync error:', err.message);
  }
}

async function syncProducts(store, io) {
  try {
    const response = await fetch(
      `https://${store.shop_domain}/admin/api/2024-01/products.json?limit=250`,
      { headers: { 'X-Shopify-Access-Token': store.access_token } }
    );
    const { products } = await response.json();

    for (const product of products || []) {
      const price = product.variants?.[0]?.price || 0;
      const inventory = product.variants?.reduce((sum, v) => sum + (v.inventory_quantity || 0), 0);
      const imageUrl = product.images?.[0]?.src;

      await pool.query(
        `INSERT INTO products (store_id, shopify_id, title, vendor, product_type, status, price, inventory_quantity, image_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (store_id, shopify_id) DO UPDATE
         SET title = $3, status = $6, price = $7, inventory_quantity = $8`,
        [store.id, product.id.toString(), product.title, product.vendor,
         product.product_type, product.status, parseFloat(price), inventory, imageUrl]
      );
    }

    if (io) {
      io.to(`store_${store.id}`).emit('sync_complete', { type: 'products', count: products?.length || 0 });
    }
  } catch (err) {
    console.error('Product sync error:', err.message);
  }
}

module.exports = router;
module.exports.syncOrders = syncOrders;
module.exports.syncProducts = syncProducts;
