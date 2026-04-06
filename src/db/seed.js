// src/db/seed.js — Demo data for development
require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function seed() {
  const client = await pool.connect();
  try {
    console.log('🌱 Seeding demo data...');

    // Demo user
    const userId = uuidv4();
    const hash = await bcrypt.hash('demo1234', 12);
    await client.query(`
      INSERT INTO users (id, email, password_hash, full_name, plan)
      VALUES ($1, 'demo@dropflow.io', $2, 'Demo User', 'growth')
      ON CONFLICT (email) DO UPDATE SET password_hash = $2
      RETURNING id
    `, [userId, hash]);

    const userRes = await client.query(`SELECT id FROM users WHERE email = 'demo@dropflow.io'`);
    const uid = userRes.rows[0].id;

    // Demo store
    const storeId = uuidv4();
    await client.query(`
      INSERT INTO shopify_stores (id, user_id, shop_domain, access_token, shop_name, shop_email, currency, plan_name)
      VALUES ($1, $2, 'demo-store.myshopify.com', 'demo_token_xxx', 'Demo Store', 'demo@dropflow.io', 'USD', 'Basic Shopify')
      ON CONFLICT (shop_domain) DO NOTHING
    `, [storeId, uid]);

    const storeRes = await client.query(`SELECT id FROM shopify_stores WHERE shop_domain = 'demo-store.myshopify.com'`);
    const sid = storeRes.rows[0].id;

    // Demo products
    const products = [
      { title: 'Wireless Headphones Pro', vendor: 'SoundTech', price: 89.99, inventory: 45, status: 'active' },
      { title: 'Ergonomic Office Chair', vendor: 'ComfortZone', price: 349.00, inventory: 12, status: 'active' },
      { title: 'LED Desk Lamp', vendor: 'BrightLife', price: 34.99, inventory: 3, status: 'active' },
      { title: 'Mechanical Keyboard', vendor: 'TypeMaster', price: 129.00, inventory: 28, status: 'active' },
      { title: 'Yoga Mat Premium', vendor: 'FitLife', price: 49.99, inventory: 67, status: 'active' },
      { title: 'Smart Water Bottle', vendor: 'HydroTech', price: 39.99, inventory: 2, status: 'active' },
      { title: 'Portable Charger 20k', vendor: 'PowerBank', price: 59.99, inventory: 0, status: 'draft' },
      { title: 'Noise Cancelling Buds', vendor: 'SoundTech', price: 149.99, inventory: 19, status: 'active' },
    ];

    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      await client.query(`
        INSERT INTO products (store_id, shopify_id, title, vendor, product_type, status, price, inventory_quantity)
        VALUES ($1, $2, $3, $4, 'Electronics', $5, $6, $7)
        ON CONFLICT (store_id, shopify_id) DO NOTHING
      `, [sid, `100${i + 1}`, p.title, p.vendor, p.status, p.price, p.inventory]);
    }

    // Demo orders — last 60 days
    const customers = [
      { name: 'Alice Martin', email: 'alice@example.com' },
      { name: 'Bob Johnson', email: 'bob@example.com' },
      { name: 'Claire Dupont', email: 'claire@example.com' },
      { name: 'David Chen', email: 'david@example.com' },
      { name: 'Emma Wilson', email: 'emma@example.com' },
      { name: 'François Leclerc', email: 'francois@example.com' },
    ];

    const fulfillmentStatuses = ['fulfilled', 'fulfilled', 'fulfilled', null, 'partial'];
    const financialStatuses   = ['paid', 'paid', 'paid', 'paid', 'pending', 'refunded'];
    const lineItemTemplates   = [
      [{ title: 'Wireless Headphones Pro', price: '89.99', quantity: 1 }],
      [{ title: 'Ergonomic Office Chair', price: '349.00', quantity: 1 }],
      [{ title: 'LED Desk Lamp', price: '34.99', quantity: 2 }],
      [{ title: 'Mechanical Keyboard', price: '129.00', quantity: 1 }, { title: 'LED Desk Lamp', price: '34.99', quantity: 1 }],
      [{ title: 'Yoga Mat Premium', price: '49.99', quantity: 1 }],
      [{ title: 'Noise Cancelling Buds', price: '149.99', quantity: 1 }],
    ];

    let orderNum = 1001;
    for (let day = 60; day >= 0; day--) {
      // 0-5 orders per day with some variance
      const ordersToday = Math.floor(Math.random() * 6);
      for (let o = 0; o < ordersToday; o++) {
        const customer = customers[Math.floor(Math.random() * customers.length)];
        const lineItems = lineItemTemplates[Math.floor(Math.random() * lineItemTemplates.length)];
        const total = lineItems.reduce((s, i) => s + parseFloat(i.price) * i.quantity, 0);
        const daysAgo = new Date();
        daysAgo.setDate(daysAgo.getDate() - day);
        daysAgo.setHours(Math.floor(Math.random() * 14) + 8); // 8am-10pm

        await client.query(`
          INSERT INTO orders (store_id, shopify_id, order_number, customer_name, customer_email,
            total_price, currency, financial_status, fulfillment_status, line_items, shipping_address, shopify_created_at)
          VALUES ($1, $2, $3, $4, $5, $6, 'USD', $7, $8, $9, $10, $11)
          ON CONFLICT (store_id, shopify_id) DO NOTHING
        `, [
          sid,
          `DEMO${orderNum}`,
          orderNum,
          customer.name,
          customer.email,
          total.toFixed(2),
          financialStatuses[Math.floor(Math.random() * financialStatuses.length)],
          fulfillmentStatuses[Math.floor(Math.random() * fulfillmentStatuses.length)],
          JSON.stringify(lineItems),
          JSON.stringify({ city: 'Paris', country: 'France', zip: '75001' }),
          daysAgo.toISOString(),
        ]);
        orderNum++;
      }
    }

    // Demo alerts
    await client.query(`
      INSERT INTO alerts (user_id, store_id, type, title, message)
      VALUES
        ($1, $2, 'new_order', 'New Order #${orderNum}', 'Order from alice@example.com — $89.99'),
        ($1, $2, 'low_stock', 'Low Stock Alert', 'Smart Water Bottle: only 2 units left'),
        ($1, $2, 'new_order', 'New Order #${orderNum + 1}', 'Order from bob@example.com — $349.00')
      ON CONFLICT DO NOTHING
    `, [uid, sid]);

    console.log(`✅ Seeded: 1 user, 1 store, ${products.length} products, ~${orderNum - 1001} orders`);
    console.log('📧 Demo login: demo@dropflow.io / demo1234');
  } catch (err) {
    console.error('❌ Seed error:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
