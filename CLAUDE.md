@AGENTS.md

# Level7 Clothing — project guide

Read this before exploring. It records the things that were expensive to work out,
so they don't have to be rediscovered.

## What this is

A **Level7 Clothing** e-commerce store — storefront + admin in one Next.js app.
Built as a demo for a friend who currently sells on Shopify (`level7clothing.com`);
the catalogue, copy and categories mirror that real store.

- **Repo:** `github.com/genzclothingdemo/level7clothing` (branch `main`)
- **Live:** `https://www.level7clothing.shop` (Vercel, team `genzclothingdemo`)
- **Local path:** `Quellflow/code/Clothing/level7clothing`

> This codebase started life as a copy of an unrelated resin-art store
> ("Artvelle"). All of that branding is gone — **do not reintroduce it**, and don't
> use "artvelle" anywhere. Quellflow and PrintDeed are different companies; this
> project lives under Quellflow only.

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind v4 ·
Prisma 6 + Supabase Postgres · Vercel Blob (uploads) · Resend (email) ·
Razorpay (payments) · NimbusPost (courier).

## ⚠️ Database — read before touching env vars

This caused a full production outage and is the single most important fact here.

`DATABASE_URL` **must** use the Supabase **pooler**, not the direct host:

```
postgresql://postgres.<PROJECT_REF>:<PW>@aws-1-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
```

Three details, all of which broke things when wrong:

1. **`db.<ref>.supabase.co` is IPv6-only** (no A record). Vercel functions have no
   outbound IPv6 → every DB page 500s with "Can't reach database server". It works
   locally because dev machines have IPv6, so this hides until deploy.
2. **`aws-1`, not `aws-0`.** `aws-0-ap-south-1` returns
   `FATAL: (ENOTFOUND) tenant/user ... not found`. Verified by testing both.
3. **`pgbouncer=true` is required.** Without it Prisma throws
   `prepared statement "s1" already exists` in transaction mode.

`DIRECT_URL` keeps the direct `db.<ref>.supabase.co:5432` host — it's only used by
migrations / `db push`.

**A broken database does NOT fail the Vercel build.** `getSettings()` catches errors
and falls back to defaults, so the build says "Completed" and the site 500s at
runtime. The canary is the sitemap: `/sitemap.xml` should have **31 URLs including
19 products**; if it drops to 9 (static only), the DB is unreachable.

Also required in Vercel: `NEXT_PUBLIC_SITE_URL=https://www.level7clothing.shop`,
or sitemap/canonical/OG tags emit localhost.

## Design system — names lie, read this

Deliberate aliases kept to avoid churning ~40 files. Don't "fix" them by renaming:

| Class / token | Actually is |
|---|---|
| `font-serif` | **Space Grotesk** (grotesk display face, weight 600, tight tracking) — *not* a serif |
| `gold-text`, `text-gold-shimmer` | **Electric violet** `#7c3aed` — *not* gold |
| `--font-serif` | maps to `--font-grotesk` |

Aesthetic is **monochrome + electric violet**, editorial/streetwear:

- Base `#fafafa` / ink `#0a0a0a`; dark `#09090b` / `#fafafa`. Accent violet
  `#7c3aed` light, `#a78bfa` dark (both pass WCAG AA — 5.5:1 and 7.3:1).
- **Product imagery is portrait `aspect-[4/5]`** everywhere (fashion standard).
  Only the Instagram grid and admin thumbs stay square.
- Buttons: squared `rounded-lg`, **uppercase**, wide tracking, colour-change only.
- **Motion is deliberately restrained.** Floating tiles, glow orbs, aurora blobs,
  text shimmer, button shine and hover-bounce were all removed on purpose —
  they read as template, not retail. The only looping animation is the marquee.
  Don't add ambient motion back.
- Utilities: `.eyebrow` (uppercase wide-tracked label), `.display-tight`, `.rule`.

## Modal pattern — don't hide with transforms

A bug worth not repeating: the size guide stayed mounted and was "hidden" with
`translateY(100%)`. From a **vertically centred** position that only moves it down
by its own height, so it stayed visible on screen (just unclickable).

**Conditionally render overlays** (`{open && (...)}`), which every other overlay in
this repo already does. Animate **opacity only** — never rely on a transform
animation completing for an element's resting position. Edge-anchored drawers
(`inset-y-0 left-0` + `translateX(-100%)`) are fine, because 100% clears the viewport.

## Shipping

