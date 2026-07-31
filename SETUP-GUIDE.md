# 🎨 Level7 Clothing — Setup & Deployment Guide

**Read this from top to bottom. Do the steps in order. Copy-paste the commands.**

This guide has 5 parts:

| Part | What it does | Time |
|------|--------------|------|
| **Part 1** | Run the website on your computer | ~10 min |
| **Part 2** | Turn on email notifications | ~5 min (optional) |
| **Part 3** | Put your website LIVE on the internet (Vercel) | ~15 min |
| **Part 4** | After going live — first things to do | ~10 min |
| **Part 5** | Common problems & fixes | (when needed) |

---

---

# 🖥️ PART 1 — Run the website on your computer

## Step 1.1 — Open the project folder in terminal

Open **PowerShell** (press `Windows key`, type `powershell`, press Enter).

Then paste this command and press Enter:

```powershell
cd "C:\Users\15ind\OneDrive\Desktop\Quellflow\code\ResinArt\level7clothing"
```

> 💡 This just moves you "inside" the project folder. All other commands must be run from here.

---

## Step 1.2 — Create a free database (Neon)

The website needs a **database** to store products, orders, and customers. We use **Neon** — it's free.

1. Go to 👉 **https://neon.tech**
2. Click **Sign Up** → sign up with your Google account (easiest).
3. It will ask you to create a project:
   - **Project name:** `level7clothing` (or anything)
   - **Region:** choose **AWS Asia Pacific (Singapore)** — closest to India
   - Click **Create**
4. After creating, you'll see a **"Connection string"** box. It looks like this:

   ```
   postgresql://neondb_owner:AbC123xyz@ep-cool-name-123.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
   ```

5. **Important:** There is a small dropdown/toggle near the connection string:
   - Copy the **"Pooled connection"** version → this is your `DATABASE_URL`
   - Copy the **"Direct connection"** version (uncheck "pooled" or pick "direct") → this is your `DIRECT_URL`

   > 😕 **Can't find two versions?** No problem — just copy the one string you see and use it for BOTH values in the next step.

---

## Step 1.3 — Fill in your settings (.env file)

1. Open the project folder in **File Explorer**:
   `Desktop → Quellflow → code → ResinArt → level7clothing`
2. Find the file named **`.env`** and open it with **Notepad**
   (right-click → Open with → Notepad).

   > 😕 **Can't see the .env file?** In File Explorer, click **View → Show → File name extensions** and **Hidden items**.

3. Replace the content so it looks like this (paste YOUR Neon URLs from Step 1.2):

```env
DATABASE_URL="paste-your-POOLED-neon-url-here"
DIRECT_URL="paste-your-DIRECT-neon-url-here"

AUTH_SECRET="level7clothing-super-secret-key-12345-change-this-to-anything-random"

ADMIN_EMAIL="admin@level7clothing.com"
ADMIN_PASSWORD="level7admin123"
```

4. **Save the file** (Ctrl + S) and close Notepad.

> 💡 What these mean:
> - `DATABASE_URL` / `DIRECT_URL` → your database address
> - `AUTH_SECRET` → any long random text; it protects your admin login
> - `ADMIN_EMAIL` / `ADMIN_PASSWORD` → what YOU will use to log in to the admin panel. **Change the password to something strong!**

---

## Step 1.4 — Create the database tables + sample products

Back in PowerShell (still inside the level7clothing folder), run:

```powershell
npm run setup
```

Wait ~30 seconds. You should see:

```
✓ Site settings ready
✓ Admin ready → admin@level7clothing.com / level7admin123
✓ Demo customer → customer@level7clothing.com / customer123
✓ Seeded 10 products
```

🎉 Your database now has 10 sample resin products, your admin account, and a demo
customer account you can use to test login + order tracking.

> ❌ **Got an error?** Jump to Part 5 (Troubleshooting) at the bottom.

---

## Step 1.5 — Start the website!

Run:

```powershell
npm run dev
```

Wait until you see `Ready`. Then open your browser and go to:

| Page | Address |
|------|---------|
| 🛍️ **Your store** | http://localhost:3000 |
| 👤 **Customer account** | http://localhost:3000/account |
| 🔐 **Admin panel** | http://localhost:3000/admin |

**Admin login:** the email + password you put in the `.env` file
(default: `admin@level7clothing.com` / `level7admin123`)

**Two-tier customer capture:**

1. **Add to cart → mini sign-up.** The first time a visitor adds any product to
   their cart, a small popup asks for just their **name + mobile number**. It's
   saved in a cookie on their device, so they're never asked again. You see every
   one of these as a lead in **Admin → Interested customers** (with their name &
   phone) — even if they never complete an order.
2. **Place an order → full login / sign-up.** At checkout they must log in or
   create an account (fast 3-field signup), which collects the full details
   (address, email, payment mode, etc.). They can then track every order — with a
   live status timeline — under **My account**.

Try the demo customer: `customer@level7clothing.com` / `customer123`.

> 💡 To **stop** the website, go back to PowerShell and press `Ctrl + C`.
> To start again later: open PowerShell, `cd` into the folder (Step 1.1), then `npm run dev`.

