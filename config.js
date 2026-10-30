// Store settings. Values can be overridden with environment variables.
// UPI ID / QR code are set from the admin panel (Settings tab).
module.exports = {
  port: Number(process.env.PORT) || 3000,

  // Admin account (created automatically on first start).
  // CHANGE THE PASSWORD before putting the site online.
  adminEmail: (process.env.ADMIN_EMAIL || 'admin@rinoristudio.com').toLowerCase(),
  adminPassword: process.env.ADMIN_PASSWORD || 'Rinori@Admin2026',

  // Most photos one product can have.
  maxProductImages: 10,
};
