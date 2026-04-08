// src/db/migrate.js
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const migrations = `
  -- Users table
  CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255),
    full_name VARCHAR(255),
    avatar_url VARCHAR(500),
    plan VARCHAR(50) DEFAULT 'starter',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  );

  -- Shopify stores table
  CREATE TABLE IF NOT EXISTS shopify_stores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    shop_domain VARCHAR(255) UNIQUE NOT NULL,
    access_token VARCHAR(500) NOT NULL,
    shop_name VARCHAR(255),
    shop_email VARCHAR(255),
    currency VARCHAR(10) DEFAULT 'USD',
    timezone VARCHAR(100),
    plan_name VARCHAR(100),
    is_active BOOLEAN DEFAULT TRUE,
    installed_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  );

  -- Orders table (synced from Shopify)
  CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID REFERENCES shopify_stores(id) ON DELETE CASCADE,
    shopify_id VARCHAR(100) NOT NULL,
    order_number VARCHAR(50),
    customer_name VARCHAR(255),
    customer_email VARCHAR(255),
    total_price DECIMAL(10,2),
    currency VARCHAR(10),
    financial_status VARCHAR(50),
    fulfillment_status VARCHAR(50),
    line_items JSONB,
    shipping_address JSONB,
    created_at TIMESTAMP DEFAULT NOW(),
    shopify_created_at TIMESTAMP,
    UNIQUE(store_id, shopify_id)
  );

  -- Products table
  CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID REFERENCES shopify_stores(id) ON DELETE CASCADE,
    shopify_id VARCHAR(100) NOT NULL,
    title VARCHAR(500),
    vendor VARCHAR(255),
    product_type VARCHAR(255),
    status VARCHAR(50),
    price DECIMAL(10,2),
    inventory_quantity INTEGER DEFAULT 0,
    image_url VARCHAR(500),
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(store_id, shopify_id)
  );

  -- Analytics events table
  CREATE TABLE IF NOT EXISTS analytics_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID REFERENCES shopify_stores(id) ON DELETE CASCADE,
    event_type VARCHAR(100) NOT NULL,
    event_data JSONB,
    revenue DECIMAL(10,2) DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
  );

  -- Webhooks table
  CREATE TABLE IF NOT EXISTS webhooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_id UUID REFERENCES shopify_stores(id) ON DELETE CASCADE,
    topic VARCHAR(100) NOT NULL,
    address VARCHAR(500) NOT NULL,
    shopify_id VARCHAR(100),
    created_at TIMESTAMP DEFAULT NOW()
  );

  -- Alerts/Notifications table
  CREATE TABLE IF NOT EXISTS alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    store_id UUID REFERENCES shopify_stores(id) ON DELETE SET NULL,
    type VARCHAR(50) NOT NULL,
    title VARCHAR(255),
    message TEXT,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW()
  );

  -- Indexes
  CREATE INDEX IF NOT EXISTS idx_orders_store_id ON orders(store_id);
  CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_products_store_id ON products(store_id);
  CREATE INDEX IF NOT EXISTS idx_analytics_store_id ON analytics_events(store_id);
  CREATE INDEX IF NOT EXISTS idx_analytics_created_at ON analytics_events(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_alerts_user_id ON alerts(user_id);
`;

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔄 Running migrations...');
    await client.query(migrations);
    console.log('✅ Migrations completed successfully');
  } catch (err) {
    console.error('❌ Migration error:', err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

// Export for programmatic use (e.g. called from server.js on startup).
// When run directly as a script, execute and propagate the exit code.
module.exports = migrate;

if (require.main === module) {
  migrate()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
