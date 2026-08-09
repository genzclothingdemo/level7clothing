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
The store uses the **NimbusPost Partner API v2** (`https://api-v2.nimbuspost.com`), which
authenticates with an **API key pair** — two headers, `x-api-key` and `x-api-secret`.
It is **not** a Bearer token and **not** your email + password.

> The older v1 API (`api.nimbuspost.com/v1`) did use email + password. Accounts created
> on the new platform do not exist there at all — v1 login returns
> *"Invalid email or password"* even when the password is correct. If you hit that error,
> you're on the wrong API, not the wrong password.

### One‑time setup in the NimbusPost dashboard
1. Create your account and complete KYC.
2. Add a **Pickup Warehouse** (Settings → Warehouse). Note its **exact name** — you'll
   put it in `NIMBUSPOST_WAREHOUSE_NAME`.
3. Go to **Settings → API Keys** and create a key with the **`admin`** role (a `viewer`
   key gets 401 on anything that creates or books). The secret is shown **exactly once** —
   copy it immediately.

### Turn it on
1. Environment variables:
   ```
   NIMBUSPOST_API_KEY=npk_xxxxxxxxxxxxxxxx
   NIMBUSPOST_API_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
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

### The dispatch flow — draft first, always

**Nothing is ever booked in one click.** An order must exist in NimbusPost as an
unbooked draft before a courier can be allocated, so a human can review it — either
in the NimbusPost dashboard or here — before any wallet charge.

1. When an order is **confirmed** (auto for prepaid, or when you click *Confirm order*
   for COD), the store creates a **draft order** in NimbusPost — no courier, no AWB,
   no charge.
2. If that draft didn't get staged (shipping was off, NimbusPost wasn't configured,
   or it errored), the button in **Admin → Orders** reads **"Send draft to NimbusPost"**.
   Clicking it stages the draft **and stops** — it will not book.
3. Once a draft exists the button becomes **"Book & generate AWB"**. That allocates
   the cheapest serviceable courier, generates the AWB, deducts the wallet, and saves
   the tracking number + link (also shown in the customer's account).
4. **Or book it in the NimbusPost dashboard** after reviewing it there. Then press
   **"Sync from NimbusPost"** in the order panel to pull the AWB, courier and tracking
   link back into the store and email the customer. Without this step the store has no
   AWB, so the status webhook (which matches on AWB) can never find the order.
5. For COD / partial orders, the remaining balance is automatically set as the COD
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
   https://YOUR-DOMAIN/api/webhooks/nimbuspost?secret=YOUR-NIMBUSPOST-WEBHOOK-SECRET
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
| `NimbusPost UNAUTHORIZED` | Key pair missing/wrong, key expired, or an IP allowlist is blocking you | Re-check `NIMBUSPOST_API_KEY` / `NIMBUSPOST_API_SECRET`; rotate the key if unsure |
| `UNAUTHORIZED` only on dispatch, reads work fine | The key has the **`viewer`** role | Mint a new key with the **`admin`** role |
| "Invalid email or password" | Legacy v1 API — no longer used by this store | Make sure the key pair vars are set; email/password are ignored now |
| Dispatch says "No pickup warehouse found" | No warehouse in the dashboard | Add one under Settings → Warehouse |
| Shipping shows "not available for this pincode" | Genuinely unserviceable, or wallet empty | Check the pincode; top up the wallet |
| "B2C orders cannot exceed 32 kg chargeable weight" | Product weights add up past NimbusPost's 32 kg cap | Check the product weights are in **grams** in Admin → Products |
| Order stuck "pending" | It's COD/Direct awaiting you | Click **Confirm order** |
