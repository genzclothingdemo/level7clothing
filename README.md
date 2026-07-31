# 🎨 Level7 Clothing — Resin Art E‑commerce

> 🟢 **New here? Start with [SETUP-GUIDE.md](./SETUP-GUIDE.md)** — a step-by-step guide in simple language covering everything: running locally, email setup, and going live on Vercel.

A modern, premium storefront **and** admin dashboard for a handmade resin‑art brand.
Built as a single Next.js app so it deploys to **Vercel in one click**.

- **Storefront:** home, shop (search / filter / sort), product pages, cart, checkout (Cash on Delivery), order confirmation, about, contact.
- **Admin panel** (`/admin`): dashboard, full product management, orders, **interested customers** (anyone who adds to cart), contact inquiries, and **branding + contact settings** you can edit yourself.
- **Emails:** admin gets a **lead** email when someone adds to cart, and an **order** email (plus a confirmation to the customer) on purchase.
- **Light + dark theme** toggle, premium light theme by default.

Everything — brand name, logo, tagline, hero text, contact details, shipping, announcement bar — is editable from **Admin → Branding & settings**. No code needed.

---

## 🧰 Tech stack

| Part | Tech |
|---|---|
| Framework | Next.js 16 (App Router) + React 19 + TypeScript |
| Styling | Tailwind CSS v4, premium light/dark theme |
| Database | PostgreSQL via **Vercel Postgres / Neon** (Prisma ORM) |
| Images | **Vercel Blob** (or paste image URLs) |
| Email | **Resend** |
| Hosting | **Vercel** |

---

## 🚀 Part 1 — Run it on your computer

You already have Node.js installed. Open a terminal **in this `level7clothing` folder**.

### Step 1 — Create a free database (2 minutes)

You need a Postgres database. The easiest free option is **Neon** (this is also what Vercel Postgres uses).

1. Go to **https://neon.tech** and sign up (free).
2. Create a new project. Neon shows you a **connection string** that looks like:
   `postgresql://user:pass@ep-xxx.aws.neon.tech/neondb?sslmode=require`
3. Neon gives you two URLs — a **pooled** one and a **direct** one. Copy both.
   (If you only see one, use the same value for both.)

### Step 2 — Fill in your settings

Open the file named **`.env`** in this folder and paste your database URLs:

```env
DATABASE_URL="your-pooled-neon-url"
DIRECT_URL="your-direct-neon-url"
AUTH_SECRET="type-any-long-random-text-here"
ADMIN_EMAIL="admin@level7clothing.com"
ADMIN_PASSWORD="choose-a-password"
```

> `AUTH_SECRET` can be any long random string — it just keeps your admin login secure.

### Step 3 — Set up the database + sample products

Run this once:

```bash
npm run setup
```

This creates all the tables and loads **10 sample resin products** plus your admin account.

### Step 4 — Start the website

```bash
npm run dev
```

Open **http://localhost:3000** — that's your store. 🎉

- **Admin panel:** http://localhost:3000/admin
- **Login:** the `ADMIN_EMAIL` / `ADMIN_PASSWORD` you set in `.env`
  (default: `admin@level7clothing.com` / `level7admin123`)

---

## ✉️ Part 2 — Turn on email (optional, recommended)

Without this, the site works fine — emails are just skipped.

1. Sign up free at **https://resend.com**.
2. Create an **API key** and copy it.
3. In `.env`, set:
   ```env
   RESEND_API_KEY="re_your_key"
   EMAIL_FROM="Level7 Clothing <onboarding@resend.dev>"
   ```
4. Restart `npm run dev`.

> `onboarding@resend.dev` works immediately but can only email **your own** Resend account address. To email any customer, add your own domain in Resend (free) and change `EMAIL_FROM` to something like `orders@yourdomain.com`.
>
> Where do emails go? To the **"Send order & lead emails to"** address in **Admin → Branding & settings**.

---

## 🖼️ Part 3 — Product image uploads (optional)