---

---

# ✉️ PART 2 — Turn on email notifications (optional but recommended)

Without this, the website still works 100% — it just doesn't send emails.
With this, you get an email when someone **adds to cart (lead)** or **places an order**.

## Step 2.1 — Create a free Resend account

1. Go to 👉 **https://resend.com**
2. Sign up (free — 100 emails/day, 3,000/month).
3. In the left menu click **API Keys** → **Create API Key**
   - Name: `level7clothing`
   - Permission: **Sending access**
   - Click **Create**
4. **Copy the key** (starts with `re_...`). ⚠️ It's shown only once — copy it now!

## Step 2.2 — Add the key to your .env file

Open `.env` in Notepad again and **add these two lines** at the bottom:

```env
RESEND_API_KEY="re_paste_your_key_here"
EMAIL_FROM="Level7 Clothing <onboarding@resend.dev>"
```

Save the file. If the website is running, stop it (`Ctrl + C`) and start again (`npm run dev`).

## Step 2.3 — Important: where do the emails go?

- Emails are sent **to** the address set in **Admin panel → Branding & settings → "Send order & lead emails to"**.
- ⚠️ **Free limitation:** with `onboarding@resend.dev` as sender, Resend only delivers to **the same email address you signed up to Resend with**. So set "Send order & lead emails to" = your Resend signup email.
- Later, to send emails to *any* customer: in Resend click **Domains → Add Domain**, add your own domain (like `level7clothing.com`), follow their DNS steps, then change `EMAIL_FROM` to `Level7 Clothing <orders@level7clothing.com>`.

---

---

# 🌍 PART 3 — Put your website LIVE (Deploy to Vercel)

After this part, your website will have a real address like `https://level7clothing.vercel.app` that anyone can visit.

## Step 3.1 — Create a GitHub account & repository

GitHub stores your code online. Vercel reads it from there.

1. Go to 👉 **https://github.com** and sign up (free).
2. Click the **+** (top right) → **New repository**
   - Repository name: `level7clothing`
   - Keep it **Private**
   - **Don't** tick any checkboxes (no README, no gitignore)
   - Click **Create repository**
3. Keep this page open — you'll need your username.

## Step 3.2 — Upload your code to GitHub

In PowerShell (inside the level7clothing folder), run these commands **one at a time**.

> Replace `YOUR_USERNAME` with your actual GitHub username in the 4th command!

```powershell
git add .
```

```powershell
git commit -m "Level7 Clothing store - first version"
```

```powershell
git branch -M main
```

```powershell
git remote add origin https://github.com/YOUR_USERNAME/level7clothing.git
```

```powershell
git push -u origin main
```

> 💡 The last command may open a browser window asking you to log in to GitHub — do it and click **Authorize**.
>
> ✅ **Check it worked:** refresh your GitHub repository page — you should see all the project files.
>
> 🔒 **Don't worry:** your `.env` file (with passwords) is automatically **excluded** from the upload. It stays only on your computer.

## Step 3.3 — Connect Vercel

1. Go to 👉 **https://vercel.com**
2. Click **Sign Up** → **Continue with GitHub** (this links the two accounts).
3. On your Vercel dashboard click **Add New… → Project**.
4. You'll see your `level7clothing` repository → click **Import**.
5. **⚠️ STOP — don't click Deploy yet!** First we add the settings (next step).

## Step 3.4 — Add your settings (Environment Variables) in Vercel

On the same import screen, open the **Environment Variables** section and add these **one by one** (Name on the left, Value on the right, then click Add):

| Name | Value |
|------|-------|
| `DATABASE_URL` | your **pooled** Neon URL (same as in your `.env`) |
| `DIRECT_URL` | your **direct** Neon URL (same as in your `.env`) |
| `AUTH_SECRET` | the same random text from your `.env` |
| `ADMIN_EMAIL` | your admin email |
| `ADMIN_PASSWORD` | your admin password |
| `RESEND_API_KEY` | your Resend key (only if you did Part 2) |
| `EMAIL_FROM` | `Level7 Clothing <onboarding@resend.dev>` (only if you did Part 2) |

> 💡 Easiest way: open your `.env` file in Notepad side-by-side and copy each value across. Don't include the quote marks `"` in Vercel.

## Step 3.5 — Deploy! 🚀

1. Now click the big **Deploy** button.
2. Wait 2–3 minutes. You'll see confetti 🎉 when it's done.
3. Click **Visit** (or the preview image) — that's your **LIVE website!**

Your live addresses:

| Page | Address |
|------|---------|
| 🛍️ Store | `https://level7clothing-xxxx.vercel.app` |
| 🔐 Admin | `https://level7clothing-xxxx.vercel.app/admin` |

> 💡 Your database already has the products (you set it up in Part 1) — the live site uses the **same** Neon database, so everything is already there!

## Step 3.6 — (Optional) Turn on image uploads

Right now, when adding a product you can **paste an image URL** (works fine). To also **upload image files** from your computer:

