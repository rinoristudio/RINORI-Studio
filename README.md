# Rinori Studio 🌸

Online shop for Rinori Studio's handmade products. It's a Node.js (Express) app with a PostgreSQL database on **Neon**, deployed as one web service on **Render**. The same service serves both the pages and the API.

## What's inside

**Customers**
- Sign up / log in (sign-up asks for name, email, mobile and password)
- After sign-up they're asked for a delivery address: name, mobile, alternate mobile, house/flat, street/area, landmark, pincode, city, district, state, and address type. They can skip this and add it later, but **an order can't be placed without an address**
- Home page: logo hero, category badges, products with prices
- Product page, cart and checkout with **Razorpay** (UPI, cards, netbanking, wallets). **An order is created only after Razorpay confirms the payment**. The server checks Razorpay's signature, so nobody can place an order without paying
- **Shipping is set on each product** (₹ amount, or 0 for free) and is charged once per product in the order. Delivery is by India Post Speed Post
- My Account: order timeline, Speed Post tracking number, updates from the studio, saved addresses, profile
- Contact: Instagram [@rinori.studio](https://www.instagram.com/rinori.studio/) and rinoristudio@gmail.com (edit `CONTACT` in `public/js/common.js`)

**Admin** (`/admin`)
- Dashboard: orders, revenue, customers, low-stock alerts
- Orders: only paid orders appear, with full customer and address details and the Razorpay payment ID. Move the order along: Paid → Packed → Shipped (add the Speed Post tracking number) → Delivered, or Cancelled (stock is returned; refund from the Razorpay dashboard). Each change notifies the customer
- Products: add, edit, hide or delete, upload up to 10 photos, set price, MRP, Speed Post shipping charge (0 = free) and stock, and optionally notify every customer ("New in the studio", "Back in stock")
- Payments: shows whether Razorpay is connected (test or live) and whether the webhook is set up
- Customers: list with contact details and addresses
- Send update: message all customers or one customer, optionally linked to a product

Product photos are stored in the database. Render's disk is wiped on every deploy, so photos saved there would be lost.

## Project layout

```
server.js        API + page serving
scripts/         set-admin.js: create the admin or reset its password
db.js            Postgres connection and table setup (tables are created automatically)
config.js        admin login defaults, shipping charges
public/          pages (index = login/sign-up, home, product, cart, address, account, admin)
assets/          logo and first product photos (loaded into the DB on first start)
render.yaml      Render blueprint
```

## 1. Set up Neon

1. Create a project at https://neon.tech.
2. Open **Connect** and copy the connection string. It looks like `postgresql://...neon.tech/neondb?sslmode=require`.

On first start the app creates the tables and the first product (Starry Mist Organza Scrunchie, ₹80). Create the admin login with `npm run set-admin` (see below).

## 2. Run on your computer

```bash
npm install
cp .env.example .env      # then paste your Neon DATABASE_URL
npm run set-admin -- you@example.com
npm start
```

Open http://localhost:3000.

## 3. Deploy on Render

1. Push this folder to a GitHub repo (`.env` is git-ignored, so your secrets stay local).
2. On Render, go to **New → Blueprint** and pick the repo. Render reads `render.yaml`.
3. When asked, fill in `DATABASE_URL` (your Neon connection string).
4. Deploy. Your site will be at `https://rinori-studio.onrender.com` (or similar).

Without the blueprint, choose **New → Web Service**, set build command `npm ci`, start command `npm start`, and add the `DATABASE_URL` environment variable.

> Render's free plan sleeps after about 15 minutes idle, so the first visit afterwards takes 30 to 60 seconds. Use a paid instance for a live shop.

## 4. Connect Razorpay

1. In the Razorpay Dashboard, go to **Account & Settings → API Keys** and generate a key. Start with **Test mode** keys (`rzp_test_…`) to try it without real money.
2. In Render → your service → **Environment**, add `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`. Render redeploys by itself.
3. **Webhook (recommended):** in Razorpay → **Webhooks → Add New Webhook**:
   - URL: `https://YOUR-SITE.onrender.com/api/razorpay/webhook`
   - Secret: make up a long random text
   - Events: `payment.captured` and `order.paid`

   Then add the same secret in Render as `RAZORPAY_WEBHOOK_SECRET`. This confirms orders even if a customer closes the page right after paying.
4. Admin → **Payments** shows whether everything is connected. When test orders work, switch to **Live mode** keys (`rzp_live_…`). Razorpay must have activated your account first.

## Admin login

The admin email and password are **not stored in the code or in any file**. Create the admin, or reset a forgotten password, from this folder with your Neon `DATABASE_URL` in `.env`:

```bash
npm run set-admin -- rinoristudio@gmail.com
```

It prints a new random password once. To pick your own (at least 8 characters), add it at the end: `npm run set-admin -- rinoristudio@gmail.com yourpassword`. Each run replaces the old password and logs that account out everywhere. Then log in at `/admin`.

## Notes

- Unpaid checkouts (customer opened Razorpay but didn't pay) are never shown and are deleted after 2 days.
- The cart is saved in the customer's browser. Orders, addresses and everything else are saved in Neon.
