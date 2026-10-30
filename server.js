try { process.loadEnvFile(); } catch { /* no .env file: use real environment variables */ }

const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { query, transaction, SCHEMA } = require('./db');
const { hashPassword, checkPassword } = require('./passwords');
const razorpay = require('./razorpay');

const SESSION_DAYS = 30;

// Orders become "Paid" only after Razorpay confirms the payment.
const ORDER_STATUSES = ['Paid', 'Packed', 'Shipped', 'Delivered', 'Cancelled'];
const INDIAN_STATES = [
  'Andaman and Nicobar Islands', 'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chandigarh',
  'Chhattisgarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jammu and Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Ladakh', 'Lakshadweep',
  'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Puducherry',
  'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand',
  'West Bengal',
];

// ---------- helpers ----------

const newId = () => crypto.randomBytes(8).toString('hex');
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const isPhone = p => /^[6-9]\d{9}$/.test(p);
const cleanPhone = p => str(p, 20).replace(/[\s-]/g, '').replace(/^(\+91|0)/, '');

// Wraps async route handlers so thrown errors reach the error middleware.
const h = fn => (req, res, next) => fn(req, res, next).catch(next);

const toUser = r => ({ id: r.id, role: r.role, name: r.name, email: r.email, phone: r.phone, createdAt: r.created_at });

const toAddress = r => ({
  id: r.id, fullName: r.full_name, phone: r.phone, altPhone: r.alt_phone, house: r.house, street: r.street,
  landmark: r.landmark, city: r.city, district: r.district, state: r.state, pincode: r.pincode,
  type: r.type, isDefault: r.is_default,
});

const toProduct = r => ({
  id: r.id, name: r.name, category: r.category, description: r.description, price: r.price, mrp: r.mrp,
  shipping: r.shipping, stock: r.stock, active: r.active, images: r.images, createdAt: r.created_at,
});

const toOrder = r => ({
  id: r.id, number: r.number, userId: r.user_id, customer: r.customer, address: r.address, items: r.items,
  subtotal: r.subtotal, shipping: r.shipping, total: r.total, paymentMethod: r.payment_method, note: r.note,
  paymentRef: r.payment_ref, trackingNumber: r.tracking_number, status: r.status, history: r.history, createdAt: r.created_at,
});

const toNotification = r => ({
  id: r.id, title: r.title, message: r.message, productId: r.product_id, orderId: r.order_id,
  read: r.read, createdAt: r.created_at,
});

async function getAddresses(userId) {
  const { rows } = await query('SELECT * FROM addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at', [userId]);
  return rows.map(toAddress);
}

function notify(db, userId, title, message, { productId = null, orderId = null } = {}) {
  return db.query(
    'INSERT INTO notifications (id, user_id, title, message, product_id, order_id) VALUES ($1,$2,$3,$4,$5,$6)',
    [newId(), userId, title, message, productId, orderId],
  );
}

function cleanAddress(body) {
  const a = {
    fullName: str(body.fullName, 100),
    phone: cleanPhone(body.phone),
    altPhone: cleanPhone(body.altPhone),
    house: str(body.house),
    street: str(body.street),
    landmark: str(body.landmark),
    city: str(body.city, 80),
    district: str(body.district, 80),
    state: str(body.state, 80),
    pincode: str(body.pincode, 10),
    type: ['Home', 'Work', 'Other'].includes(body.type) ? body.type : 'Home',
  };
  if (!a.fullName) return { error: 'Please enter the full name' };
  if (!isPhone(a.phone)) return { error: 'Please enter a valid 10-digit mobile number' };
  if (a.altPhone && !isPhone(a.altPhone)) return { error: 'Alternate number must be a valid 10-digit mobile number' };
  if (!a.house) return { error: 'Please enter house / flat number and building' };
  if (!a.street) return { error: 'Please enter street, area or locality' };
  if (!a.city) return { error: 'Please enter the city' };
  if (!INDIAN_STATES.includes(a.state)) return { error: 'Please choose a state' };
  if (!/^[1-9]\d{5}$/.test(a.pincode)) return { error: 'Please enter a valid 6-digit pincode' };
  return { address: a };
}

