@AGENTS.md

# Level7 Clothing — project guide

Read this before exploring. It records the things that were expensive to work out,
so they don't have to be rediscovered.

## What this is

A **Level7 Clothing** e-commerce store — storefront + admin in one Next.js app.
Built as a demo for a friend who currently sells on Shopify (`level7clothing.com`);
the catalogue, copy and categories mirror that real store.

- **Repo:** `github.com/genzclothingdemo/level7clothing` (branch `main`)
- **Live:** `https://clothingdemoshop.vercel.app` — Vercel project `level7clothing`
  in **team scope `genzclothingdemo`**, functions in `bom1`
- **Local path:** `Quellflow/code/Clothing/level7clothing`

> **Deploy to the right project.** `level7clothing.shop` was disabled on
> 2026-09-21 (its GoDaddy records had a stray `0`: `...vercel-dns-017.com.0` and
> `216.198.79.10`), so there is no custom domain attached. A **duplicate** project
> of the same name lived in the personal scope `clothing6` and was deleted — if a
> deploy seems to have no effect, check `vercel whoami` and the linked scope.
> Note `vercel link` appends `.vercel` *and* a second `.env*` to `.gitignore`;
> that second `.env*` lands after `!.env.example` and untracks the template, so
> revert `.gitignore` after linking (`.vercel` is already ignored at line 41).

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
postgresql://postgres.<PROJECT_REF>:<PW>@aws-1-ap-south-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=5
```

Four details, all of which broke things when wrong:

1. **`db.<ref>.supabase.co` is IPv6-only** (no A record). Vercel functions have no
   outbound IPv6 → every DB page 500s with "Can't reach database server". It works
   locally because dev machines have IPv6, so this hides until deploy.
2. **`aws-1`, not `aws-0`.** `aws-0-ap-south-1` returns
   `FATAL: (ENOTFOUND) tenant/user ... not found`. Verified by testing both.
3. **`pgbouncer=true` is required.** Without it Prisma throws
   `prepared statement "s1" already exists` in transaction mode.
4. **`connection_limit=5`, NOT 1.** This line used to say `1`, and on
   2026-09-22 that took out `/admin/settings` and `/admin/customers/[id]` in
   production with:

   ```
   code: 'P2024'
   Timed out fetching a new connection from the connection pool
   (Current connection pool timeout: 10, connection limit: 1)
   ```

   Nothing was wrong with either page. The app simply grew — chat, promotions,
   customers, finance and the pipeline settings all added queries — and with a
   single connection they queue. Fluid Compute makes it worse, because one
   instance serves several requests *concurrently* and they all share that one
   connection, so the queue is N requests deep. Past the 10 s pool timeout,
   Prisma throws.

   The customer 360 page aggregates User + Order + Lead + ChatThread +
   ReturnRequest + WishlistItem, so it falls over first.

   It also hid: `getLivePromotion()` fails closed, so the store silently showed
   no promo banner instead of erroring. Measured effect of the change — the
   same 12 concurrent queries went **1473 ms → 534 ms**.

   **Symptom to recognise:** a page that works locally and alone, but breaks
   under real traffic or on a query-heavy screen. It is a pool problem, not a
   code problem — don't go looking for a null in the component tree (I did).

`DIRECT_URL` keeps the direct `db.<ref>.supabase.co:5432` host — it's only used by
migrations / `db push`.

**A broken database does NOT fail the Vercel build.** `getSettings()` catches errors
and falls back to defaults, so the build says "Completed" and the site 500s at
runtime. The canary is the sitemap: `/sitemap.xml` should have **31 URLs including
19 products**; if it drops to 9 (static only), the DB is unreachable.

Also required in Vercel: `NEXT_PUBLIC_SITE_URL=https://clothingdemoshop.vercel.app`
(the `www.level7clothing.shop` value this line used to name is a **disabled
domain** — pointing canonicals and OG tags at it is worse than localhost,
because it resolves for nobody),
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

## CSS cascade layers — unlayered rules silently beat every utility

`@import "tailwindcss"` puts utilities in `@layer utilities`. **An unlayered rule
outranks every layered rule regardless of specificity**, so anything written at the
top level of `globals.css` defeats Tailwind with no warning and no error.

