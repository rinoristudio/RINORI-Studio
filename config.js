// Store settings. UPI ID / QR code are set from the admin panel (Settings tab).
// The admin login is never kept in code: see "Admin login" in README.md.
module.exports = {
  port: Number(process.env.PORT) || 3000,

  // Most photos one product can have.
  maxProductImages: 10,
};