const addressValues = a => [a.fullName, a.phone, a.altPhone, a.house, a.street, a.landmark, a.city, a.district, a.state, a.pincode, a.type];

function orderNumber() {
  const d = new Date();
  const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `RS-${ymd}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

async function saveImage(db, buffer, mime) {
  const id = newId();
  await db.query('INSERT INTO images (id, mime, data) VALUES ($1,$2,$3)', [id, mime, buffer]);
  return '/images/' + id;
}

function paymentStatus() {
  return { ready: razorpay.isConfigured(), mode: razorpay.mode(), webhook: razorpay.webhookConfigured() };
}

// ---------- startup: schema + seed ----------

async function init() {
  await query(SCHEMA);

  const admin = await query("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1");
  if (!admin.rowCount) {
    console.warn('No admin account yet. Create one with: npm run set-admin -- you@example.com');
  }

  const seeded = await query("SELECT 1 FROM settings WHERE key = 'seeded'");
  if (!seeded.rowCount) {
    await transaction(async db => {
      const dir = path.join(__dirname, 'assets', 'products');
      const images = [];
      for (const file of ['product 1.jpg', 'product 1.1.jpg']) {
        images.push(await saveImage(db, fs.readFileSync(path.join(dir, file)), 'image/jpeg'));
      }
      await db.query(
        'INSERT INTO products (id, name, category, description, price, stock, images) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [
          newId(),
          'Starry Mist Organza Scrunchie',
          'Scrunchies',
          'A dreamy, oversized scrunchie made by hand from soft dusk-blue organza with tiny shimmering ' +
            'specks, like a night sky over Kyoto. Gentle on hair, holds a bun or ponytail without creasing, ' +
            'and looks lovely on the wrist too.',
          80,
          50,
          JSON.stringify(images),
        ],
      );
      await db.query("INSERT INTO settings (key, value) VALUES ('seeded', 'true')");
    });
    console.log('Added the first product');
  }
}

// ---------- sessions ----------

function getCookie(req, name) {
  const part = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(name + '='));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : null;
}

async function currentUser(req) {
  const token = getCookie(req, 'rs_sid');
  if (!token) return null;
  const { rows } = await query(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.created_at > now() - interval '${SESSION_DAYS} days'`,
    [token],
  );
  return rows[0] ? toUser(rows[0]) : null;
}

