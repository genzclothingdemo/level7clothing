# Shipping & Payments Integration Guide (Level7 Clothing)

This guide explains how **online payments (Razorpay)** and **delivery (NimbusPost)**
work in the store, and the exact steps to switch them on — locally and on the live
(Vercel) site. It's written to be copy‑paste simple.

---

## 1. The big picture

Every product decides **how a customer can pay for it** (you set this per product):

| Mode | What happens | Who collects money |
|------|--------------|--------------------|
| **Prepaid** | Customer pays the full amount online | Razorpay |
| **COD** | Customer pays cash when it arrives | Courier (NimbusPost) |
| **Partial** | Customer pays an advance % online, rest on delivery | Razorpay + Courier |
| **Direct** | No payment — the order is just placed and you contact them | You (custom orders) |

Order flow:

```
Customer places order
      │
      ├─ Prepaid / Partial  → pays online → order AUTO‑CONFIRMED → draft shipment staged
      │
      └─ COD / Direct       → order is PENDING → you click "Confirm order"
                                                 → draft shipment staged
                                                        │
                                          You click "Dispatch (generate AWB)"
                                                        │
                                                courier + tracking assigned
```

Nothing ships automatically. **You confirm every order**, then dispatch with one click.

---

## 2. Razorpay (online payments)

### Get your keys
Razorpay Dashboard → **Settings → API Keys**. Use `rzp_test_…` while testing,
`rzp_live_…` when you go live.

### Turn it on
1. Add these to your environment (see §4 for local vs live):
   ```
   RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxx
   RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxx
   NEXT_PUBLIC_RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxx
   ```
   > `NEXT_PUBLIC_RAZORPAY_KEY_ID` is the **same value** as `RAZORPAY_KEY_ID`. It is
   > exposed to the browser so the payment popup can open.
2. In the app: **Admin → Settings → Integrations → Razorpay online payments = ON**.
3. On each product you want to accept online payment for, tick **Prepaid** and/or
   **Partial** under "Checkout modes".

### Test card
In test mode, use card **`4111 1111 1111 1111`**, any future expiry, any CVV.

### ⚠️ Common gotcha (why it "works locally but not live")
Local development reads `.env`. The **live site reads the environment variables set in
Vercel** — it does NOT use your local `.env`. If the keys are only in `.env`, payments
work locally and silently disappear on the live site. **Fix: add all three keys to
Vercel (see §4) and redeploy.** Because `NEXT_PUBLIC_*` is baked in at build time, you
must trigger a new deploy after adding it.

---

## 3. NimbusPost (delivery)

### Important: how the API logs in
NimbusPost's API authenticates with your **account email + password** (the same login
you use at ship.nimbuspost.com). The **API key / secret** shown in the dashboard are
**not** accepted by this API (verified against their live endpoints). So you must set
the email and password, not the key/secret.

### One‑time setup in the NimbusPost dashboard
1. Create your account and complete KYC.
2. Add a **Pickup Warehouse** (Settings → Warehouse). Note its **exact name** — you'll
   put it in `NIMBUSPOST_WAREHOUSE_NAME`.

### Turn it on
1. Environment variables:
   ```
   NIMBUSPOST_EMAIL=you@example.com
   NIMBUSPOST_PASSWORD=your-nimbuspost-password
   NIMBUSPOST_WAREHOUSE_NAME=Exact Warehouse Name From Dashboard
   # Default parcel size, used when a product doesn't specify its own (grams / cm):
   NIMBUSPOST_DEFAULT_WEIGHT=500
   NIMBUSPOST_DEFAULT_LENGTH=15
   NIMBUSPOST_DEFAULT_BREADTH=15
   NIMBUSPOST_DEFAULT_HEIGHT=10
   ```
2. In the app: **Admin → Settings → Integrations → NimbusPost shipping = ON**.

### "How do I configure my products for NimbusPost?"
NimbusPost has **no product catalog** to register into. A shipment just carries the
item list (name / qty / price) plus **one parcel weight and size**. So configuring a
product for shipping = setting its **weight & dimensions**:

