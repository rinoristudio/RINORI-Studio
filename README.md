# Rinori Studio 🌸

Online shop for Rinori Studio's handmade products. It's a Node.js (Express) app with a PostgreSQL database on **Neon**, deployed as one web service on **Render**. The same service serves both the pages and the API.

## What's inside

**Customers**
- Sign up / log in (sign-up asks for name, email, mobile and password)
- After sign-up they're asked for a delivery address: name, mobile, alternate mobile, house/flat, street/area, landmark, pincode, city, district, state, and address type. They can skip this and add it later, but **an order can't be placed without an address**
- Home page: logo hero, category badges, products with prices
- Product page, cart and checkout with **UPI payment**: the customer pays to your UPI ID or QR code and enters the transaction ID (UTR)
- **Shipping is set on each product** (₹ amount, or 0 for free) and is charged once per product in the order. Delivery is by India Post Speed Post
- My Account: order timeline, Speed Post tracking number, updates from the studio, saved addresses, profile
- Contact: Instagram [@rinori.studio](https://www.instagram.com/rinori.studio/) and rinoristudio@gmail.com (edit `CONTACT` in `public/js/common.js`)

**Admin** (`/admin`)
- Dashboard: orders, revenue, customers, low-stock alerts
- Orders: full customer and address details plus the customer's UPI transaction ID. Move the order along: Placed (payment to check) → Payment verified → Packed → Shipped (add the Speed Post tracking number) → Delivered, or Cancelled. Each change notifies the customer
- Products: add, edit, hide or delete, upload up to 10 photos, set price, MRP, Speed Post shipping charge (0 = free) and stock, and optionally notify every customer ("New in the studio", "Back in stock")
- Settings: your UPI ID, the name shown to customers, and an optional QR code image. **Customers can't place orders until a UPI ID is saved here**
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

## Admin login

The admin email and password are **not stored in the code or in any file**. Create the admin, or reset a forgotten password, from this folder with your Neon `DATABASE_URL` in `.env`:

```bash
npm run set-admin -- rinoristudio@gmail.com
```

It prints a new random password once. To pick your own (at least 8 characters), add it at the end: `npm run set-admin -- rinoristudio@gmail.com yourpassword`. Each run replaces the old password and logs that account out everywhere. Then log in at `/admin`.

## Notes

- Payments are checked by hand: open your UPI or bank app, find the UTR the customer entered, then mark the order "Payment verified". A gateway such as Razorpay can be added later for automatic checks.
- The cart is saved in the customer's browser. Orders, addresses and everything else are saved in Neon.