function sessionCookie(req, value, maxAge) {
  const secure = req.secure ? '; Secure' : '';
  return `rs_sid=${value}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

async function startSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await query('INSERT INTO sessions (token, user_id) VALUES ($1,$2)', [token, userId]);
  res.setHeader('Set-Cookie', sessionCookie(req, token, SESSION_DAYS * 86400));
}

const auth = h(async (req, res, next) => {
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: 'Please log in first' });
  req.user = user;
  next();
});

function adminOnly(req, res, next) {
  auth(req, res, err => {
    if (err) return next(err);
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
    next();
  });
}

// ---------- uploads (kept in memory, then stored in Postgres) ----------

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: config.maxProductImages },
  fileFilter: (req, file, cb) =>
    IMAGE_TYPES.includes(file.mimetype) ? cb(null, true) : cb(new Error('Only JPG, PNG, WEBP or GIF images are allowed')),
});

// ---------- app ----------

const app = express();
app.set('trust proxy', 1); // Render terminates HTTPS in front of the app
app.use((req, res, next) => (req.path === '/api/razorpay/webhook' ? next() : express.json({ limit: '100kb' })(req, res, next)));

app.get('/healthz', (req, res) => res.send('ok'));

app.get('/images/:id', h(async (req, res) => {
  const { rows } = await query('SELECT mime, data FROM images WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).end();
  res.set('Content-Type', rows[0].mime);
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(rows[0].data);
}));

// Auth
app.post('/api/auth/signup', h(async (req, res) => {
  const name = str(req.body.name, 100);
  const email = str(req.body.email, 120).toLowerCase();
  const phone = cleanPhone(req.body.phone);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!name) return res.status(400).json({ error: 'Please enter your name' });
  if (!isEmail(email)) return res.status(400).json({ error: 'Please enter a valid email' });
  if (!isPhone(phone)) return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const exists = await query('SELECT 1 FROM users WHERE email = $1', [email]);
  if (exists.rowCount) return res.status(409).json({ error: 'An account with this email already exists' });

  const id = newId();
  const { rows } = await query(
    'INSERT INTO users (id, name, email, phone, password_hash) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [id, name, email, phone, hashPassword(password)],
  );
  await notify({ query }, id, 'Welcome to Rinori Studio 🌸', 'Thank you for joining us! Every piece here is made by hand with love.');
  await startSession(req, res, id);
  res.json({ user: toUser(rows[0]) });
}));

app.post('/api/auth/login', h(async (req, res) => {
  const email = str(req.body.email, 120).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const { rows } = await query('SELECT * FROM users WHERE email = $1', [email]);
  if (!rows[0] || !checkPassword(password, rows[0].password_hash)) {
    return res.status(401).json({ error: 'Email or password is incorrect' });
  }
  await startSession(req, res, rows[0].id);
  res.json({ user: toUser(rows[0]) });
}));

app.post('/api/auth/logout', h(async (req, res) => {
  const token = getCookie(req, 'rs_sid');
  if (token) await query('DELETE FROM sessions WHERE token = $1', [token]);
  res.setHeader('Set-Cookie', sessionCookie(req, '', 0));
  res.json({ ok: true });
}));

// Profile & addresses
app.get('/api/me', auth, h(async (req, res) => {
  const { rows } = await query('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND NOT read', [req.user.id]);
  res.json({
    user: { ...req.user, addresses: await getAddresses(req.user.id) },
    unread: rows[0].n,
    states: INDIAN_STATES,
    payment: paymentStatus(),
  });
}));

app.put('/api/me', auth, h(async (req, res) => {
  const name = str(req.body.name, 100);
  const phone = cleanPhone(req.body.phone);
  if (!name) return res.status(400).json({ error: 'Please enter your name' });
  if (phone && !isPhone(phone)) return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number' });
  const { rows } = await query('UPDATE users SET name = $2, phone = $3 WHERE id = $1 RETURNING *', [req.user.id, name, phone]);
  res.json({ user: toUser(rows[0]) });
}));

app.post('/api/me/addresses', auth, h(async (req, res) => {
  const { address, error } = cleanAddress(req.body);
  if (error) return res.status(400).json({ error });
  const result = await transaction(async db => {
    const { rows } = await db.query('SELECT count(*)::int AS n FROM addresses WHERE user_id = $1', [req.user.id]);
    if (rows[0].n >= 10) return { error: 'You can save up to 10 addresses' };
    const isDefault = rows[0].n === 0 || !!req.body.isDefault;
    if (isDefault) await db.query('UPDATE addresses SET is_default = false WHERE user_id = $1', [req.user.id]);
    const inserted = await db.query(
      `INSERT INTO addresses (id, user_id, full_name, phone, alt_phone, house, street, landmark, city, district, state, pincode, type, is_default)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [newId(), req.user.id, ...addressValues(address), isDefault],
    );
    return { address: toAddress(inserted.rows[0]) };
  });
  if (result.error) return res.status(400).json(result);
  res.json(result);
}));

app.put('/api/me/addresses/:id', auth, h(async (req, res) => {
  const { address, error } = cleanAddress(req.body);
  if (error) return res.status(400).json({ error });
  const updated = await transaction(async db => {
    const { rows } = await db.query(
      `UPDATE addresses SET full_name=$3, phone=$4, alt_phone=$5, house=$6, street=$7, landmark=$8, city=$9,
       district=$10, state=$11, pincode=$12, type=$13 WHERE id = $1 AND user_id = $2 RETURNING *`,
      [req.params.id, req.user.id, ...addressValues(address)],
    );
    if (rows[0] && req.body.isDefault) {
      await db.query('UPDATE addresses SET is_default = (id = $2) WHERE user_id = $1', [req.user.id, req.params.id]);
      rows[0].is_default = true;
    }
    return rows[0];
  });
  if (!updated) return res.status(404).json({ error: 'Address not found' });
  res.json({ address: toAddress(updated) });
}));