- Open a product in **Admin → Products → Edit → "Shipping (parcel size)"** and enter the
  weight (grams, per unit) and length/breadth/height (cm).
- Leave them blank to use the store defaults (`NIMBUSPOST_DEFAULT_*`).
- For a multi‑item order, the store **adds up item weights** and takes the **largest**
  dimensions.

### The dispatch flow
1. When an order is **confirmed** (auto for prepaid, or when you click *Confirm order*
   for COD), the store creates a **draft order** in NimbusPost — no courier yet.
2. In **Admin → Orders**, open the order and click **"Dispatch (generate AWB)"**. This
   assigns the cheapest serviceable courier, generates the AWB, and saves the tracking
   number + link (also shown in the customer's account).
3. For COD / partial orders, the remaining balance is automatically set as the COD
   amount the courier collects.

If NimbusPost isn't configured yet, confirming still works — the draft step is just
skipped, and you can add tracking manually in the same panel.

---

## 4. Setting environment variables

### Locally
Edit the `.env` file in the project root, then restart `npm run dev`.

### On the live site (Vercel) — this is what fixes live payments
**Option A — Dashboard:** Vercel → your project → **Settings → Environment Variables**.
Add each key for **Production** (and **Preview**), then **Redeploy** (Deployments → ⋯ →
Redeploy).

**Option B — CLI:**
```bash
vercel env add RAZORPAY_KEY_ID production
vercel env add RAZORPAY_KEY_SECRET production
vercel env add NEXT_PUBLIC_RAZORPAY_KEY_ID production
# repeat for the NIMBUSPOST_* vars when you're ready to ship live
vercel --prod   # redeploy
```

> Security: never commit real keys to git (`.env*` is already git‑ignored). If a secret
> was ever shared in plain text, rotate it in the provider's dashboard.

---

## 5. Live tracking updates (webhook) — BUILT ✅
NimbusPost pushes every status change ("picked up", "in transit", "out for delivery",
"delivered") to the store, which updates the order timeline automatically and emails the
customer at the shipped/delivered milestones. The latest courier status also shows as a
live badge on the order's "Shipped" step (in the customer's account and on the order page).

### One-time setup
1. Make sure `NIMBUSPOST_WEBHOOK_SECRET` is set (already in your env).
2. In the NimbusPost dashboard → **Settings → Webhook**, set the URL to:
   ```
   https://YOUR-DOMAIN/api/webhooks/nimbuspost?secret=level7clothing-nimbus-wh-secret-2024
   ```
   (Replace the domain with your live site. The `?secret=` must match
   `NIMBUSPOST_WEBHOOK_SECRET`.)
3. Sanity check: open `https://YOUR-DOMAIN/api/webhooks/nimbuspost` in a browser — it
   returns `{"ok":true,"configured":true}`.

### How it maps
| NimbusPost status | Order becomes | Customer emailed |
|---|---|---|
| Pickup scheduled / done, Manifest created | confirmed | — |
| In transit, Reached destination, Out for delivery | shipped | on first "shipped" |
| Delivered | delivered | ✅ |
| RTO delivered | cancelled | ✅ |

Unrecognised statuses are still recorded on the timeline (and shown as the live badge)
without changing the coarse order status. The webhook matches orders by **AWB**, so it
only works after you've dispatched (generated the AWB) for that order.

---

## 6. Troubleshooting

| Symptom | Likely cause | Fix |
|--------|--------------|-----|
| "Pay online" missing on live site | Razorpay keys not in Vercel | Add all 3 keys to Vercel, redeploy (§4) |
| "Pay online" missing everywhere | Razorpay toggle off, or product has no Prepaid mode | Admin → Settings; product Checkout modes |
| Dispatch says "NimbusPost login failed" | Wrong email/password, or you used the API key/secret | Use account email + password |
| Dispatch says "Set NIMBUSPOST_WAREHOUSE_NAME…" | Warehouse name missing/mismatched | Copy the exact name from the dashboard |
| Order stuck "pending" | It's COD/Direct awaiting you | Click **Confirm order** |
