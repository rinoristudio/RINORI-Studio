// Creates the admin login, or gives an existing one a fresh password.
// Usage: npm run set-admin -- you@example.com [password]
// Without a password, a random one is made. It is printed once and never stored in code or files.
try { process.loadEnvFile(); } catch { /* use real environment variables */ }

const crypto = require('crypto');
const { pool, query, SCHEMA } = require('../db');
const { hashPassword } = require('../passwords');

async function main() {
  const email = String(process.argv[2] || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error('Usage: npm run set-admin -- you@example.com');
    process.exitCode = 1;
    return;
  }

  const chosen = process.argv[3];
  if (chosen !== undefined && chosen.length < 8) {
    console.error('Password must be at least 8 characters');
    process.exitCode = 1;
    return;
  }

  await query(SCHEMA);
  const password = chosen ?? 'Rs-' + crypto.randomBytes(12).toString('base64url');
  const { rows } = await query('SELECT id FROM users WHERE email = $1', [email]);

  if (rows[0]) {
    await query("UPDATE users SET role = 'admin', password_hash = $2 WHERE id = $1", [rows[0].id, hashPassword(password)]);
    await query('DELETE FROM sessions WHERE user_id = $1', [rows[0].id]); // log out old sessions
    console.log(`Updated admin: ${email}`);
  } else {
    await query(
      "INSERT INTO users (id, role, name, email, password_hash) VALUES ($1,'admin','Rinori Admin',$2,$3)",
      [crypto.randomBytes(8).toString('hex'), email, hashPassword(password)],
    );
    console.log(`Created admin: ${email}`);
  }
  console.log(`Password:     ${password}`);
  console.log('Save it somewhere safe. It will not be shown again.');
}

main()
  .catch(err => {
    console.error('Could not set admin:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