app.post('/api/me/addresses/:id/default', auth, h(async (req, res) => {
  const found = await query('SELECT 1 FROM addresses WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  if (!found.rowCount) return res.status(404).json({ error: 'Address not found' });
  await query('UPDATE addresses SET is_default = (id = $2) WHERE user_id = $1', [req.user.id, req.params.id]);
  res.json({ ok: true });
}));

app.delete('/api/me/addresses/:id', auth, h(async (req, res) => {
  const deleted = await query('DELETE FROM addresses WHERE id = $1 AND user_id = $2 RETURNING is_default', [req.params.id, req.user.id]);
  if (!deleted.rowCount) return res.status(404).json({ error: 'Address not found' });
  if (deleted.rows[0].is_default) {
    await query(
      `UPDATE addresses SET is_default = true WHERE id = (
         SELECT id FROM addresses WHERE user_id = $1 ORDER BY created_at LIMIT 1)`,
      [req.user.id],
    );
  }
  res.json({ ok: true });
}));

// Products (for logged-in shoppers)
app.get('/api/products', auth, h(async (req, res) => {
  const { rows } = await query('SELECT * FROM products WHERE active ORDER BY created_at DESC');
  res.json({ products: rows.map(toProduct) });
}));

app.get('/api/products/:id', auth, h(async (req, res) => {
  const { rows } = await query('SELECT * FROM products WHERE id = $1 AND (active OR $2)', [req.params.id, req.user.role === 'admin']);
  if (!rows[0]) return res.status(404).json({ error: 'Product not found' });
  res.json({ product: toProduct(rows[0]) });
}));

// Orders
// Flow: /api/checkout creates an unpaid order + a Razorpay order. The customer pays in
// Razorpay Checkout, then /api/checkout/verify (or the webhook) checks Razorpay's signature
// and only then marks the order Paid. Unpaid orders are never shown to anyone.
class UserError extends Error {}
const UNPAID = 'Awaiting payment';

app.post('/api/checkout', auth, h(async (req, res) => {
  if (!razorpay.isConfigured()) return res.status(503).json({ error: 'Online payment is not set up yet. Please message us on Instagram.' });

  const addrRows = await query('SELECT * FROM addresses WHERE id = $1 AND user_id = $2', [req.body.addressId, req.user.id]);
  if (!addrRows.rowCount) return res.status(400).json({ error: 'Please add a delivery address before placing your order' });
  const { id: _id, isDefault, ...addressSnapshot } = toAddress(addrRows.rows[0]);

  const lines = Array.isArray(req.body.items) ? req.body.items.slice(0, 50) : [];
  if (!lines.length) return res.status(400).json({ error: 'Your cart is empty' });

  const items = [];
  try {
    for (const line of lines) {
      const qty = Number(line.qty);
      if (!Number.isInteger(qty) || qty < 1 || qty > 20) throw new UserError('Invalid quantity');
      const { rows } = await query('SELECT * FROM products WHERE id = $1 AND active', [String(line.productId)]);
      const product = rows[0];
      if (!product) throw new UserError('A product in your cart is no longer available');
      if (product.stock < qty) throw new UserError(`Only ${product.stock} left of "${product.name}"`);
      items.push({ productId: product.id, name: product.name, price: product.price, shipping: product.shipping, qty, image: product.images[0] || '' });
    }
  } catch (err) {
    if (err instanceof UserError) return res.status(400).json({ error: err.message });
    throw err;
  }

  const subtotal = items.reduce((s, i) => s + i.price * i.qty, 0);
  // Each product carries its own Speed Post charge, counted once per product (0 = free).
  const shipping = items.reduce((s, i) => s + i.shipping, 0);
  const total = subtotal + shipping;
  const number = orderNumber();

  let rzpOrder;
  try {
    rzpOrder = await razorpay.createOrder(total, number, { customer: req.user.email });
  } catch (err) {
    console.error('Razorpay order failed:', err.message);
    return res.status(502).json({ error: 'Could not start the payment. Please try again in a moment.' });
  }

  // Clear out checkouts that were never paid.
  await query(`DELETE FROM orders WHERE status = $1 AND created_at < now() - interval '2 days'`, [UNPAID]);
  const { rows } = await query(
    `INSERT INTO orders (id, number, user_id, customer, address, items, subtotal, shipping, total, payment_method, note, status, history, razorpay_order_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Razorpay',$10,$11,'[]',$12) RETURNING id`,
    [
      newId(), number, req.user.id,
      JSON.stringify({ name: req.user.name, email: req.user.email, phone: req.user.phone }),
      JSON.stringify(addressSnapshot), JSON.stringify(items),
      subtotal, shipping, total, str(req.body.note, 500), UNPAID, rzpOrder.id,
    ],
  );

  res.json({
    orderId: rows[0].id,
    razorpay: {
      key: razorpay.keyId(),
      order_id: rzpOrder.id,
      amount: rzpOrder.amount,
      currency: 'INR',
      name: 'Rinori Studio',
      description: `Order ${number}`,
      prefill: { name: req.user.name, email: req.user.email, contact: req.user.phone },
    },
  });
}));

// Marks an unpaid order as Paid exactly once, takes the stock and tells the customer.
async function markPaid(razorpayOrderId, paymentId) {
  return transaction(async db => {
    const { rows } = await db.query('SELECT * FROM orders WHERE razorpay_order_id = $1 FOR UPDATE', [razorpayOrderId]);
    if (!rows[0]) return null;
    const order = toOrder(rows[0]);
    if (order.status !== UNPAID) return order; // already handled (verify + webhook both arrive)

    let short = false;
    for (const item of order.items) {
      const r = await db.query('UPDATE products SET stock = stock - $2 WHERE id = $1 AND stock >= $2', [item.productId, item.qty]);
      if (!r.rowCount) short = true;
    }
    const message = short
      ? 'Payment received · some items sold out meanwhile, we will contact you'
      : 'Payment received · order placed';
    const entry = { status: 'Paid', message, at: new Date().toISOString() };
    const updated = await db.query(
      `UPDATE orders SET status = 'Paid', payment_ref = $2, created_at = now(), history = history || $3::jsonb WHERE id = $1 RETURNING *`,
      [order.id, paymentId, JSON.stringify([entry])],
    );
    const paid = toOrder(updated.rows[0]);
    if (paid.userId) {
      await notify(db, paid.userId, `Order ${paid.number} placed 🎀`,
        `Payment of ₹${paid.total} received. Thank you! We'll pack your order with love and share the Speed Post tracking number.`, { orderId: paid.id });
    }
    return paid;
  });
}

// Makes sure the money is actually captured (accounts without auto-capture leave it "authorized").
async function ensureCaptured(paymentId, amountPaise) {
  try {
    const payment = await razorpay.fetchPayment(paymentId);
    if (payment.status === 'authorized') await razorpay.capturePayment(paymentId, amountPaise);
  } catch (err) {
    console.error('Razorpay capture check failed:', err.message);
  }
}

app.post('/api/checkout/verify', auth, h(async (req, res) => {
  const orderId = str(req.body.razorpay_order_id, 80);
  const paymentId = str(req.body.razorpay_payment_id, 80);
  const signature = str(req.body.razorpay_signature, 200);
  if (!razorpay.verifyPaymentSignature(orderId, paymentId, signature)) {
    return res.status(400).json({ error: 'We could not confirm this payment. If money was deducted, please contact us with your payment ID.' });
  }
  const own = await query('SELECT total FROM orders WHERE razorpay_order_id = $1 AND user_id = $2', [orderId, req.user.id]);
  if (!own.rowCount) return res.status(404).json({ error: 'Order not found' });

  await ensureCaptured(paymentId, own.rows[0].total * 100);
  const order = await markPaid(orderId, paymentId);
  res.json({ order });
}));

// Razorpay webhook (Dashboard > Webhooks, events: payment.captured, order.paid).
// Catches payments where the customer closed the page before we heard back.
app.post('/api/razorpay/webhook', express.raw({ type: 'application/json', limit: '1mb' }), h(async (req, res) => {
  if (!razorpay.verifyWebhookSignature(req.body, req.get('X-Razorpay-Signature'))) return res.status(400).send('bad signature');
  const event = JSON.parse(req.body.toString('utf8'));
  const payment = event.payload?.payment?.entity;
  if (['payment.captured', 'order.paid'].includes(event.event) && payment?.order_id) {
    await markPaid(payment.order_id, payment.id);
  }
  res.send('ok');
}));

app.get('/api/orders', auth, h(async (req, res) => {
  const { rows } = await query('SELECT * FROM orders WHERE user_id = $1 AND status <> $2 ORDER BY created_at DESC', [req.user.id, UNPAID]);
  res.json({ orders: rows.map(toOrder) });
}));

// Changes an order's status inside a transaction, returning stock when it gets cancelled.
async function setOrderStatus(db, order, status, message) {
  if (status === 'Cancelled' && order.status !== 'Cancelled') {
    for (const item of order.items) {
      await db.query('UPDATE products SET stock = stock + $2 WHERE id = $1', [item.productId, item.qty]);
    }
  }
  const entry = { status, message, at: new Date().toISOString() };
  const { rows } = await db.query(
    'UPDATE orders SET status = $2, history = history || $3::jsonb WHERE id = $1 RETURNING *',
    [order.id, status, JSON.stringify([entry])],
  );
  return toOrder(rows[0]);
}

// Notifications
app.get('/api/notifications', auth, h(async (req, res) => {
  const { rows } = await query('SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100', [req.user.id]);
  res.json({ notifications: rows.map(toNotification) });
}));

app.post('/api/notifications/read', auth, h(async (req, res) => {
  await query('UPDATE notifications SET read = true WHERE user_id = $1 AND NOT read', [req.user.id]);
  res.json({ ok: true });
}));

// ---------- admin ----------

app.get('/api/admin/stats', adminOnly, h(async (req, res) => {
  const { rows: [s] } = await query(`
    SELECT
      (SELECT count(*)::int FROM orders WHERE status <> 'Awaiting payment') AS orders,
      (SELECT count(*)::int FROM orders WHERE status IN ('Paid','Packed')) AS to_ship,
      (SELECT coalesce(sum(total),0)::int FROM orders WHERE status NOT IN ('Cancelled','Awaiting payment')) AS revenue,
      (SELECT count(*)::int FROM users WHERE role = 'customer') AS customers,
      (SELECT count(*)::int FROM products) AS products`);
  const low = await query('SELECT id, name, stock FROM products WHERE stock <= 5 ORDER BY stock');
  res.json({ ...s, lowStock: low.rows });
}));

app.get('/api/admin/orders', adminOnly, h(async (req, res) => {
  const { rows } = await query("SELECT * FROM orders WHERE status <> 'Awaiting payment' ORDER BY created_at DESC");
  res.json({ orders: rows.map(toOrder), statuses: ORDER_STATUSES });
}));

app.put('/api/admin/orders/:id', adminOnly, h(async (req, res) => {
  const status = req.body.status;
  const message = str(req.body.message, 500);
  const tracking = str(req.body.trackingNumber, 40).toUpperCase();
  if (!ORDER_STATUSES.includes(status)) return res.status(400).json({ error: 'Unknown status' });

  const result = await transaction(async db => {
    const { rows } = await db.query("SELECT * FROM orders WHERE id = $1 AND status <> 'Awaiting payment' FOR UPDATE", [req.params.id]);
    if (!rows[0]) return { code: 404, error: 'Order not found' };
    const current = toOrder(rows[0]);
    const trackingChanged = tracking !== current.trackingNumber;
    if (status === current.status && !message && !trackingChanged) return { code: 400, error: 'Change the status, tracking number or write a message' };
    if (trackingChanged) await db.query('UPDATE orders SET tracking_number = $2 WHERE id = $1', [current.id, tracking]);
    const note = [message, trackingChanged && tracking ? `Speed Post tracking no: ${tracking}` : ''].filter(Boolean).join(' · ');
    const order = await setOrderStatus(db, current, status, note);
    if (order.userId) {
      await notify(db, order.userId, `Order ${order.number}: ${status}`, note || `Your order is now "${status}".`, { orderId: order.id });
    }
    return { order };
  });
  if (result.error) return res.status(result.code).json({ error: result.error });
  res.json(result);
}));

app.get('/api/admin/products', adminOnly, h(async (req, res) => {
  const { rows } = await query('SELECT * FROM products ORDER BY created_at DESC');
  res.json({ products: rows.map(toProduct) });
}));

function productFields(body) {
  const p = {
    name: str(body.name, 120),
    category: str(body.category, 60) || 'Handmade',
    description: str(body.description, 3000),
    price: Number(body.price),
    mrp: body.mrp ? Number(body.mrp) : null,
    shipping: body.shipping === '' || body.shipping === undefined ? 0 : Number(body.shipping),
    stock: Number(body.stock),
    active: body.active !== 'false',
  };
  if (!p.name) return { error: 'Product name is required' };
  if (!Number.isInteger(p.price) || p.price <= 0) return { error: 'Price must be a whole number of rupees above 0' };
  if (p.mrp !== null && (!Number.isInteger(p.mrp) || p.mrp < p.price)) return { error: 'MRP must be a whole number, at least the price' };
  if (!Number.isInteger(p.shipping) || p.shipping < 0) return { error: 'Shipping must be 0 (free) or a whole number of rupees' };
  if (!Number.isInteger(p.stock) || p.stock < 0) return { error: 'Stock must be 0 or more' };
  return { product: p };
}

async function notifyAllCustomers(db, title, message, productId) {
  await db.query(
    `INSERT INTO notifications (id, user_id, title, message, product_id)
     SELECT md5(random()::text || id), id, $1, $2, $3 FROM users WHERE role = 'customer'`,
    [title, message, productId],
  );
}

app.post('/api/admin/products', adminOnly, upload.array('images', config.maxProductImages), h(async (req, res) => {
  const { product, error } = productFields(req.body);
  if (error) return res.status(400).json({ error });
  if (!req.files?.length) return res.status(400).json({ error: 'Please add at least one photo' });

  const saved = await transaction(async db => {
    const images = [];
    for (const f of req.files) images.push(await saveImage(db, f.buffer, f.mimetype));
    const { rows } = await db.query(
      `INSERT INTO products (id, name, category, description, price, mrp, shipping, stock, active, images)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [newId(), product.name, product.category, product.description, product.price, product.mrp, product.shipping, product.stock, product.active, JSON.stringify(images)],
    );
    if (req.body.notify === 'true' && product.active) {
      await notifyAllCustomers(db, 'New in the studio ✨', `"${product.name}" just arrived for ₹${product.price}. Come take a look!`, rows[0].id);
    }
    return toProduct(rows[0]);
  });
  res.json({ product: saved });
}));

app.put('/api/admin/products/:id', adminOnly, upload.array('images', config.maxProductImages), h(async (req, res) => {
  const { product, error } = productFields(req.body);
  if (error) return res.status(400).json({ error });

  let keep = [];
  try { keep = JSON.parse(req.body.keepImages || '[]'); } catch { /* ignore */ }

  const result = await transaction(async db => {
    const { rows } = await db.query('SELECT * FROM products WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!rows[0]) return { code: 404, error: 'Product not found' };
    const existing = toProduct(rows[0]);

    const images = keep.filter(src => existing.images.includes(src));
    for (const f of req.files || []) images.push(await saveImage(db, f.buffer, f.mimetype));
    if (!images.length) return { code: 400, error: 'Please keep or add at least one photo' };
    if (images.length > config.maxProductImages) return { code: 400, error: `A product can have up to ${config.maxProductImages} photos` };

    const removed = existing.images.filter(src => !images.includes(src) && src.startsWith('/images/'));
    if (removed.length) {
      const used = await db.query(
        "SELECT DISTINCT item->>'image' AS src FROM orders, jsonb_array_elements(items) item WHERE item->>'image' = ANY($1)",
        [removed],
      );
      const unused = removed.filter(src => !used.rows.some(r => r.src === src));
      if (unused.length) await db.query('DELETE FROM images WHERE id = ANY($1)', [unused.map(src => src.slice(8))]);
    }

    const updated = await db.query(
      `UPDATE products SET name=$2, category=$3, description=$4, price=$5, mrp=$6, shipping=$7, stock=$8, active=$9, images=$10
       WHERE id = $1 RETURNING *`,
      [existing.id, product.name, product.category, product.description, product.price, product.mrp, product.shipping, product.stock, product.active, JSON.stringify(images)],
    );

    if (req.body.notify === 'true' && product.active) {
      const back = existing.stock === 0 && product.stock > 0;
      await notifyAllCustomers(
        db,
        back ? 'Back in stock 🌸' : 'Product update',
        back ? `"${product.name}" is back in stock. Grab yours before it's gone!` : `"${product.name}" has been updated. Now ₹${product.price}.`,
        existing.id,
      );
    }
    return { product: toProduct(updated.rows[0]) };
  });
  if (result.error) return res.status(result.code).json({ error: result.error });
  res.json(result);
}));

