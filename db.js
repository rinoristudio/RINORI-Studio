const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. Copy your Neon connection string into .env or the Render dashboard.');
  process.exit(1);
}

// Neon connection strings already contain ?sslmode=require, which enables SSL.
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.PG_POOL_MAX) || 5 });

const query = (text, params) => pool.query(text, params);

// Runs fn(client) inside BEGIN/COMMIT, rolling back on error.
async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  role          TEXT NOT NULL DEFAULT 'customer',
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  phone         TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS addresses (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  full_name  TEXT NOT NULL,
  phone      TEXT NOT NULL,
  alt_phone  TEXT NOT NULL DEFAULT '',
  house      TEXT NOT NULL,
  street     TEXT NOT NULL,
  landmark   TEXT NOT NULL DEFAULT '',
  city       TEXT NOT NULL,
  district   TEXT NOT NULL DEFAULT '',
  state      TEXT NOT NULL,
  pincode    TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'Home',
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS addresses_user_idx ON addresses(user_id);

CREATE TABLE IF NOT EXISTS images (
  id         TEXT PRIMARY KEY,
  mime       TEXT NOT NULL,
  data       BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'Handmade',
  description TEXT NOT NULL DEFAULT '',
  price       INTEGER NOT NULL,
  mrp         INTEGER,
  stock       INTEGER NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT true,
  images      JSONB NOT NULL DEFAULT '[]',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id             TEXT PRIMARY KEY,
  number         TEXT NOT NULL UNIQUE,
  user_id        TEXT REFERENCES users(id) ON DELETE SET NULL,
  customer       JSONB NOT NULL,
  address        JSONB NOT NULL,
  items          JSONB NOT NULL,
  subtotal       INTEGER NOT NULL,
  shipping       INTEGER NOT NULL,
  total          INTEGER NOT NULL,
  payment_method TEXT NOT NULL,
  note           TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL,
  history        JSONB NOT NULL DEFAULT '[]',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS orders_user_idx ON orders(user_id);

CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  message    TEXT NOT NULL,
  product_id TEXT,
  order_id   TEXT,
  read       BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- v2: per-product shipping, UPI payments, Speed Post tracking
ALTER TABLE products ADD COLUMN IF NOT EXISTS shipping INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_ref TEXT NOT NULL DEFAULT '';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_number TEXT NOT NULL DEFAULT '';
`;

module.exports = { pool, query, transaction, SCHEMA };