1. In Vercel, open your project → **Storage** tab → **Create Database** → choose **Blob** → Create.
2. Vercel automatically connects it (adds `BLOB_READ_WRITE_TOKEN` for you).
3. Go to **Deployments** tab → click the **⋯** menu on the latest one → **Redeploy**.

Done — the Upload button in the admin panel now works on your live site.

> 💡 To make uploads also work on your computer: Vercel → Storage → your Blob store → **`.env.local` tab** → copy the `BLOB_READ_WRITE_TOKEN="..."` line into your local `.env` file.

---

---

# 🏁 PART 4 — After going live: first things to do

Log in to your **live admin panel** (`https://your-site.vercel.app/admin`) and:

1. **Branding & settings** page:
   - ✏️ Change contact email, phone, WhatsApp number, address to YOUR real ones
   - ✏️ Set **"Send order & lead emails to"** = your real email
   - ✏️ Adjust the tagline / hero text / announcement bar if you like
   - Click **Save settings**
2. **Products** page:
   - 🗑️ Delete the 10 sample products
   - ➕ Add your real resin art products with real photos
3. **Test the full flow yourself:**
   - Open your store → add a product to cart → a **mini popup asks for your name +
     mobile** (this is the guest lead capture)
   - Check that lead appears in **Admin → Interested customers** with the name & phone
   - Go to checkout → it asks you to **log in or sign up** (create a quick account)
   - Place a test order (COD)
   - Check it appears in **Admin → Orders**
   - Check the lead appears in **Admin → Interested customers**
   - In **Admin → Orders**, open the order, change its **status** (e.g. to *Shipped*)
     and add a **courier + tracking number** → the customer gets an email
   - Log in as that customer → **My account** → watch the order's **tracking timeline** update
   - If email is set up: check your inbox 📬

### 📦 How order tracking works

- The **customer** can only see their own orders — they must be **logged in** (account-only tracking).
- **You (admin)** drive the tracking: in **Admin → Orders**, expand any order to
  change its status (Pending → Confirmed → Shipped → Delivered) and add courier +
  tracking number/URL. Every change is timestamped on the customer's timeline and
  emails them automatically.
- Customers who forget their password use **"Forgot password?"** on the login page
  (needs email set up — Part 2 — to actually send the reset link).

## How to update the website later (when I change the code)

Whenever the code changes, run these 3 commands in PowerShell (inside the level7clothing folder):

```powershell
git add .
```

```powershell
git commit -m "update"
```

```powershell
git push
```

Vercel **automatically redeploys** your live site in ~2 minutes. That's it!

---

---

# 🔧 PART 5 — Common problems & fixes

### ❌ `npm run setup` says "Can't reach database server"
- Your `DATABASE_URL` in `.env` is wrong or incomplete.
- Open Neon → your project → **Connection string** → copy it again carefully.
- Make sure the URL is inside quotes `"..."` and on ONE line.

### ❌ `git push` asks for username/password and fails
- Run the push command again — a browser window should open for login.
- If not, install **GitHub Desktop** (https://desktop.github.com), sign in there once, then retry the command.

### ❌ Vercel build fails
- Click on the failed deployment → read the red error lines.
- 90% of the time: a missing environment variable. Check Step 3.4 — especially `DATABASE_URL` and `DIRECT_URL`.
- After adding a missing variable: **Deployments → ⋯ → Redeploy**.

### ❌ Live site shows "no products" but localhost has them
- Your Vercel `DATABASE_URL` is different from your local one. Make sure BOTH point to the **same Neon database** (compare the values).

### ❌ Admin login says "Invalid email or password"
- Use exactly what's in `ADMIN_EMAIL` / `ADMIN_PASSWORD` (in Vercel env variables for the live site, in `.env` for localhost).
- Changed the password in Vercel? Redeploy, then also run `npm run setup` locally once (it updates the admin account in the database).

### ❌ Emails not arriving
- Check `RESEND_API_KEY` is set (Vercel env vars for live).
- With the free `onboarding@resend.dev` sender, emails ONLY deliver to your own Resend signup email. Set that email in **Admin → Branding & settings → "Send order & lead emails to"**.
- Check the Spam folder.

### ❌ Image upload button gives an error
- Vercel Blob isn't set up yet — see Step 3.6. Until then, paste image URLs instead (that always works).

### ❌ Port 3000 already in use (localhost)
```powershell
npm run dev -- -p 3001
```
Then open http://localhost:3001

---

## 📇 Quick reference card

| I want to… | Command / Place |
|---|---|
| Start website locally | `npm run dev` (inside level7clothing folder) |
| Stop website | `Ctrl + C` in PowerShell |
| Reset/load sample data | `npm run setup` |
| See database visually | `npm run db:studio` |
| Update the live site | `git add .` → `git commit -m "update"` → `git push` |
| Change branding/contact | Live site → `/admin` → Branding & settings |
| Manage products | Live site → `/admin` → Products |
| See orders | Live site → `/admin` → Orders |
| See cart leads | Live site → `/admin` → Interested customers |

**Accounts you created:** Neon (database) · Resend (email, optional) · GitHub (code) · Vercel (hosting)
**All free.** 🎉