app.delete('/api/admin/products/:id', adminOnly, h(async (req, res) => {
  const { rows } = await query('DELETE FROM products WHERE id = $1 RETURNING images', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Product not found' });
  // Keep the photos: past orders still show them.
  res.json({ ok: true });
}));

app.get('/api/admin/payments', adminOnly, (req, res) => {
  res.json({ ...paymentStatus(), webhookUrl: `${req.protocol}://${req.get('host')}/api/razorpay/webhook` });
});

app.get('/api/admin/users', adminOnly, h(async (req, res) => {
  const { rows } = await query(`
    SELECT u.*,
      (SELECT count(*)::int FROM orders o WHERE o.user_id = u.id AND o.status <> 'Awaiting payment') AS order_count,
      (SELECT coalesce(sum(total),0)::int FROM orders o WHERE o.user_id = u.id AND o.status NOT IN ('Cancelled','Awaiting payment')) AS total_spent
    FROM users u WHERE role = 'customer' ORDER BY created_at DESC`);
  const addresses = await query(
    "SELECT a.* FROM addresses a JOIN users u ON u.id = a.user_id WHERE u.role = 'customer' ORDER BY a.is_default DESC, a.created_at",
  );
  const byUser = {};
  addresses.rows.forEach(a => (byUser[a.user_id] ||= []).push(toAddress(a)));
  res.json({
    users: rows.map(r => ({ ...toUser(r), orderCount: r.order_count, totalSpent: r.total_spent, addresses: byUser[r.id] || [] })),
  });
}));

app.post('/api/admin/notify', adminOnly, h(async (req, res) => {
  const title = str(req.body.title, 120);
  const message = str(req.body.message, 1000);
  if (!title || !message) return res.status(400).json({ error: 'Title and message are required' });

  const productRow = req.body.productId ? await query('SELECT id FROM products WHERE id = $1', [req.body.productId]) : null;
  const productId = productRow?.rows[0]?.id || null;

  if (req.body.userId === 'all') {
    const { rows } = await query("SELECT count(*)::int AS n FROM users WHERE role = 'customer'");
    if (!rows[0].n) return res.status(400).json({ error: 'No customers yet' });
    await notifyAllCustomers({ query }, title, message, productId);
    return res.json({ sent: rows[0].n });
  }
  const target = await query("SELECT id FROM users WHERE id = $1 AND role = 'customer'", [req.body.userId]);
  if (!target.rowCount) return res.status(400).json({ error: 'Customer not found' });
  await notify({ query }, target.rows[0].id, title, message, { productId });
  res.json({ sent: 1 });
}));

// ---------- static files ----------

app.use('/assets', express.static(path.join(__dirname, 'assets'), { maxAge: '7d' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.message?.startsWith('Only JPG')) {
    const messages = {
      LIMIT_FILE_SIZE: 'Each photo must be under 5 MB',
      LIMIT_FILE_COUNT: `You can upload up to ${config.maxProductImages} photos at a time`,
    };
    return res.status(400).json({ error: messages[err.code] || err.message });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

init()
  .then(() => app.listen(config.port, () => console.log(`Rinori Studio running at http://localhost:${config.port}`)))
  .catch(err => {
    console.error('Could not start:', err);
    process.exit(1);
  });