This had already bitten twice before it was found:

- `* { border-color: var(--border) }` made **every** `border-<colour>` utility in the
  repo inert — `border-accent`, `border-primary`, `border-foreground` all rendered as
  the default hairline.
- `.input { padding: 0 0.875rem; height: 2.75rem }` made `class="input pl-9"` put the
  text under the icon, and `class="input h-10"` a silent no-op.

Both are now wrapped (`@layer base` and `@layer components`), and `.input` uses
`padding-inline`/`padding-block` longhands so a `pl-*` utility isn't reset by the
shorthand. **Keep new global rules inside a layer.**

## Product media: ProductImage rows are the contract, not `Product.variants`

`syncProductImages()` writes the real gallery as `ProductImage` rows:

| slot | variantValue | meaning |
|---|---|---|
| `preview` | the value | the one card/preview shot for that variant value |
| `gallery` | the value | that value's gallery, in `sortOrder` |
| `common` | `null` | photos shown for every variant |

`Product.variants[].images` is a **mirror**, and a lossy one — each variant's
`images` is written as `[...designImages, ...common]`. The admin editor used to
rehydrate from that mirror, which meant reopening a product with variants *and*
common photos put the common shots under every value, left Common empty, and the
next save deleted the `slot="common"` rows. A hand-picked `previewImage` was lost
the same way, because the mirror path always took `images[0]`.

So: **the edit page must `include: { productImages: { include: { media } } }`**
and the form must rehydrate from `slot`/`variantValue`/`sortOrder`. The legacy
mirror path is kept only as a fallback for rows saved before ProductImage existed.

## Zod strips anything not in the schema — silently

`returnable` was missing from `productSchema` in `src/app/actions/admin.ts`, so it
was dropped from every payload and neither `createProduct` nor `updateProduct`
wrote the column. The admin's Returns control looked fine and saved nothing, and
`resolveReturnPolicy()` kept offering returns on pieces marked non-returnable.
Nothing fails loudly here — no type error, no runtime error. **When adding a
Product column, add it to `productSchema` AND to both writers**, and collapse
`undefined` to `null` explicitly so "inherit the store default" survives an update.

The same shape of trap: `resolveReturnPolicy(product, settings)` takes
`isCustomisable` as an *optional* field, so a Prisma `select` that omits it still
typechecks and silently treats made-to-order pieces as returnable.

## `vercel env pull` poisons local production builds

`vercel env pull` writes **`.env.production.local`**, and for any variable marked
*Sensitive* in Vercel the value it writes is the literal string `[SENSITIVE]` —
the real value is unreadable by design. Next.js loads `.env.production.local`
**ahead of** `.env`, but only for `next build` / `next start`.

So after a pull, local production builds silently run with
`DATABASE_URL="[SENSITIVE]"`: they compile fine, and emit a **9-URL static-only
sitemap** — the exact signal this file names as the production-outage canary.
`npm run dev` is unaffected (it reads `.env.development.local`/`.env`), and real
production is unaffected (Vercel injects the true values), so it only ever
misleads you locally.

**Delete `.env.production.local` after any `vercel env pull`.** It is gitignored,
so it is not a leak — just a trap. If a local build's sitemap drops to 9 URLs,
check for this file before believing the database is down.

## SiteSettings — Admin → Settings is now the only editor