**Free shipping is the default**, and there are three places that matter:

- `schema.prisma`: `shippingType` defaults to `"free"` (was `"nimbus"`, which
  silently put seeded products on live courier rates).
- `prisma/seed.ts`: sets `"free"` + parcel dims via `parcelFor(category)`.
- Admin form + zod already default to `"free"`.

`shippingType: "free"` also **skips the NimbusPost API call entirely**, so a courier
outage can't block checkout.

Parcel specs — sized so billable weight (`max(dead, L×B×H/5000)`) lands inside a
courier slab. These still matter with free shipping: they're sent to the courier for
the AWB and drive margin visibility.

| Garment | Weight | L×B×H | Billable |
|---|---|---|---|
| Tee | 300 g | 30×24×3 cm | ~450 g |
| Hoodie | 750 g | 33×26×6 cm | ~1.03 kg |

## Why pages feel slow (measured, not guessed)

| Route type | Production TTFB |
|---|---|
| Static (`robots.txt`) | **0.08 s** |
| DB-backed (home, shop, product) | **4.4–4.6 s** |
| One DB query from a dev machine in India | **~100 ms** |

Not the client, not the network, not Supabase. The cause is **geography**: Vercel's
function region is **`iad1` (Washington DC)** while Supabase is **`ap-south-1`
(Mumbai)** — every query crosses the planet. `connection_limit=1` then *serialises*
those hops, so N queries cost N round trips with no overlap.

**The single biggest fix is changing the Vercel function region to `bom1` (Mumbai).**
Nothing in the code can compensate for a ~250 ms floor per query.

Mitigations already in place — don't undo them:

- `loading.tsx` skeletons at `(store)/`, `(store)/shop/`, `(store)/product/[slug]/`.
- `useLinkStatus` pending feedback (`link-pending.tsx`) on product tiles and inside
  `ButtonLink`, debounced ~150 ms so fast navigations don't flash a spinner. This is
  what stops shoppers clicking a product repeatedly.
- `getProductBySlug` and `getSettings` are wrapped in React `cache()` for
  per-request dedup — `generateMetadata` and the page body would otherwise each
  issue the same query.
- Product page runs `getRelated` + reviews in `Promise.all`.

Still available if needed: relax `force-dynamic` in favour of `revalidate`, and
raise `connection_limit` above 1 (Fluid Compute is on, so one instance serves
several requests).

## NimbusPost dispatch

**Working.** Rewritten onto the **Partner API v2** (`https://api-v2.nimbuspost.com`)
and verified live against this account (org `level7clothing`, warehouse `clothing` /
WH-001, Gandhinagar 382016).

> An earlier note here claimed "no valid API credential is configured". **That was
> wrong.** The key pair was always valid — it was sent as a *Bearer token*, which v2
> rejects. Don't re-run that diagnosis.

Auth is an **API key pair as two headers** — `x-api-key` + `x-api-secret`. Not a
Bearer token, not email + password. The legacy v1 host (`api.nimbuspost.com/v1`)
returns `Invalid email or password` for accounts created on the new platform even
when the password is correct — that error means *wrong API*, not wrong password.

### Weight units differ per endpoint — verified, docs are wrong

The single most expensive gotcha here. The published v2 docs say grams everywhere:

| Endpoint | Unit |
|---|---|
| `POST /v2/orders`, `POST /v2/shipments` | **kilograms** (b2c cap 32 kg) |
| `POST /v2/serviceability` | **grams** |

Proven live: order weight `33` → `"B2C orders cannot exceed 32 kg chargeable weight"`,
`31` → accepted, `0.8` → accepted. `src/lib/nimbuspost.ts` converts grams → kg for
orders and leaves serviceability in grams. Don't "fix" it to match the docs.

Also: serviceability money is in **paise** (`totalPaise`), orders in **rupees**.

### Draft-first — booking is never one click

`dispatchOrder()` **cannot** create-and-book in one call. Every order must exist in
NimbusPost as an unbooked draft so a human can review it before any wallet charge:

1. Order confirmed → draft staged automatically (`POST /v2/orders`) — no courier, no
   AWB, no charge.
2. No draft yet? The admin button reads **"Send draft to NimbusPost"** — it stages
   and **stops**, returning `outcome: "drafted"`.
3. Draft exists → **"Book & generate AWB"** (`POST /v2/shipments/book`).
4. Or book it in the NimbusPost dashboard, then press **"Sync from NimbusPost"** —
   `syncOrderFromNimbus()` reads `shipment.awb` (empty string until booked) and pulls
   the AWB/courier/tracking back. Without this the status webhook, which matches on
   AWB, can never find the order.