You can always **paste an image URL** when adding a product — that needs no setup.
To upload image files directly, add a **Vercel Blob** store (see deploy section) and copy its `BLOB_READ_WRITE_TOKEN` into `.env`.

---

## ☁️ Part 4 — Deploy to Vercel (go live)

### Step 1 — Put the code on GitHub

1. Create a new repository on **https://github.com** (e.g. `level7clothing`).
2. In this folder:
   ```bash
   git add .
   git commit -m "Level7 Clothing store"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/level7clothing.git
   git push -u origin main
   ```

### Step 2 — Import to Vercel

1. Go to **https://vercel.com**, sign in with GitHub.
2. **Add New → Project →** pick your `level7clothing` repo → **Import**.
3. Don't deploy yet — first add storage (next step).

### Step 3 — Add the database + image storage (inside Vercel)

1. In your new Vercel project → **Storage** tab.
2. **Create Database → Postgres** (Neon). Vercel automatically adds `DATABASE_URL` / `DIRECT_URL` for you.
3. **Create → Blob** store. Vercel automatically adds `BLOB_READ_WRITE_TOKEN`.

### Step 4 — Add your other environment variables

In **Settings → Environment Variables**, add:

| Name | Value |
|---|---|
| `AUTH_SECRET` | any long random string |
| `ADMIN_EMAIL` | your admin email |
| `ADMIN_PASSWORD` | your admin password |
| `RESEND_API_KEY` | your Resend key (if using email) |
| `EMAIL_FROM` | e.g. `Level7 Clothing <onboarding@resend.dev>` |

### Step 5 — Deploy, then load the tables + sample data

1. Click **Deploy**. Wait for it to finish.
2. Load the database **once**. On your computer, temporarily set `DATABASE_URL` and `DIRECT_URL` in your local `.env` to the **Vercel Postgres** values (copy them from Vercel → Storage → your DB → `.env.local` tab), then run:
   ```bash
   npm run setup
   ```
   This fills your live database with tables + sample products. (You only do this once.)
3. Visit your live URL. Done — your store is online. 🚀

> **Tip:** After going live, log into `/admin` and change everything under **Branding & settings** to your real details, then delete the sample products and add your own.

---

## 💳 Razorpay (add later)

Online payments aren't enabled yet — checkout uses **Cash on Delivery**, and other options show as "coming soon". When you're ready, get Razorpay API keys and they can be wired into the existing checkout + order flow.

---

## 🗂️ How the admin panel works

| Page | What it does |
|---|---|
| **Dashboard** | Revenue, orders, products, leads and inquiries at a glance |
| **Products** | Add / edit / delete products; change price, description, category, tags, images, stock; hide or feature items |
| **Orders** | Every order with customer details; update status (pending → delivered), mark paid |
| **Interested customers** | Everyone who added something to cart — your warm leads |
| **Inquiries** | Contact‑form messages; mark read / delete |
| **Branding & settings** | Brand name, logo, tagline, hero text, contact info, socials, shipping, announcement bar, and the email that gets notifications |

---

## 📁 Project structure

```
level7clothing/
├── prisma/
│   ├── schema.prisma        # database models
│   └── seed.ts              # sample products + admin
├── src/
│   ├── app/
│   │   ├── (store)/         # storefront pages (home, shop, product, cart, checkout, …)
│   │   ├── admin/           # admin login + dashboard + management pages
│   │   ├── actions/         # server actions (orders, contact, auth, admin)
│   │   ├── api/             # /api/leads (add-to-cart) and /api/upload (images)
│   │   └── layout.tsx       # root layout, theme + providers
│   ├── components/          # UI, storefront, admin components
│   ├── context/             # cart + settings providers
│   └── lib/                 # prisma, auth, email, settings, products, utils
└── .env                     # your secrets (not committed)
```

---

## 🧑‍💻 Useful commands

```bash
npm run dev        # start local dev server
npm run build      # production build
npm run setup      # create tables + load sample data
npm run db:seed    # reload sample data
npm run db:studio  # open a visual database browser
```
# level7clothing
# level7clothing