This used to say "three editors, keep them apart". It is now **one**, at
`/admin/settings`, in seven tabs: `store · orders · payments · integrations ·
returns · storefront · email`. **Shipping is gone** — the only thing left in it
was the free-shipping threshold, which is a checkout charge and moved to
Payments beside the cash fees; the courier credentials moved to Integrations.
A stale `?tab=shipping` bookmark falls back to Store. Returns and Order
automation were editable on
their own screens and are now *mounted into* Settings; those screens keep a
**read-only strip with a link** ("Order automation · AUTO-CONFIRM: MANUAL ·
DRAFT ONLY · Change in settings").

| Columns | Tab | Form component | Server action |
|---|---|---|---|
| Brand, contact, copy, payment toggles, product defaults, email | store / payments / storefront / email | `settings-form.tsx` | `updateSettings` |
| `codFeeAmount`, `partialFeeAmount`, free-shipping threshold | payments | `settings-form.tsx` | `settings/actions.ts` |
| Razorpay + NimbusPost status (read-only — no secret is ever rendered) | integrations | `settings-sections.tsx` | — |
| `returnsEnabled`, `defaultReturnable`, `returnWindowDays`, `returnReasons`, `returnPolicyNote`, `defaultReturnsInfo`, five `refund*` | returns | `return-policy-form.tsx` (`ReturnPolicyCard`) | `updateReturnDefaults` |
| `orderConfirmMode`, `autoConfirm{Prepaid,Partial,Cod}`, `autoShipOnConfirm`, `autoShipCourier` | orders | `settings-sections.tsx` | `updateOrderPipelineSettings` |

**One save bar, three writers, and each key only ever goes to the action that
owns it** — and only when dirty. Nothing is round-tripped through an action
that doesn't own it, which is the rule that matters: `defaultReturnsInfo` once
had two writers (Returns owned it, and the settings form echoed
`initial.defaultReturnsInfo` back on every save), so two tabs open meant a
silent lost update with no error anywhere.

`ReturnPolicyCard` renders a `<div>` with a `type="button"` submit rather than
a `<form>`, specifically so it nests inside the settings form. A controlled
`ReturnPolicyFields` is exported alongside it for a caller that wants to own
the draft. **Adding a tab means adding the key to `TABS` in
`src/lib/settings-tabs.ts`** — that module has no `"use client"` directive on
purpose, because the server page calls `isTabKey()` (see the RSC traps above);
an unknown `?tab=` falls back to the first tab rather than 404ing.

## Returns copy and the returns *rule* must be resolved together

`resolveProductInfo()` only picks copy — product text, else the store default.
It has never known whether a piece can actually be returned, so a product
marked non-returnable still rendered "7-day easy returns" on its page. The copy
and the rule were resolved by two different functions and nothing made them
agree.

The product page must use **`productReturnsBlock(product, settings)`**
(`lib/returns.ts`), which returns `null` when the piece is non-returnable —
explicit `false`, made-to-order, or returns off store-wide — and otherwise the
resolved copy. `ProductInfoSections` already hides on an empty string.
Reproduced and verified both ways: `returnable: false` → the heading and the
copy both vanish; back to `null` → both return.

**`currency` is dead.** It is on the model and in the DTO, but `formatINR`
(`lib/utils.ts`) and the Razorpay order (`lib/razorpay.ts`) both hardcode
`"INR"`. It is shown read-only rather than given an input, because a control
that changes nothing is worse than no control. Wire those two call sites first
if multi-currency is ever wanted.

## Three checkout modes, two instruments — and no fallback

**COD · partial (advance + COD) · prepaid**, paid in **cash** or **online via
Razorpay**. Prepaid and the advance leg must be online.

**"Direct" was removed on 2026-09-22.** `directEnabled` is now pinned `false` on
every save, which matters more than it looks: `settingsSchema` declares
`.default(true)`, so *omitting* the field would have written `true` back.
`METHOD_TO_MODE` deliberately keeps its `Direct` row so historical orders still
read back — dropping it would let them fall to the `?? "cod"` default and claim
cash was collected on an order that never took any.

**`resolveAllowedModes` has no fallback, on purpose.** An empty intersection
returns `[]`, `placeOrder` refuses, and checkout states that it cannot take
payment for this basket with the button disabled. It used to fall back to
`["direct"]` — silently reinterpreting an order into something the shopper never
agreed to. Any fallback reintroduces that bug in a new costume.

Cash costs the store money (NimbusPost charges to collect it), so
`codFeeAmount` / `partialFeeAmount` are added at checkout as a **named line**,
ride the cash leg only, and are frozen onto `Order.paymentFee` — stored, not
recomputed, so a past order still adds up after the setting changes.

## A `"use server"` file may only export async functions

`export const CHECKOUT_MODES = [...]` from `src/app/actions/orders.ts` broke
**every** server action in that module at runtime:

```
A "use server" file can only export async functions, found object
```

`tsc` passes it and `next build` passes it — same class as the RSC traps below,
and found only by loading checkout. Constants shared with a client belong in
`lib/`, or stay module-private.

## RSC boundary traps — neither is caught by tsc or `next build`

Both of these took down live admin pages on 2026-09-22, and both have since
recurred in new code. They only throw when a page **renders**, so a clean
typecheck and a clean build prove nothing about them.

**1. Never pass an icon *component* from a server component to a client one.**

```tsx
<Block icon={ShoppingBag}>        // ✗ throws
<Block icon={<ShoppingBag />}>    // ✓ an element serialises
```

Lucide icons are `forwardRef` objects, so this is a function crossing the
boundary:

```
Functions cannot be passed directly to Client Components…
{$$typeof: ..., render: function, displayName: ...}
```

It is easy to miss because it is **legal between two client components** — so a
shared component like `Block` or `Disclosure` works everywhere until the first
server caller. Type any `icon` prop as `React.ReactNode`, never `LucideIcon`.

**2. A server component may not call a function exported from a `"use client"`
module.** Everything such a module exports is a client *reference*:

```
Attempted to call isTabKey() from the server but isTabKey is on the client.
```

Constants, type guards and pure helpers shared by both sides belong in `lib/`,
in a module with no directive. Types are erased at build time, so importing a
*type* from a client module is fine — it is only runtime values that break.

## Turbopack workspace root

There is a stray `package.json` + `package-lock.json` in the user's home
directory. Turbopack finds it while walking up for a lockfile and infers
`C:\Users\15ind` as the workspace root, which makes `next build` die at the end
with `ENOENT .next/server/pages-manifest.json` (an App-Router-only app never
emits that file). `next.config.ts` pins `turbopack: { root: __dirname }`. Don't
remove it.

## Chat (replaces the old one-way inbox)

`ChatThread` / `ChatMessage`, polled — not WebSockets, this is serverless.
`src/lib/chat.ts` holds identity resolution, guest→account claiming, delivery
states and validation; the customer never names a thread id, it is resolved from
the session or the `level7_chat_guest` cookie. Claiming happens lazily inside
thread resolution rather than in the login action, so it also catches someone who
signs up after chatting or logs in in another tab.

## Admin table selection — one primitive, and one rule that is a safety gate

`src/components/admin/selection.tsx` is the only multi-select in the admin.
Products, media, portfolio and orders had each grown their own, each supporting
a different subset — some had select-all, none had shift-range, none had drag.

**The rule that matters: a selection is always intersected with what is
currently visible.** Narrowing a filter must narrow what a bulk action can
reach. Media got this wrong and it was a live hazard, not a nicety — its bulk
bar deletes, `selectedPhotos` was derived from *all loaded* photos, so
selecting 30, filtering to 3 and pressing Delete removed 30. Proven fixed on
`/admin/products`: 3 selected, filter to `?q=hoodie`, selection → 0 and the
bulk bar disappears.

**The one deliberate exception is `photo-picker.tsx`**, which still accumulates
across filters. That is not an oversight — picking photos for a product means
browsing several filters and collecting from each, and nothing there destroys
anything. Bulk-acting and picking want opposite rules.

Two interaction details that are easy to get wrong:

- **Use `SelectHandle` for rows, not `rowSelectionProps` on the row.** Every
  admin row carries controls (hide, duplicate, edit, delete), and a
  `pointerdown` listener on the row fires for those too — pressing Delete
  toggled the row's selection on the way. `rowSelectionProps` now also ignores
  presses that land on `a,button,input,select,textarea,label`.
- **A row toggles on `pointerdown`, not `click`.** A sweep that starts on row A
  and releases on row C never fires a click on A, so a click-driven toggle
  leaves the first row of every drag unselected. The keyboard path survives via
  `e.detail === 0`, which a Space/Enter-generated click reports and a real
  pointer click never does.

## Media "used by" gates the delete button — so it must list every owner

`/api/admin/media` builds the `usage` map, and the library's bulk delete splits
the selection on `usage[url].length`. A photo that no owner claims is deleted
without a second prompt.

It used to query `ProductImage` alone, with a comment asserting products were
the only owner. That stopped being true: **portfolio items, category and
subcategory covers, the site logo and the legacy `Product.images` array** all
reference a media URL and none is a join table. Three category covers on this
store were affected. All six reads now run in one `Promise.all`, bounded to the
URLs on the current page, and each use links to the screen that owns it
(`usageHref` in `media-library.tsx`). **Add a new owner there when you add a
column that stores a media URL.**

## The component-orphan trap

Four finished components were imported **nowhere**, so features documented as working
were silently dead: the size guide, the wishlist heart, the newsletter form and the
address book. `WishlistProvider` was also missing from `providers.tsx` entirely, which
made `useWishlist()` throw and took out the whole `/wishlist` page.

They typecheck clean and lint clean — nothing catches an unused component. When a big
refactor lands, grep each store component for an importer:

```bash
for c in SizeGuideModal WishlistButton NewsletterForm AddressBook; do
  printf "%s: " "$c"; grep -rl "$c" src/ --include=*.tsx | grep -v "$(echo "$c")" | wc -l
done
```

Also note `size` can be either the **visual** (image-card) attribute or a **pill**
group depending on the product, so anything hung off the size selector must render
outside that branch or it disappears for half the catalogue.

## PWA, and auto-refresh on deploy

- `src/app/manifest.ts` (brand strings from `getSettings()`), `public/sw.js`,
  icons generated by `npm run pwa:icons` into `public/icons`.
- The worker is **production-only** and deliberately conservative: navigations are
  network-first, and `/api`, `/admin`, `/account`, `/checkout`, `/cart`, `/order`,
  `/wishlist` are never cached — stale prices or one shopper seeing another's order
  would be far worse than a slower load. It also skips RSC payloads.
- `UpdateWatcher` polls `/api/version` and compares against `buildId()` rendered into
  the shell. It reloads automatically **only when it is safe** — nothing typed, no
  dialog open, not on checkout/account/admin/order — and otherwise shows a Refresh
  prompt. A `sessionStorage` guard stops a reload loop when two deployments serve at
  once.

## Safe areas — go through a CSS variable, never `env()` directly

`viewportFit: "cover"` (set in `src/app/layout.tsx`) extends the page under the
iPhone status bar. Nothing padded the top, so on a Dynamic Island phone the
installed PWA drew its header under the clock. The fix is three pieces, and
`pt-safe` on the header alone is **not** one of them — padding whichever bar
happens to be topmost leaves a 59px gap under the announcement strip at scroll
zero:

- `body` carries `pt-safe px-safe`, so nothing *starts* under the island;
- the sticky header uses **`top-safe`, not `top-0`**, so it *pins* below the
  island rather than at y=0;
- `.status-bar-scrim` (fixed, `height: var(--sa-top)`, `--status-bar` matching
  `themeColor`) paints the band, so content scrolling through it is hidden
  rather than sliding under the clock.

**Every inset reads through `--sa-top/right/bottom/left`, declared in
`@layer base`.** That indirection is not decoration — it is what makes the
whole thing testable without the phone: `env()` cannot be overridden from
JavaScript, a `var()` can. Verify with
`document.documentElement.style.setProperty('--sa-top','59px')` and assert the
stuck header's `getBoundingClientRect().top` is 59. Proven that way on
2026-09-22; before the fix it was 0.

Also: the header's `transition-all` was transitioning `top`, so rotating the
phone (inset 59 → 0) turned the correction into a half-second slide of the
whole header. Transition only the properties that change on scroll.

## The design system is stated here and was not enforced in code

`ui/button.tsx` — the one component every storefront button is built from —
was `rounded-full` with `hover:-translate-y-0.5` and a `btn-shine` class, long
after this file said buttons are "squared `rounded-lg` … colour-change only"
and listed "button shine and hover-bounce" among the effects **removed on
purpose**. The shine had been reduced to an inert `position: relative` and the
other two simply survived.

Squared and de-bounced on 2026-09-22, along with the last `hover:-translate-y`
call sites in `product-actions.tsx` and `product-gallery.tsx`. `.btn-shine` is
kept as `position: relative` only, because a button may position a badge
against it. **When this file describes the system, grep for violations rather
than assuming the components follow it.**

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

**This is now fixed** — the live project runs in `bom1`, and DB-backed routes
measure **0.23–0.55 s** TTFB. Keep the region there; the history below explains why.

| Route type | TTFB in `iad1` (old) | TTFB in `bom1` (now) |
|---|---|---|
| Static (`robots.txt`) | 0.08 s | 0.08 s |
| DB-backed (home, shop, product) | **4.4–4.6 s** | **0.23–0.55 s** |
| One DB query from a dev machine in India | ~100 ms | ~100 ms |

It was never the client, the network or Supabase. The cause was **geography**: the
function region was **`iad1` (Washington DC)** while Supabase is **`ap-south-1`
(Mumbai)** — every query crossed the planet, and `connection_limit=1` *serialised*
those hops, so N queries cost N round trips with no overlap. Nothing in the code can
compensate for a ~250 ms floor per query, which is why the region is the whole fix.

The region is a **project setting, not in `vercel.json`** — a new Vercel project
defaults to `iad1` and silently reintroduces the 4.4 s floor.

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
and verified live against this account (org `level7clothing`, **sole warehouse
`Artvelle`**, Gandhinagar 382016 — read the warehouse note below before changing
that name anywhere).

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

### What the admin shows is decided by `shipmentGateFor()`, not by the panel

One pure function in `lib/orders-pipeline.ts`, **enforced by the server actions
and used by the panel**, so the button offered and the rule applied cannot
diverge:

| gate | screen |
|---|---|
| `booked` — an AWB exists, **tested first** | **tracking only**: courier, AWB, tracking link, latest scan, Sync. Hand-editing folded away. **No booking controls at all.** |
| `pending` | one sentence, zero controls |
| `closed` — cancelled / payment failed | one sentence, zero controls |
| `done` — delivered / returned / rto, nothing staged | one sentence — nothing left to ship |
| `ready` — confirmed / shipped, nothing staged | Ship now · Send draft |
| `staged` — a draft exists | Book AWB · Sync · Cancel draft |

**Cancel draft survives on pending, cancelled and delivered rows**, which looks
like it breaks the table and does not. It cannot put anything on a courier — it
withdraws a draft already sitting in NimbusPost that anyone reviewing that list
could book and be charged for. A stale draft is a liability, not a leftover.
`can.sync` is false for a hand-typed AWB: there is no NimbusPost record to ask.

**The trigger is one enum, not four modes.** `SiteSettings.dispatchOnConfirm`
is `off | draft | book`, and the courier choice is asked only when it is
`book`. The four paths people describe ("auto-draft", "auto-book", "manual
book", "manual draft") are this enum crossed with who pressed it.

It is **nullable with no default on purpose.** `dispatchModeOf()` is the single
reader: the enum wins, and a null falls back to the legacy
`autoShipOnConfirm` boolean. A `@default("draft")` would have silently switched
off a store deliberately set to auto-book. `autoShipOnConfirm` is kept as a
derived mirror written in step by the one writer, so nothing reading the old
field reads a lie.

Three bugs this replaced, all money-shaped: **one button meant two things** —
its label flipped between "Send draft" (free) and "Book & generate AWB"
(charges the wallet) on hidden state, same colour, no confirmation on the
single-order path; **`booked` was `Boolean(order.trackingNumber)`**, so typing
into the manual tracking box made the whole draft/book UI vanish as if
NimbusPost had booked it; and **pending orders were offered "Send draft"**,
with no status check in `dispatchOrder` either. The manual courier inputs also
stayed editable after booking — a second writer for columns NimbusPost owns,
the same shape as the `defaultReturnsInfo` trap above.

### Two things that will block a real booking

- **Wallet is ₹0.00.** Drafts are free; booking needs a top-up.
- `NIMBUSPOST_WAREHOUSE_NAME` is **`"Artvelle"`**, and that is correct — checked
  against `GET /v2/warehouses` on 2026-09-22, which returns **exactly one**
  warehouse, named `Artvelle`. This line previously claimed `"clothing"`, which
  was never true; an agent then read the mismatch against this file as a bug and
  reported that every booking silently falls back to the primary warehouse. It
  does not — the name matches exactly and resolution succeeds. **Do not "fix"
  the env var to `clothing`; that would genuinely break it.**

  The warehouse is, however, still named after the **legacy brand** this repo has
  otherwise purged. That is a name inside the NimbusPost account, not in this
  codebase, so renaming it is a dashboard job for the owner — and the env var has
  to change in the same breath, or booking breaks. Until then a courier label may
  carry the old name.

  The client resolves via `GET /v2/warehouses` (matching name / display name /
  code, falling back to the primary), so a mismatch warns rather than hard-failing.

## The reverse leg — returns are a second shipment, not a status

A return is a parcel travelling the other way, and until 2026-09-22 only half
of that existed. What was wired: approving a return created a reverse **draft**
(`decideReturn` → `draftReturnPickup` → `createReverseDraftOrder`). What was
not:

- **Nothing could book it.** No return path ever called `shipDraft`. The card
  said "book the courier in NimbusPost", which was a dead end, because…
- **`ReturnRequest.nimbusAwb` / `nimbusCourier` existed and nothing ever wrote
  them.** Two columns, zero writers.
- **The webhook only ever looked up `Order.trackingNumber`**, so every reverse
  scan hit "No order found — ignoring" and was dropped with a 200. A pickup
  could be collected, travel and arrive with nothing in this database moving.
- **Refunds were not gated on the goods.** `markRefundPaid` accepted `approved`,
  so money could leave with the item still in the customer's hallway, and
  nothing on screen said so.
- **RTO** (delivery failed, parcel returns to origin) set the order to
  `cancelled`, which emails the customer the word "cancelled" and leaves no
  record that goods are coming back.

Now: `src/lib/nimbus-returns.ts` holds the reverse helpers, and the reverse
status vocabulary in `lib/returns.ts` is built **on `mapNimbusStatus`, not
beside it** — see "one shared status map". The reverse leg inverts the ends:
courier `shipped` → `picked_up`, courier `delivered` → `received`.

Three rules worth keeping:

1. **Draft-first applies here too.** `bookReturnPickup` refuses to *create* —
   it only books a draft that already exists, and the button names the wallet
   charge before it runs.
2. **An AWB that matches both an order and a return is not guessed.** The
   webhook refuses, changes nothing, names both records and returns 409. The
   tempting "fix" — writing a reverse AWB onto `Order.trackingNumber` — would
   clobber the forward AWB and let a failed pickup cancel a delivered order.
3. **Refunding before the goods are back is a confirmation, not a block.** A
   hard refusal just pushes someone into marking a return "received"
   dishonestly, which destroys the only record of where the parcel actually is.
   The panel states the parcel's location and the button reads "Refund early —
   goods not back".

`/api/cron/nimbus-sync` polls **both legs** in one `Promise.allSettled`, so one
failing does not abandon the other.

### Known gaps, deliberately left

`ReturnRequest` has no `deliveryStatus` / `deliveryStatusAt` / `lastSyncedAt`
(raw reverse scans go into `statusHistory` JSON instead, so there is no indexed
way to find a stale reverse shipment), no `refundedEarly` flag (early payouts
are in the history note — auditable, not queryable), and no stored
`trackingUrl` (it is synthesised from the AWB). RTO is detected by a
`contains "rto"` scan of `Order.deliveryStatus` rather than an `rtoHandledAt`
column, so the RTO band cannot be dismissed and a later scan overwriting the
text loses the order. All four are columns, not logic — add them together.

Reverse events also send **no customer email**: `sendOrderStatusEmail` talks
about an order's progress, which is the wrong voice for a parcel going the
other way. A return template belongs in `lib/email.ts`.

## Email has been silently undeliverable — `EMAIL_FROM` cannot be a Gmail address

`.env` had `EMAIL_FROM="genzclothingdemo@gmail.com"`. **Resend only sends from a
domain you have verified in your Resend account**, and nobody can verify
`gmail.com`, so every send returned 403. `lib/email.ts` catches that and logs a
console warning, which means **order confirmations, password resets and contact
replies have all been failing without a single visible error** — the code path
looks like it worked and returns fine.

It surfaced only when Admin → Automation gave the failures a screen to appear on.

Local `.env` now reads `EMAIL_FROM="Level7 Clothing <onboarding@resend.dev>"`,
which is Resend's shared sending domain and needs no verification.
**Production reads its own copy from Vercel and is still wrong until that is
changed** — Settings → Environment Variables → `EMAIL_FROM`, then redeploy.

Two caveats worth knowing before trusting it:

- `onboarding@resend.dev` on a free Resend account will only deliver to **the
  address that owns the Resend account**. Good enough to prove the pipeline;
  not good enough for real customers.
- The real fix is a verified domain. `level7clothing.shop` is disabled (see the
  top of this file), so that has to be sorted first — which is why this is
  written down rather than quietly "fixed".

Also: the `RESEND_API_KEY` in `.env` is a **send-only restricted key**. It
returns `401 restricted_api_key` for `GET /domains`, so you cannot list or
verify domains with it — don't waste time trying.

## Errors must not become 404s

`getProductBySlug` intentionally **does not** catch DB errors. Callers turn `null`
into `notFound()`, so swallowing an error told Google a live product was deleted.
Let it throw → 500 → crawlers retry instead of deindexing. Don't add a try/catch back.

> **It came back once already.** The upstream V2 port (`851c099`) reintroduced
> the try/catch, and it sat there while `promotions.ts` and `getProductsBySlugs`
> both carried comments reading "unlike `getProductBySlug`, this DOES swallow
> errors" — the surrounding code was relying on a rule the function had stopped
> keeping. Removed again on 2026-09-22, along with the missing `cache()` wrapper
> this file already claimed it had: the product page asks for the same row twice
> (`generateMetadata` and the body), which without it is two round trips to
> Mumbai per page view.

## Commands

```bash
npm run dev              # dev server (localhost:3000)
npm run db:push          # push schema
npm run db:seed          # DESTRUCTIVE: deletes + recreates all products
npm run db:backup        # snapshot the DB to scripts/tmp/ (gitignored)
npm run media:manifest   # rebuild src/lib/media-manifest.json from public/products
npm run pwa:icons        # regenerate public/icons (PWA / home-screen icons)
npm run shipping:free    # safe: only shipping fields, keeps reviews/orders
npx tsc --noEmit         # typecheck
npx next build           # production build
```

`db:seed` wipes products. It now **refuses to run when the database holds real
orders** unless you set `SEED_ALLOW_DESTRUCTIVE=1`, because it also orphans the
reviews and photo links. To change shipping or settings on live data, use
targeted scripts in `scripts/` instead.

**`npm run build` must never contain `prisma db push`.** A wholesale copy from
upstream reintroduced it once, and because the schema at that moment was missing
`Address` and `NewsletterSubscriber`, the next deploy would have dropped both
live tables.

## Copying files from the upstream repo will break these

The upstream resin store shares most of this codebase, so copying files across
looks safe and is not. Each of these has bitten exactly once — see
`UPGRADE-STATUS.md` §0 for the full repair log.

- **`Address` and `NewsletterSubscriber` are Level7-only models.** They do not
  exist upstream, so any schema copy silently deletes them.
- **`prisma/seed.ts` is Level7's catalogue.** The upstream one seeds resin art.
- **`SubcategoryImage` must not exist.** It has no table in the live DB and
  nothing writes it. Schema and DB are currently in exact step — 16 models,
  16 tables — so no `db push` is needed at all.
- **Photos live flat in `public/products/level7/`**, not
  `public/products/gallery/`. `lib/media.ts` and `scripts/build-media-manifest.mjs`
  both scan `public/products`; pointing them at `gallery` empties the admin photo
  picker silently and makes the build write an empty manifest.
- **Cookie names come from `src/lib/auth-cookie.ts`**, imported by both
  `src/proxy.ts` and `lib/auth.ts`. Re-declaring the name in either file makes
  admin login bounce back to the login page forever.
- **There is no `src/middleware.ts`** — Next 16 uses `src/proxy.ts` exporting
  `proxy`. Having both means two admin gates with two different cookies.
- **`lib/products.ts` must keep `getProductsBySlugs`** — the Level7-only wishlist
  and recommendations routes import it.
- **`.gitignore` must ignore all of `scripts/tmp/`** (DB snapshots contain order
  PII and password hashes), and `!.env.example` must stay after the last `.env*`.

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