`createShipment()` (the one-shot create+book) is kept for API completeness but is
marked **intentionally unused** — wiring it back in defeats the review gate.

### Two things that will block a real booking

- **Wallet is ₹0.00.** Drafts are free; booking needs a top-up.
- `NIMBUSPOST_WAREHOUSE_NAME` is `"clothing"` and matches the dashboard. The client
  now resolves the warehouse via `GET /v2/warehouses` (matching name / display name /
  code, falling back to the primary), so a mismatch warns rather than hard-failing.

## Errors must not become 404s

`getProductBySlug` intentionally **does not** catch DB errors. Callers turn `null`
into `notFound()`, so swallowing an error told Google a live product was deleted.
Let it throw → 500 → crawlers retry instead of deindexing. Don't add a try/catch back.

## Commands

```bash
npm run dev              # dev server (localhost:3000)
npm run db:push          # push schema
npm run db:seed          # DESTRUCTIVE: deletes + recreates all products
npm run shipping:free    # safe: only shipping fields, keeps reviews/orders
npx tsc --noEmit         # typecheck
npx next build           # should be 24/24 pages
```

`db:seed` wipes products. To change shipping or settings on live data, use targeted
scripts in `scripts/` instead.

## Environment gotchas (Windows)

- `prisma generate` fails **`EPERM`** if the dev server is running — kill it first
  (`netstat -ano | grep :3000`, then `taskkill //F //PID <pid>`).
- Dev server can wedge with `Jest worker encountered ... child process exceptions`
  after many restarts / a Prisma regen underneath it. Fix: `rm -rf .next` + restart.
  Not a code bug.
- No `python3`. Use `node -e`.
- Passing Windows paths into `node -e` breaks on backslashes — `cd` into the
  directory and use relative paths.
- Long `npx prisma` / `tsx` chains can exceed tool timeouts; run them one at a time.

## Layout

```
src/app/(store)/      home, shop, product/[slug], cart, checkout, account,
                      wishlist, faq, track-order, privacy-policy, terms,
                      shipping-returns, about, contact, order/[orderNumber]
src/app/admin/(panel)/ dashboard, products, categories, orders, returns,
                      coupons, reviews, leads, newsletter, messages, settings
src/app/actions/      server actions (orders, reviews, returns, addresses,
                      newsletter, account, admin, contact)
src/lib/              prisma, products, settings, variants, auth, user-auth,
                      email, nimbuspost, search, types
src/context/          cart, wishlist, settings, product-view
public/products/level7/  all 117 product photos, hosted locally
```

**Product images are local, not Shopify.** They were downloaded so the store
survives the friend closing his Shopify account. Never point product images back at
`cdn.shopify.com`.

Branding (name, tagline, hero copy, contact, socials, announcement bar, payment
toggles) is **DB-driven** via `SiteSettings` → editable at **Admin → Settings**.
Don't hardcode brand strings; read from `getSettings()`.

## State

Working and verified in production: full catalogue (22 products, 19 active),
size guide, reviews + moderation, wishlist, cart upsells, newsletter, returns,
address book, coupons, COD/prepaid/partial, SEO (sitemap, robots, Organization /
WebSite / Product / BreadcrumbList JSON-LD, per-category metadata).

Known / deliberate:

- **`.env` holds LIVE Razorpay keys** (`rzp_live_…`), not test keys. Online payments
  are off in settings (`razorpayEnabled: false`) so it's safe — but don't enable
  Razorpay for a demo.
- `.gitignore` has a trailing `.env*` that re-ignores everything; `!.env.example`
  sits **after** it so the template stays tracked. Keep that order.
- Repo carries ~194 MB of product PNGs. Fine for GitHub; `next/image` optimises
  what's served. Compressing sources is an option, not a need.
- Deprecations Vercel warns about, both harmless: `middleware.ts` → `proxy.ts`
  (Next 16) and `package.json#prisma` → `prisma.config.ts`.
- Pre-existing `react-hooks/set-state-in-effect` lint errors (~23) in cart,
  checkout, theme-toggle etc. Not from recent work; localStorage hydration
  genuinely needs an effect.

## Working style

The user is a **beginner** with deployment/infra — explain plainly and give
copy-pasteable steps, not just diagnoses. Don't push to git without being asked.
