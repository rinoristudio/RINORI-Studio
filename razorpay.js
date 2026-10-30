// Minimal Razorpay client: orders, payment checks and signature verification.
// Keys come from the environment (Render dashboard / .env), never from code.
const crypto = require('crypto');

const API = 'https://api.razorpay.com/v1';
const keyId = () => process.env.RAZORPAY_KEY_ID || '';
const keySecret = () => process.env.RAZORPAY_KEY_SECRET || '';

const isConfigured = () => Boolean(keyId() && keySecret());
const mode = () => (keyId().startsWith('rzp_live_') ? 'live' : keyId().startsWith('rzp_test_') ? 'test' : '');

async function call(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${keyId()}:${keySecret()}`).toString('base64'),
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error?.description || `Razorpay request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// amount is in rupees; Razorpay works in paise.
function createOrder(amount, receipt, notes) {
  return call('POST', '/orders', { amount: amount * 100, currency: 'INR', receipt, notes });
}

const fetchPayment = id => call('GET', `/payments/${encodeURIComponent(id)}`);
const capturePayment = (id, amountPaise) => call('POST', `/payments/${encodeURIComponent(id)}/capture`, { amount: amountPaise, currency: 'INR' });

function safeEqualHex(a, b) {
  const x = Buffer.from(String(a), 'utf8');
  const y = Buffer.from(String(b), 'utf8');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// Checkout success: signature = HMAC_SHA256(order_id + "|" + payment_id, key_secret)
function verifyPaymentSignature(orderId, paymentId, signature) {
  if (!keySecret()) return false;
  const expected = crypto.createHmac('sha256', keySecret()).update(`${orderId}|${paymentId}`).digest('hex');
  return safeEqualHex(expected, signature);
}

// Webhook: signature = HMAC_SHA256(raw request body, webhook_secret)
function verifyWebhookSignature(rawBody, signature) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqualHex(expected, signature);
}

module.exports = {
  keyId, isConfigured, mode, createOrder, fetchPayment, capturePayment,
  verifyPaymentSignature, verifyWebhookSignature,
  webhookConfigured: () => Boolean(process.env.RAZORPAY_WEBHOOK_SECRET),
};
