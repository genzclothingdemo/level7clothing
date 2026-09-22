/**
 * Analytics — the one place every figure in the Admin → Dashboard workspace is
 * worked out.
 *
 * ── Why this module exists ───────────────────────────────────────────────────
 *
 * "Revenue" is not a fact, it is a definition, and a dashboard that quietly
 * uses three of them is worse than no dashboard. Every metric here is defined
 * once, in `METRIC` at the bottom of this file, and the UI renders that same
 * text behind the (i) beside the number. If a definition changes it changes in
 * one place and the explanation follows it — the number and its meaning cannot
 * drift apart.
 *
 * ── The five decisions everything else follows from ──────────────────────────
 *
 * 1. **An order is counted when it is PLACED (`createdAt`), not when it is
 *    paid.** Payment lands days later on COD and never on an abandoned prepaid
 *    attempt, so dating revenue by payment would move money between periods
 *    every time a courier ran late. Cash is tracked separately, below.
 *
 * 2. **Cancelled orders are excluded from every money figure** and reported
 *    beside it as their own count and value. They are history, not business.
 *    Nothing else is excluded: a `pending` order is revenue *booked*, which is
 *    exactly why "booked" and "collected" are two different numbers here.
 *
 * 3. **Revenue is net of discounts and excludes shipping.**
 *    `net revenue = Σ (subtotal − discountTotal)`. Shipping is money that
 *    passes through to a courier, not merchandise the store sold, so it is
 *    reported on its own line rather than folded in. (`Order.total` is
 *    `subtotal + shipping − discountTotal`; it is reported as "billed".)
 *
 * 4. **Refunds are dated when the money left (`refundedAt`), not when the
 *    order was placed.** They therefore do NOT net out inside the revenue
 *    series — a refund in this window can belong to an order from the last
 *    one. The summary states the mismatch instead of hiding it.
 *
 * 5. **`balanceDue` is a demand, not a receipt.** It is written once at
 *    checkout and never decremented when the courier hands the cash over, so
 *    reading it as "money we have" would invent income on every undelivered
 *    COD parcel. It counts as collected only once the order is delivered or
 *    the owner marked it paid — via `cashInHand()` in `lib/returns.ts`, the
 *    same function the refund engine uses, so the two can never disagree.
 *
 * ── What is deliberately NOT here ────────────────────────────────────────────
 *
 * No sessions, page views, impressions, reach, bounce rate, conversion rate,
 * return on ad spend, profit or margin. No analytics provider is wired up to
 * this store and there is no cost price on a product, so none of those exist
 * in any table. See `NOT_MEASURED` at the bottom — the UI renders it verbatim,
 * with the one change each would need, rather than leaving a
 * plausible-looking gap for someone to read a number into.
 *
 * ── Performance ──────────────────────────────────────────────────────────────
 *
 * `getFinanceReport` is one `Promise.all` of thirteen queries. **One** of them
 * reads rows: a single windowed `findMany` over orders, out of which the
 * per-day, per-product, per-place, per-variant, per-courier and per-duration
 * breakdowns are all folded in memory — `Order.items` and `Order.statusHistory`
 * are JSON and no `groupBy` can reach inside them, and re-querying per
 * breakdown would be N round trips to Mumbai for arithmetic we are already
 * holding the rows to do. Everything else (the previous period, refunds,
 * coupons, lead and wishlist counts, the catalogue totals) is
 * `aggregate`/`groupBy`, so those rows never travel. `getAttentionQueue` is
 * nine `count`s — index scans, no rows. `getCustomerAnalytics` delegates to
 * `lib/customers`, which is six more parallel reads, React-cached so Admin →
 * Customers and this workspace share one resolution per request.
 *
 * **This store is small** — 22 products and orders in the low hundreds, so the
 * windowed row set is tens of kilobytes and the folds are microseconds.
 *
 * What would break first, in order, if it grew:
 *
 * 1. The unbounded `findMany` over orders on the "All time" range. At ~50k
 *    orders that is a multi-megabyte payload, and `statusHistory` makes each
 *    row considerably fatter than it used to be. The fix is a nightly rollup
 *    table (order_day / product_day / variant_day) written on order state
 *    change, with this module reading the rollup for anything older than the
 *    current month and live rows only for the current one.
 * 2. `getCustomers()`, which reads **every** order in the store regardless of
 *    the window, because identity is an all-time question. Its own header
 *    says what to do: page the orders query in SQL and resolve a page at a
 *    time. The cohort and RFM folds here would then run per page.
 * 3. The `Everything that sold` and `Slow movers` tables, which page in memory
 *    over the full product list. Fine at 22 products; at a few thousand they
 *    want `skip`/`take` in SQL, which needs the rollup from (1) first.
 *
 * Nothing in the definitions above would change in any of the three.
 */

import { prisma } from "@/lib/prisma";
import { cashInHand } from "@/lib/returns";
import { getCustomers, type CustomerRecord } from "@/lib/customers";

/* ------------------------------------------------------------------ */
/*  Time windows                                                       */
/* ------------------------------------------------------------------ */

export const FINANCE_RANGES = [
  { value: "7", label: "7 days", days: 7 },
  { value: "30", label: "30 days", days: 30 },
  { value: "90", label: "90 days", days: 90 },
  { value: "all", label: "All time", days: null },
] as const;

export type RangeKey = (typeof FINANCE_RANGES)[number]["value"];

export const DEFAULT_RANGE: RangeKey = "30";

export function isRangeKey(v: string | undefined): v is RangeKey {
  return !!v && FINANCE_RANGES.some((r) => r.value === v);
}

export type FinanceWindow = {
  key: RangeKey;
  /** "Last 30 days" / "All time" — used in copy so the period is always named. */
  label: string;
  /**
   * The same period as a noun phrase that can follow "in", "over" or "across":
   * "the last 30 days" / "the store's whole history".
   *
   * It exists because `the ${label.toLowerCase()}` produces "the all time",
   * which appeared on five screens before anyone read them out loud. A label
   * and a phrase are two different jobs and a dashboard that is this careful
   * about its arithmetic should not be sloppy about its sentences.
   */
  phrase: string;
  days: number | null;
  /** Inclusive lower bound. `null` on "All time". */
  from: Date | null;
  /** Exclusive upper bound — always "now". */
  to: Date;
  /**
   * The equally long window immediately before this one, for the deltas.
   * `null` on "All time", where there is nothing to compare against.
   */
  previous: { from: Date; to: Date } | null;
};

const DAY_MS = 86_400_000;

/**
 * Resolve the URL's `range` into a half-open interval `[from, to)`.
 *
 * Half-open on purpose: an order placed at the exact boundary instant belongs
 * to exactly one of two adjacent periods, so the two never double-count and
 * their sum is the whole. The previous period is the same length ending where
 * this one starts, so "vs previous" compares like with like.
 */
export function resolveWindow(raw: string | undefined, now: Date): FinanceWindow {
  const key: RangeKey = isRangeKey(raw) ? raw : DEFAULT_RANGE;
  const spec = FINANCE_RANGES.find((r) => r.value === key)!;

  if (spec.days === null) {
    return {
      key,
      label: "All time",
      phrase: "the store's whole history",
      days: null,
      from: null,
      to: now,
      previous: null,
    };
  }
  const from = new Date(now.getTime() - spec.days * DAY_MS);
  return {
    key,
    label: `Last ${spec.days} days`,
    phrase: `the last ${spec.days} days`,
    days: spec.days,
    from,
    to: now,
    previous: { from: new Date(from.getTime() - spec.days * DAY_MS), to: from },
  };
}

/** A Prisma `where` fragment for a date column inside the window. */
function within(from: Date | null, to: Date) {
  return from ? { gte: from, lt: to } : { lt: to };
}

/* ------------------------------------------------------------------ */
/*  Day bucketing                                                      */
/* ------------------------------------------------------------------ */

/**
 * Timestamps are stored in UTC; the shop, its customers and its couriers are
 * all in India. Bucketing by UTC day would file a 1 a.m. IST order under
 * yesterday, so every bucket boundary here is **IST (UTC+05:30)**. India has
 * no daylight saving, so a fixed offset is exact rather than an approximation.
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export const TIMEZONE_NOTE = "Days start and end at midnight IST (UTC+05:30).";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** `2026-09-21`, in IST. Sorts lexicographically, which is why it is a string. */
function istDayKey(d: Date): string {
  const shifted = new Date(d.getTime() + IST_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Midnight IST that starts the given day key, as a real instant. */
function istDayStart(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) - IST_OFFSET_MS);
}

function labelForDay(key: string): string {
  const [, m, d] = key.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

export type Granularity = "day" | "week" | "month";

export const GRANULARITIES = [
  { value: "auto", label: "Auto" },
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
] as const;

export type GranularityChoice = (typeof GRANULARITIES)[number]["value"];

export function isGranularityChoice(v: string | undefined): v is GranularityChoice {
  return !!v && GRANULARITIES.some((g) => g.value === v);
}

/**
 * Bucket size is chosen from the span, not from the range name, so "All time"
 * behaves sensibly whether the store is a week or three years old. The aim is
 * roughly 7–35 bars: fewer and the shape is noise, more and they are hairlines.
 */
function pickGranularity(spanDays: number): Granularity {
  if (spanDays <= 45) return "day";
  if (spanDays <= 270) return "week";
  return "month";
}

/**
 * Past this many bars the chart stops being a chart — at 320px each column is
 * under a pixel wide and the whole plot is a grey smear. The reader's explicit
 * choice is honoured right up to the ceiling and then overruled, with the UI
 * told it was overruled (`granularityForced`) rather than quietly disobeying.
 */
const MAX_BUCKETS = 120;

function bucketsIn(spanDays: number, g: Granularity): number {
  if (g === "day") return Math.ceil(spanDays);
  if (g === "week") return Math.ceil(spanDays / 7);
  return Math.ceil(spanDays / 30);
}

function resolveGranularity(
  spanDays: number,
  choice: GranularityChoice
): { granularity: Granularity; forced: Granularity | null } {
  const auto = pickGranularity(spanDays);
  if (choice === "auto") return { granularity: auto, forced: null };
  if (bucketsIn(spanDays, choice) > MAX_BUCKETS) {
    return { granularity: auto, forced: choice };
  }
  return { granularity: choice, forced: null };
}

/** The bucket a day key falls into, and the label that bucket wears. */
function bucketOf(dayKey: string, g: Granularity): { key: string; label: string } {
  if (g === "day") return { key: dayKey, label: labelForDay(dayKey) };
  if (g === "month") {
    const [y, m] = dayKey.split("-").map(Number);
    return { key: `${dayKey.slice(0, 7)}-01`, label: `${MONTHS[m - 1]} ${String(y).slice(2)}` };
  }
  // Weeks start on Monday — the courier week, and how the owner thinks of a drop.
  const start = istDayStart(dayKey);
  const dow = new Date(start.getTime() + IST_OFFSET_MS).getUTCDay(); // 0 = Sunday
  const backToMonday = (dow + 6) % 7;
  const monday = new Date(start.getTime() - backToMonday * DAY_MS);
  const key = istDayKey(monday);
  return { key, label: labelForDay(key) };
}

export type SeriesPoint = {
  /** IST day key of the bucket start — the stable identity of the bar. */
  key: string;
  label: string;
  netRevenue: number;
  orders: number;
  units: number;
};

/* ------------------------------------------------------------------ */
/*  Order lines                                                        */
/* ------------------------------------------------------------------ */

/**
 * `Order.items` is a by-value snapshot written at checkout: the name and price
 * are what the customer actually saw, and they are deliberately not updated
 * when the product is later renamed, repriced or deleted. Everything here
 * treats the JSON as untrusted — a hand-edited row must degrade to a sensible
 * line, not throw and take the whole dashboard down.
 */
type OrderLine = {
  productId: string | null;
  name: string;
  price: number;
  quantity: number;
  /** The variant the shopper actually picked: Size: L, Colour: Black, … */
  options: { name: string; value: string }[];
};

function parseLines(raw: unknown): OrderLine[] {
  if (!Array.isArray(raw)) return [];
  const out: OrderLine[] = [];
  for (const entry of raw) {
    const it = (entry ?? {}) as Record<string, unknown>;
    const quantity =
      typeof it.quantity === "number" && Number.isFinite(it.quantity)
        ? Math.max(0, Math.trunc(it.quantity))
        : 1;
    const price =
      typeof it.price === "number" && Number.isFinite(it.price)
        ? Math.max(0, Math.round(it.price))
        : 0;
    const name = typeof it.name === "string" && it.name.trim() ? it.name.trim() : "Unnamed item";
    const productId =
      typeof it.productId === "string" && it.productId.trim() ? it.productId.trim() : null;
    // Options are the same by-value snapshot as the name and price: what the
    // shopper chose, frozen. A product whose option list changed later does not
    // rewrite what was bought, which is exactly why the size mix is trustworthy.
    const options = Array.isArray(it.options)
      ? (it.options as { name?: unknown; value?: unknown }[])
          .filter(
            (o) =>
              typeof o?.name === "string" &&
              typeof o?.value === "string" &&
              o.name.trim() !== "" &&
              o.value.trim() !== ""
          )
          .map((o) => ({ name: String(o.name).trim(), value: String(o.value).trim() }))
      : [];
    out.push({ productId, name, price, quantity, options });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Free-text normalisation                                            */
/* ------------------------------------------------------------------ */

/**
 * Split a value a human (or a product form) typed into the spelling to show
 * and the key to group by: trimmed, inner whitespace collapsed, case folded.
 * `null` when there is nothing there at all.
 *
 * The case fold is deliberately the *whole* of the normalisation. It merges
 * "gujarat", "Gujarat" and "  GUJARAT " — differences that are certainly the
 * same thing — and it leaves "Gujrat" alone, because collapsing a misspelling
 * would need a gazetteer and a guess, and a wrong guess silently welds two
 * real places into one row that nobody can unpick. The screens that use this
 * say so. The same rule covers option names ("Size" / "size"), option values
 * and courier names, so all four fold identically.
 */
function normaliseTyped(raw: string | null | undefined): { spelling: string; key: string } | null {
  const spelling = (raw ?? "").trim().replace(/\s+/g, " ");
  if (!spelling) return null;
  return { spelling, key: spelling.toLowerCase() };
}

/**
 * Pick the spelling to show for a folded key: the variant that appears most
 * often, ties broken by the alphabetically first, so the label is stable across
 * page loads rather than "whichever row the database happened to return first".
 */
function commonestSpelling(counts: Map<string, number>): string {
  let best = "";
  let bestN = -1;
  for (const [spelling, n] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (n > bestN) {
      best = spelling;
      bestN = n;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/*  Order timeline                                                     */
/* ------------------------------------------------------------------ */

/**
 * When an order FIRST reached a status, read out of `Order.statusHistory`.
 *
 * The columns on `Order` say where a parcel is; only the history says when it
 * got there, which is the whole of dispatch and delivery time. Three things
 * this has to survive, because the history is untyped JSON appended from five
 * different call sites:
 *
 * - entries out of order (a courier scan is written with the courier's own
 *   timestamp, which can predate an entry already in the list) — so this scans
 *   every entry and keeps the EARLIEST match rather than the first one found;
 * - an unparseable or missing `at`, which is skipped rather than coerced to
 *   the epoch — a 1970 timestamp would land as a 20,000-day dispatch time and
 *   drag the mean somewhere absurd;
 * - a status the app no longer uses (`payment_failed` appears in real rows).
 *
 * FIRST rather than last, on purpose: an order re-marked delivered after a
 * correction was still delivered the first time, and dating it by the edit
 * would measure the admin's typing, not the courier.
 */
function firstHistoryAt(raw: unknown, status: string): Date | null {
  if (!Array.isArray(raw)) return null;
  let best: Date | null = null;
  for (const entry of raw) {
    const e = (entry ?? {}) as Record<string, unknown>;
    if (typeof e.status !== "string" || e.status.trim().toLowerCase() !== status) continue;
    const at = typeof e.at === "string" ? Date.parse(e.at) : NaN;
    if (!Number.isFinite(at)) continue;
    const d = new Date(at);
    if (!best || d.getTime() < best.getTime()) best = d;
  }
  return best;
}

/** Hours between two instants, or `null` when the pair runs backwards. */
function hoursBetween(from: Date, to: Date): number | null {
  const ms = to.getTime() - from.getTime();
  // A negative gap is a clock or data problem, not a fast courier. Dropping it
  // is the only honest option: clamping it to zero would quietly pull the
  // median down and claim same-hour dispatch that never happened.
  if (!Number.isFinite(ms) || ms < 0) return null;
  return ms / 3_600_000;
}

/**
 * The buckets a duration is shown in. Fixed rather than derived from the data,
 * because a reader compares this week's distribution against last week's and
 * a rebucketing between the two makes that impossible.
 */
const DURATION_BUCKETS: { key: string; label: string; maxHours: number }[] = [
  { key: "h6", label: "Under 6h", maxHours: 6 },
  { key: "h24", label: "6–24h", maxHours: 24 },
  { key: "d2", label: "1–2 days", maxHours: 48 },
  { key: "d4", label: "2–4 days", maxHours: 96 },
  { key: "d7", label: "4–7 days", maxHours: 168 },
  { key: "d7plus", label: "Over 7 days", maxHours: Infinity },
];

function summariseDuration(hours: number[]): Duration {
  const counts = new Map(DURATION_BUCKETS.map((b) => [b.key, 0]));
  for (const h of hours) {
    const b = DURATION_BUCKETS.find((x) => h < x.maxHours) ?? DURATION_BUCKETS[DURATION_BUCKETS.length - 1];
    counts.set(b.key, (counts.get(b.key) ?? 0) + 1);
  }
  const sorted = [...hours].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  // The median is the headline and the mean rides beside it: one late parcel
  // stuck in a depot for a fortnight moves the mean by days and the median not
  // at all, and the reader needs to be able to see which they are looking at.
  const median =
    sorted.length === 0
      ? null
      : sorted.length % 2 === 1
        ? sorted[mid]
        : (sorted[mid - 1] + sorted[mid]) / 2;
  const mean =
    sorted.length === 0 ? null : sorted.reduce((n, h) => n + h, 0) / sorted.length;

  return {
    count: sorted.length,
    medianHours: median,
    meanHours: mean,
    buckets: DURATION_BUCKETS.map((b) => ({
      key: b.key,
      label: b.label,
      count: counts.get(b.key) ?? 0,
    })),
  };
}

/** "4.5 h" / "2.1 days" — the unit that keeps the number readable. */
export function formatHours(h: number | null): string {
  if (h === null || !Number.isFinite(h)) return "—";
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${Math.round(h * 10) / 10} h`;
  return `${Math.round((h / 24) * 10) / 10} days`;
}

/**
 * Split an order-level coupon discount across its lines, pro rata by line
 * value, **exactly** — the shares always sum back to the discount.
 *
 * The naive `round(lineValue × discount / subtotal)` per line loses or invents
 * a rupee or two per order to rounding, which then shows up as top-seller
 * revenue that does not add up to the headline. Allocating against a running
 * cumulative total instead makes the last share absorb the residual, so
 * Σ shares === discount by construction.
 *
 * The denominator is Σ line value rather than `Order.subtotal`. They are equal
 * by construction at checkout (`subtotal = Σ price × quantity`), but using the
 * lines' own total keeps the allocation internally exact even on a legacy or
 * hand-entered row where they disagree.
 */
function allocateDiscount(lines: OrderLine[], discountTotal: number): number[] {
  const values = lines.map((l) => l.price * l.quantity);
  const base = values.reduce((n, v) => n + v, 0);
  if (discountTotal <= 0 || base <= 0) return values.map(() => 0);

  const shares: number[] = [];
  let cumulative = 0;
  let allocated = 0;
  for (const v of values) {
    cumulative += v;
    const target = Math.min(discountTotal, Math.round((cumulative * discountTotal) / base));
    shares.push(Math.max(0, target - allocated));
    allocated = target;
  }
  return shares;
}

/* ------------------------------------------------------------------ */
/*  Shapes                                                             */
/* ------------------------------------------------------------------ */

/** Money is whole rupees everywhere in this codebase. No paise, no floats. */
export type Money = number;

export type RevenueSummary = {
  /** Non-cancelled orders placed in the window. */
  orders: number;
  cancelledOrders: number;
  /** Σ subtotal — goods at the price shown, before any discount. */
  grossGoods: Money;
  /** Σ discountTotal — coupon value given away. */
  discounts: Money;
  /** Σ (subtotal − discountTotal). The headline. */
  netRevenue: Money;
  /** Σ shipping — charged to the customer, passed to a courier. */
  shippingCharged: Money;
  /** Σ total — what the customer was actually asked to pay. */
  billed: Money;
  /** Σ quantity across every line of every counted order. */
  units: number;
  /** netRevenue ÷ orders, rounded. Zero when nothing counted. */
  aov: Money;
  /** Value of the cancelled orders that were excluded above. */
  cancelledValue: Money;
  /** Counted orders that carried a coupon code. */
  couponOrders: number;
};

export type CashSummary = {
  /** Σ amountPaid — money that actually reached Razorpay. */
  online: Money;
  /** Σ balanceDue on orders whose parcel was delivered (or marked paid). */
  onDelivery: Money;
  /** online + onDelivery. */
  collected: Money;
  /** Σ balanceDue still in flight — billed, not yet in hand. */
  outstanding: Money;
  /** Σ total over the same counted orders — the denominator. */
  billed: Money;
};

export type RefundSummary = {
  /** Requests whose money actually went out inside the window. */
  paidCount: number;
  /** Σ refundGross — value of the returned goods before the fee. */
  gross: Money;
  /** Σ refundFee — what the store kept. */
  fee: Money;
  /** Σ refundAmount — what the customer received. */
  net: Money;
  /** Return requests RAISED in the window, dated by createdAt. */
  raised: number;
  /** Approved-but-unpaid requests, whenever raised — money still owed out. */
  pendingCount: number;
  pendingValue: Money;
};

export type Split = {
  key: string;
  label: string;
  orders: number;
  netRevenue: Money;
  /** Cash in hand for this slice — the whole point of splitting by method. */
  collected: Money;
  outstanding: Money;
};

export type ProductDemand = {
  /** Stable grouping key: the product id, else `name:<lowercased>`. */
  key: string;
  productId: string | null;
  /** Current catalogue name when the product still exists, else the snapshot. */
  name: string;
  slug: string | null;
  /**
   * - `catalogue` — the line's productId resolved to a live product row.
   * - `deleted`   — it carried a productId that no longer exists.
   * - `unlinked`  — the line had no productId at all (legacy or hand-entered);
   *                 grouped by name, so a rename splits it. Flagged, not hidden.
   */
  resolved: "catalogue" | "deleted" | "unlinked";
  /** Every distinct name the order lines used — shows a rename for what it is. */
  snapshotNames: string[];
  units: number;
  /** Σ (price × quantity) less this line's exact share of the order discount. */
  netRevenue: Money;
  /** Distinct counted orders containing it. */
  orders: number;
  stock: number | null;
  isActive: boolean | null;
  price: number | null;
  /** `Lead` rows (add-to-cart events) for this product inside the window. */
  cartAdds: number;
  /** `WishlistItem` rows saved inside the window, matched by slug. */
  wishlistSaves: number;
  /**
   * Σ quantity on return requests raised against orders PLACED in this window.
   * Same cohort as `units`, so `unitsReturned ÷ units` is a real rate rather
   * than two counts on two clocks divided by each other.
   */
  unitsReturned: number;
  /** unitsReturned ÷ units as a percentage. `null` when nothing sold. */
  returnRate: number | null;
  /**
   * stock ÷ (units ÷ days). Days of selling left at the window's own rate.
   * `null` when nothing sold, when the product is gone, or on "All time" —
   * a three-year average rate says nothing about next week.
   */
  daysOfCover: number | null;
};

export type FunnelSummary = {
  /** `Lead` rows created in the window — one per add-to-cart EVENT. */
  cartAdds: number;
  /** Σ quantity on those rows. */
  cartAddUnits: number;
  /** Distinct non-empty `visitorId`s among them. Browsers, not people. */
  cartBrowsers: number;
  /** Add-to-cart events that left no email and no phone. */
  anonymousCartAdds: number;
  /** `WishlistItem` rows saved in the window. Signed-in accounts only. */
  wishlistSaves: number;
  /** Counted orders placed in the window. */
  orders: number;
  units: number;
  leadsByStatus: { status: string; count: number }[];
};

export type CouponUse = {
  code: string;
  /** Redemptions recorded in the window. */
  uses: number;
  /** Σ discount actually applied, in rupees. */
  discount: Money;
  isActive: boolean;
};

/* ---- Where the orders came from ---------------------------------- */

export type PlaceSlice = {
  /** Case-folded key — see `foldKey`. */
  key: string;
  /** The commonest spelling the customers themselves typed. */
  label: string;
  orders: number;
  netRevenue: Money;
  units: number;
  /** Every distinct spelling folded into this row, for the caveat. */
  spellings: string[];
};

export type PlaceSplit = {
  states: PlaceSlice[];
  cities: PlaceSlice[];
  /** Counted orders whose state field was blank — excluded from `states`. */
  missingState: number;
  missingCity: number;
  /**
   * True when at least one row folded two or more different spellings
   * together. The screen says so rather than presenting a tidy list.
   */
  folded: boolean;
};

/* ---- Variant mix (size, colour, whatever the catalogue asks) ------ */

export type OptionValueSlice = {
  key: string;
  label: string;
  units: number;
  netRevenue: Money;
  /** Distinct counted orders containing at least one line with this value. */
  orders: number;
  /** Distinct products sold in this value. */
  products: number;
};

export type OptionDimension = {
  /** Case-folded option name — "size", "colour". */
  key: string;
  /** The commonest spelling the catalogue used — "Size". */
  label: string;
  values: OptionValueSlice[];
  /** Σ units across this dimension's values. The dimension's own denominator. */
  units: number;
  /**
   * Units on lines that carried NO value for this dimension — a product that
   * does not offer it, or a legacy line saved before it existed. Reported so
   * the percentages have a visible denominator instead of an implied one.
   */
  unitsWithout: number;
};

/* ---- Returns, as a rate rather than a pile of requests ------------ */

export type ReturnRate = {
  /**
   * Counted orders placed in this window that have since had at least one
   * return request raised against them, whenever it was raised.
   */
  ordersWithReturn: number;
  /** Σ quantity on those requests. */
  unitsReturned: number;
  /** ordersWithReturn ÷ counted orders, as a percentage. `null` at zero orders. */
  orderRate: number | null;
  /** unitsReturned ÷ units sold, as a percentage. `null` at zero units. */
  unitRate: number | null;
  /** Requests split by where they got to. */
  byStatus: { status: string; count: number }[];
  /** Why the customer sent it back, biggest first. */
  byReason: { reason: string; count: number; units: number }[];
};

/* ---- Fulfilment --------------------------------------------------- */

/** One duration measured across a set of orders, in hours. */
export type Duration = {
  /** Orders that had both timestamps, i.e. the real denominator. */
  count: number;
  /** The headline. Robust to the one parcel that sat in a depot for a week. */
  medianHours: number | null;
  meanHours: number | null;
  /** Ordered buckets for the distribution chart. */
  buckets: { key: string; label: string; count: number }[];
};

export type FulfilmentReport = {
  /** Counted orders in the window, by where they are right now. */
  awaitingConfirmation: number;
  awaitingDispatch: number;
  /** Confirmed, a NimbusPost draft staged, no AWB yet — the review gate. */
  draftStaged: number;
  inTransit: number;
  delivered: number;
  cancelled: number;
  /**
   * Orders whose latest RAW courier status mentions RTO. Not an order status —
   * `rto delivered` maps to `cancelled` — so this is read off
   * `Order.deliveryStatus`, which is whatever the courier last said.
   */
  rto: number;
  dispatch: Duration;
  delivery: Duration;
  /** Placed → delivered, end to end. */
  endToEnd: Duration;
  couriers: { key: string; label: string; orders: number; delivered: number }[];
  /** Shipped or delivered orders with no courier name recorded. */
  courierUnknown: number;
};

/* ---- Customers ----------------------------------------------------- */

export type RfmSegmentKey =
  | "champions"
  | "loyal"
  | "promising"
  | "needsAttention"
  | "atRisk"
  | "lost";

export type RfmCustomer = {
  id: string;
  name: string;
  /** 1–3, 3 = ordered most recently. */
  recency: number;
  /** 1–3, 3 = most orders. */
  frequency: number;
  /** 1–3, 3 = highest lifetime spend. */
  monetary: number;
  segment: RfmSegmentKey;
  daysSinceLastOrder: number;
  orders: number;
  spend: Money;
};

export type CohortRow = {
  /** IST month key of the cohort's first order, `2026-07-01`. */
  key: string;
  label: string;
  size: number;
  /**
   * One cell per month offset from the cohort's own first month. `null` means
   * "that month has not happened yet for this cohort" — NOT zero. A cohort
   * formed last month cannot have a month-2 figure, and drawing it as 0%
   * would invent a collapse in retention that is really just the calendar.
   */
  cells: (number | null)[];
  /** Customers active in each offset, alongside the percentage. */
  counts: (number | null)[];
};

export type CustomerAnalytics = {
  /** Everyone who has ever placed a counted order. Not windowed. */
  buyers: number;
  repeatBuyers: number;
  /** repeatBuyers ÷ buyers, as a percentage. `null` with no buyers. */
  repeatRate: number | null;
  /** Σ lifetime spend ÷ buyers. See METRIC.ltv — this is BILLED, not net. */
  meanLtv: Money;
  medianLtv: Money;
  /** Counted orders in the window, split by whether they were a first order. */
  windowNewOrders: number;
  windowReturningOrders: number;
  windowNewRevenue: Money;
  windowReturningRevenue: Money;
  /** Customers whose very first counted order fell inside the window. */
  newCustomers: number;
  /** Terciles, or `null` when there are too few buyers to cut them. */
  rfm: RfmCustomer[] | null;
  rfmCutoffs: { recencyDays: [number, number]; frequency: [number, number]; spend: [number, number] } | null;
  /** Counts for the 3×3 recency × frequency grid, `grid[recency][frequency]`. */
  rfmGrid: number[][] | null;
  segments: { key: RfmSegmentKey; label: string; customers: number; spend: Money }[];
  cohorts: CohortRow[];
  /** Widest cohort row — how many month columns the grid needs. */
  cohortWidth: number;
  top: RfmCustomer[];
  /** True when a query failed inside `lib/customers`. */
  degraded: boolean;
};

export type FinanceReport = {
  window: FinanceWindow;
  granularity: Granularity;
  /**
   * Set when the reader asked for a bucket size the span cannot carry, so the
   * chart silently disobeying them is impossible — the UI says it was changed.
   */
  granularityForced: Granularity | null;
  revenue: RevenueSummary;
  cash: CashSummary;
  refunds: RefundSummary;
  series: SeriesPoint[];
  /** The same measure bucketed by calendar month, for the month-on-month table. */
  months: SeriesPoint[];
  byPaymentMethod: Split[];
  byStatus: Split[];
  places: PlaceSplit;
  optionMix: OptionDimension[];
  returnRate: ReturnRate;
  fulfilment: FulfilmentReport;
  products: ProductDemand[];
  funnel: FunnelSummary;
  coupons: CouponUse[];
  /** Live catalogue facts, not windowed — stock is a "right now" number. */
  catalogue: { total: number; active: number; outOfStock: number; unitsInStock: number };
  /** Comparison against the equally long preceding window. `null` on All time. */
  previous: {
    label: string;
    orders: number;
    netRevenue: Money;
    units: number;
    aov: Money;
  } | null;
  /** True when a query failed; the page says so rather than showing zeroes. */
  degraded: boolean;
};

/* ------------------------------------------------------------------ */
/*  Status & method labels                                             */
/* ------------------------------------------------------------------ */

export const ORDER_STATUS_ORDER = [
  "pending",
  "confirmed",
  "shipped",
  "delivered",
  "cancelled",
] as const;

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

const METHOD_LABEL: Record<string, string> = {
  COD: "Cash on delivery",
  Razorpay: "Prepaid (Razorpay)",
  Partial: "Advance + balance",
  Direct: "Direct / pay the owner",
};

const titleCase = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/* ------------------------------------------------------------------ */
/*  The report                                                         */
/* ------------------------------------------------------------------ */

const CANCELLED = "cancelled";

/**
 * Build the whole report in one pass.
 *
 * Not wrapped in React `cache()`: each section asks for exactly one report
 * and the range lives in the URL, so there is nothing to dedupe within a
 * request. Every query degrades to an empty result rather than throwing —
 * a Finance page is somewhere you go *when* something looks wrong, and a
 * missing coupon table should not take the revenue figure down with it. The
 * report says `degraded: true` so the page can admit it.
 */
export async function getFinanceReport(
  rangeParam: string | undefined,
  now: Date = new Date(),
  granularityParam?: string
): Promise<FinanceReport> {
  const win = resolveWindow(rangeParam, now);
  const grainChoice: GranularityChoice = isGranularityChoice(granularityParam)
    ? granularityParam
    : "auto";
  let degraded = false;
  const soft = <T,>(fallback: T) => (err: unknown) => {
    degraded = true;
    console.error("[analytics] query failed:", err);
    return fallback;
  };

  const orderWhere = { createdAt: within(win.from, win.to) };

  const [
    orderRows,
    previousAgg,
    previousUnitsRows,
    refundPaid,
    refundRaised,
    refundPending,
    leadRows,
    leadStatusGroups,
    wishlistRows,
    productRows,
    couponGroups,
    catalogueAgg,
    returnRows,
  ] = await Promise.all([
    // The one row-level read. `items` is JSON, so the per-product and per-day
    // folds below cannot be pushed into SQL.
    prisma.order
      .findMany({
        where: orderWhere,
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          items: true,
          subtotal: true,
          shipping: true,
          total: true,
          discountTotal: true,
          couponCode: true,
          paymentMethod: true,
          paymentStatus: true,
          amountPaid: true,
          balanceDue: true,
          status: true,
          createdAt: true,
          // Where it went. Free text the customer typed — normalised, never
          // corrected; see `foldKey`.
          city: true,
          state: true,
          // Fulfilment. `statusHistory` is the only record of WHEN an order
          // moved; the columns only say where it is now.
          courier: true,
          trackingNumber: true,
          nimbusShipmentId: true,
          deliveryStatus: true,
          statusHistory: true,
        },
      })
      .catch(soft([])),

    // Previous period: scalars only, so none of those rows travel.
    win.previous
      ? prisma.order
          .aggregate({
            where: {
              createdAt: { gte: win.previous.from, lt: win.previous.to },
              status: { not: CANCELLED },
            },
            _sum: { subtotal: true, discountTotal: true },
            _count: { _all: true },
          })
          .catch(soft(null))
      : Promise.resolve(null),

    // Units for the previous period need the lines, but only the lines.
    win.previous
      ? prisma.order
          .findMany({
            where: {
              createdAt: { gte: win.previous.from, lt: win.previous.to },
              status: { not: CANCELLED },
            },
            select: { items: true },
          })
          .catch(soft([]))
      : Promise.resolve([]),

    // Refunds PAID inside the window — dated by when the money left.
    prisma.returnRequest
      .aggregate({
        where: { refundedAt: within(win.from, win.to) },
        _sum: { refundGross: true, refundFee: true, refundAmount: true },
        _count: { _all: true },
      })
      .catch(soft(null)),

    prisma.returnRequest.count({ where: { createdAt: within(win.from, win.to) } }).catch(soft(0)),

    // Approved but not yet paid, whenever raised — money the store still owes.
    prisma.returnRequest
      .aggregate({
        where: { refundedAt: null, status: { in: ["approved", "picked_up", "received"] } },
        _sum: { refundAmount: true },
        _count: { _all: true },
      })
      .catch(soft(null)),

    prisma.lead
      .findMany({
        where: { createdAt: within(win.from, win.to) },
        select: { productId: true, productName: true, quantity: true, visitorId: true, email: true, phone: true },
      })
      .catch(soft([])),

    prisma.lead
      .groupBy({
        by: ["status"],
        where: { createdAt: within(win.from, win.to) },
        _count: { _all: true },
      })
      .catch(soft([])),

    prisma.wishlistItem
      .groupBy({
        by: ["slug"],
        where: { createdAt: within(win.from, win.to) },
        _count: { _all: true },
      })
      .catch(soft([])),

    // 22 rows. Read whole so a deleted product is detectable by absence.
    prisma.product
      .findMany({ select: { id: true, name: true, slug: true, stock: true, price: true, isActive: true } })
      .catch(soft([])),

    prisma.couponRedemption
      .groupBy({
        by: ["couponId"],
        where: { createdAt: within(win.from, win.to) },
        _sum: { amount: true },
        _count: { _all: true },
      })
      .catch(soft([])),

    prisma.product
      .aggregate({ _sum: { stock: true }, _count: { _all: true } })
      .catch(soft(null)),

    // Returns raised against orders PLACED in this window, whenever they were
    // raised. One relation filter rather than a second round trip to collect
    // the order ids first — and it is the cohort rule that makes
    // `unitsReturned ÷ units` an honest rate. See METRIC.returnRate.
    prisma.returnRequest
      .findMany({
        where: { order: { createdAt: within(win.from, win.to) } },
        select: {
          orderId: true,
          productId: true,
          productName: true,
          quantity: true,
          status: true,
          reason: true,
        },
      })
      .catch(soft([])),
  ]);

  /* -- catalogue ---------------------------------------------------------- */

  const catalogue = {
    total: catalogueAgg?._count._all ?? productRows.length,
    active: productRows.filter((p) => p.isActive).length,
    outOfStock: productRows.filter((p) => p.isActive && p.stock <= 0).length,
    unitsInStock: catalogueAgg?._sum.stock ?? 0,
  };

  /* -- the single fold over orders ---------------------------------------- */

  const counted = orderRows.filter((o) => o.status !== CANCELLED);
  const cancelled = orderRows.filter((o) => o.status === CANCELLED);

  const revenue: RevenueSummary = {
    orders: counted.length,
    cancelledOrders: cancelled.length,
    grossGoods: 0,
    discounts: 0,
    netRevenue: 0,
    shippingCharged: 0,
    billed: 0,
    units: 0,
    aov: 0,
    cancelledValue: cancelled.reduce((n, o) => n + o.total, 0),
    couponOrders: 0,
  };

  const cash: CashSummary = {
    online: 0,
    onDelivery: 0,
    collected: 0,
    outstanding: 0,
    billed: 0,
  };

  // Span drives the bucket size, and on "All time" it is the age of the
  // oldest order rather than the age of the store's Vercel project.
  const firstAt = orderRows[0]?.createdAt ?? null;
  const spanDays = win.days ?? (firstAt ? Math.max(1, (win.to.getTime() - firstAt.getTime()) / DAY_MS) : 1);
  const { granularity, forced: granularityForced } = resolveGranularity(spanDays, grainChoice);

  const buckets = new Map<string, SeriesPoint>();
  // A second, always-monthly set of buckets. The month-on-month table has to
  // compare calendar months whatever the chart above it is bucketed by;
  // deriving one from the other would be wrong the moment the reader picks
  // "Day", and re-querying for it would be a round trip for arithmetic we are
  // already holding the rows to do.
  const monthBuckets = new Map<string, SeriesPoint>();
  const methods = new Map<string, Split>();
  const statuses = new Map<string, Split>();

  type Agg = {
    productId: string | null;
    names: Set<string>;
    units: number;
    netRevenue: number;
    orders: Set<string>;
  };
  const demand = new Map<string, Agg>();

  /* -- accumulators for the newer views ---------------------------------- */

  type PlaceAgg = {
    spellings: Map<string, number>;
    orders: number;
    netRevenue: number;
    units: number;
  };
  const states = new Map<string, PlaceAgg>();
  const cities = new Map<string, PlaceAgg>();
  let missingState = 0;
  let missingCity = 0;

  type OptionValueAgg = {
    spellings: Map<string, number>;
    units: number;
    netRevenue: number;
    orders: Set<string>;
    products: Set<string>;
  };
  type OptionAgg = {
    spellings: Map<string, number>;
    values: Map<string, OptionValueAgg>;
    units: number;
  };
  const options = new Map<string, OptionAgg>();
  /** Units seen at all, so a dimension's "without" figure has a denominator. */
  let allUnits = 0;

  const couriers = new Map<string, { spellings: Map<string, number>; orders: number; delivered: number }>();
  let courierUnknown = 0;
  const fulfil = {
    awaitingConfirmation: 0,
    awaitingDispatch: 0,
    draftStaged: 0,
    inTransit: 0,
    delivered: 0,
    rto: 0,
  };
  const dispatchHours: number[] = [];
  const deliveryHours: number[] = [];
  const endToEndHours: number[] = [];

  const placeBump = (
    map: Map<string, PlaceAgg>,
    raw: string | null,
    net: number,
    units: number
  ): boolean => {
    const typed = normaliseTyped(raw);
    if (!typed) return false;
    const { spelling, key } = typed;
    const a = map.get(key) ?? { spellings: new Map(), orders: 0, netRevenue: 0, units: 0 };
    a.spellings.set(spelling, (a.spellings.get(spelling) ?? 0) + 1);
    a.orders += 1;
    a.netRevenue += net;
    a.units += units;
    map.set(key, a);
    return true;
  };

  for (const o of counted) {
    const lines = parseLines(o.items);
    const shares = allocateDiscount(lines, o.discountTotal);
    const net = o.subtotal - o.discountTotal;
    const units = lines.reduce((n, l) => n + l.quantity, 0);
    const inHand = cashInHand(o);

    revenue.grossGoods += o.subtotal;
    revenue.discounts += o.discountTotal;
    revenue.netRevenue += net;
    revenue.shippingCharged += o.shipping;
    revenue.billed += o.total;
    revenue.units += units;
    if (o.couponCode) revenue.couponOrders++;

    cash.online += o.amountPaid;
    cash.onDelivery += inHand;
    cash.outstanding += Math.max(0, o.balanceDue - inHand);
    cash.billed += o.total;

    // -- time series --
    const dayKey = istDayKey(o.createdAt);
    const b = bucketOf(dayKey, granularity);
    const point = buckets.get(b.key) ?? { key: b.key, label: b.label, netRevenue: 0, orders: 0, units: 0 };
    point.netRevenue += net;
    point.orders += 1;
    point.units += units;
    buckets.set(b.key, point);

    const m = bucketOf(dayKey, "month");
    const mp = monthBuckets.get(m.key) ?? { key: m.key, label: m.label, netRevenue: 0, orders: 0, units: 0 };
    mp.netRevenue += net;
    mp.orders += 1;
    mp.units += units;
    monthBuckets.set(m.key, mp);

    // -- splits --
    const bump = (map: Map<string, Split>, key: string, label: string) => {
      const s =
        map.get(key) ?? { key, label, orders: 0, netRevenue: 0, collected: 0, outstanding: 0 };
      s.orders += 1;
      s.netRevenue += net;
      s.collected += o.amountPaid + inHand;
      s.outstanding += Math.max(0, o.balanceDue - inHand);
      map.set(key, s);
    };
    bump(methods, o.paymentMethod, METHOD_LABEL[o.paymentMethod] ?? o.paymentMethod);
    bump(statuses, o.status, STATUS_LABEL[o.status] ?? titleCase(o.status));

    // -- where it went --
    if (!placeBump(states, o.state, net, units)) missingState++;
    if (!placeBump(cities, o.city, net, units)) missingCity++;

    // -- fulfilment --
    if (o.status === "pending") fulfil.awaitingConfirmation++;
    if (o.status === "confirmed") {
      fulfil.awaitingDispatch++;
      if (o.nimbusShipmentId && !o.trackingNumber) fulfil.draftStaged++;
    }
    if (o.status === "shipped") fulfil.inTransit++;
    if (o.status === "delivered") fulfil.delivered++;
    if (/\brto\b/i.test(o.deliveryStatus ?? "")) fulfil.rto++;

    if (o.status === "shipped" || o.status === "delivered") {
      const typed = normaliseTyped(o.courier);
      if (typed) {
        const c =
          couriers.get(typed.key) ?? { spellings: new Map(), orders: 0, delivered: 0 };
        c.spellings.set(typed.spelling, (c.spellings.get(typed.spelling) ?? 0) + 1);
        c.orders += 1;
        if (o.status === "delivered") c.delivered += 1;
        couriers.set(typed.key, c);
      } else {
        courierUnknown++;
      }
    }

    const shippedAt = firstHistoryAt(o.statusHistory, "shipped");
    const deliveredAt = firstHistoryAt(o.statusHistory, "delivered");
    if (shippedAt) {
      const h = hoursBetween(o.createdAt, shippedAt);
      if (h !== null) dispatchHours.push(h);
      if (deliveredAt) {
        const d = hoursBetween(shippedAt, deliveredAt);
        if (d !== null) deliveryHours.push(d);
      }
    }
    if (deliveredAt) {
      const e = hoursBetween(o.createdAt, deliveredAt);
      if (e !== null) endToEndHours.push(e);
    }

    // -- product demand, and the variant mix that rides on the same lines --
    lines.forEach((l, i) => {
      const key = l.productId ?? `name:${l.name.toLowerCase()}`;
      const lineNet = Math.max(0, l.price * l.quantity - shares[i]);
      const a =
        demand.get(key) ??
        { productId: l.productId, names: new Set<string>(), units: 0, netRevenue: 0, orders: new Set<string>() };
      a.names.add(l.name);
      a.units += l.quantity;
      a.netRevenue += lineNet;
      a.orders.add(o.id);
      demand.set(key, a);

      allUnits += l.quantity;

      // A line carries at most one value per dimension, so within a dimension
      // the units add up to the dimension's own total exactly. ACROSS
      // dimensions they do not — one Size-L Black tee is one unit of "L" and
      // one unit of "Black" — which is why each dimension is its own panel
      // with its own denominator rather than one combined chart.
      const seenDims = new Set<string>();
      for (const opt of l.options) {
        // "Size" and "size" are one dimension, "L" and "l" one value — the
        // same fold the place split uses, for the same reason.
        const name = normaliseTyped(opt.name);
        const value = normaliseTyped(opt.value);
        if (!name || !value) continue;
        if (seenDims.has(name.key)) continue; // a duplicated option on one line
        seenDims.add(name.key);

        const dim =
          options.get(name.key) ?? { spellings: new Map(), values: new Map(), units: 0 };
        dim.spellings.set(name.spelling, (dim.spellings.get(name.spelling) ?? 0) + 1);
        dim.units += l.quantity;

        const val =
          dim.values.get(value.key) ??
          { spellings: new Map(), units: 0, netRevenue: 0, orders: new Set<string>(), products: new Set<string>() };
        val.spellings.set(value.spelling, (val.spellings.get(value.spelling) ?? 0) + 1);
        val.units += l.quantity;
        val.netRevenue += lineNet;
        val.orders.add(o.id);
        val.products.add(key);
        dim.values.set(value.key, val);

        options.set(name.key, dim);
      }
    });
  }

  cash.collected = cash.online + cash.onDelivery;
  revenue.aov = revenue.orders > 0 ? Math.round(revenue.netRevenue / revenue.orders) : 0;

  /* -- fill the gaps in the series ---------------------------------------- */
  //
  // A bucket with no orders is a real zero, and leaving it out would draw a
  // flat line through a dead week and quietly misstate the trend. Only the
  // buckets actually inside the window are emitted, so "All time" never
  // invents history before the first order.

  const seriesFrom = win.from ?? firstAt ?? win.to;
  const series: SeriesPoint[] = [];
  if (orderRows.length > 0 || win.from) {
    const seen = new Set<string>();
    for (let t = seriesFrom.getTime(); t < win.to.getTime() + DAY_MS; t += DAY_MS) {
      const b = bucketOf(istDayKey(new Date(t)), granularity);
      if (seen.has(b.key) || istDayStart(b.key).getTime() > win.to.getTime()) continue;
      seen.add(b.key);
      series.push(buckets.get(b.key) ?? { key: b.key, label: b.label, netRevenue: 0, orders: 0, units: 0 });
    }
    // Any bucket the walk missed (a bucket start before `seriesFrom`) still
    // holds real orders — never drop money to tidy an axis.
    for (const [k, v] of buckets) if (!seen.has(k)) series.push(v);
    series.sort((a, b) => a.key.localeCompare(b.key));
  }

  const months = [...monthBuckets.values()].sort((a, b) => a.key.localeCompare(b.key));

  /* -- where the orders came from ----------------------------------------- */

  const toPlaces = (map: Map<string, PlaceAgg>): PlaceSlice[] =>
    [...map.entries()]
      .map(([key, a]) => ({
        key,
        label: commonestSpelling(a.spellings),
        orders: a.orders,
        netRevenue: a.netRevenue,
        units: a.units,
        spellings: [...a.spellings.keys()].sort(),
      }))
      .sort((a, b) => b.orders - a.orders || b.netRevenue - a.netRevenue);

  const stateSlices = toPlaces(states);
  const citySlices = toPlaces(cities);

  const places: PlaceSplit = {
    states: stateSlices,
    cities: citySlices,
    missingState,
    missingCity,
    folded: [...stateSlices, ...citySlices].some((s) => s.spellings.length > 1),
  };

  /* -- variant mix --------------------------------------------------------- */

  const optionMix: OptionDimension[] = [...options.entries()]
    .map(([key, dim]) => ({
      key,
      label: commonestSpelling(dim.spellings),
      units: dim.units,
      unitsWithout: Math.max(0, allUnits - dim.units),
      values: [...dim.values.entries()]
        .map(([vk, v]) => ({
          key: vk,
          label: commonestSpelling(v.spellings),
          units: v.units,
          netRevenue: v.netRevenue,
          orders: v.orders.size,
          products: v.products.size,
        }))
        .sort((a, b) => b.units - a.units || b.netRevenue - a.netRevenue),
    }))
    // Biggest dimension first: on this catalogue that is Size, which is the
    // one an owner reorders stock against.
    .sort((a, b) => b.units - a.units || a.label.localeCompare(b.label));

  /* -- returns, as a rate -------------------------------------------------- */

  const countedIds = new Set(counted.map((o) => o.id));
  // A return against a cancelled order is not part of the cohort: that order
  // was excluded from `units` above, so counting its return would put a
  // numerator over a denominator it is not in.
  const cohortReturns = returnRows.filter((r) => countedIds.has(r.orderId));

  const returnedUnitsByProduct = new Map<string, number>();
  const returnedOrders = new Set<string>();
  const returnStatusCounts = new Map<string, number>();
  const returnReasonCounts = new Map<string, { count: number; units: number }>();
  let unitsReturned = 0;

  for (const r of cohortReturns) {
    const qty = Math.max(0, r.quantity);
    unitsReturned += qty;
    returnedOrders.add(r.orderId);
    const key = r.productId ?? `name:${r.productName.trim().toLowerCase()}`;
    returnedUnitsByProduct.set(key, (returnedUnitsByProduct.get(key) ?? 0) + qty);
    returnStatusCounts.set(r.status, (returnStatusCounts.get(r.status) ?? 0) + 1);
    const reason = r.reason.trim() || "Not given";
    const agg = returnReasonCounts.get(reason) ?? { count: 0, units: 0 };
    agg.count += 1;
    agg.units += qty;
    returnReasonCounts.set(reason, agg);
  }

  const pct = (part: number, whole: number): number | null =>
    whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;

  const returnRate: ReturnRate = {
    ordersWithReturn: returnedOrders.size,
    unitsReturned,
    orderRate: pct(returnedOrders.size, revenue.orders),
    unitRate: pct(unitsReturned, revenue.units),
    byStatus: [...returnStatusCounts.entries()]
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count),
    byReason: [...returnReasonCounts.entries()]
      .map(([reason, a]) => ({ reason, count: a.count, units: a.units }))
      .sort((a, b) => b.count - a.count || b.units - a.units),
  };

  /* -- fulfilment ---------------------------------------------------------- */

  const fulfilment: FulfilmentReport = {
    ...fulfil,
    cancelled: revenue.cancelledOrders,
    dispatch: summariseDuration(dispatchHours),
    delivery: summariseDuration(deliveryHours),
    endToEnd: summariseDuration(endToEndHours),
    couriers: [...couriers.entries()]
      .map(([key, c]) => ({
        key,
        label: commonestSpelling(c.spellings),
        orders: c.orders,
        delivered: c.delivered,
      }))
      .sort((a, b) => b.orders - a.orders || a.label.localeCompare(b.label)),
    courierUnknown,
  };

  /* -- leads & wishlist ---------------------------------------------------- */

  const cartAddsByProduct = new Map<string, number>();
  const visitors = new Set<string>();
  let cartAddUnits = 0;
  let anonymousCartAdds = 0;
  for (const l of leadRows) {
    const key = l.productId ?? `name:${l.productName.trim().toLowerCase()}`;
    cartAddsByProduct.set(key, (cartAddsByProduct.get(key) ?? 0) + 1);
    cartAddUnits += Math.max(0, l.quantity);
    if (l.visitorId?.trim()) visitors.add(l.visitorId.trim());
    if (!l.email?.trim() && !l.phone?.trim()) anonymousCartAdds++;
  }

  const wishlistBySlug = new Map<string, number>();
  let wishlistSaves = 0;
  for (const w of wishlistRows) {
    wishlistBySlug.set(w.slug, w._count._all);
    wishlistSaves += w._count._all;
  }

  const funnel: FunnelSummary = {
    cartAdds: leadRows.length,
    cartAddUnits,
    cartBrowsers: visitors.size,
    anonymousCartAdds,
    wishlistSaves,
    orders: revenue.orders,
    units: revenue.units,
    leadsByStatus: leadStatusGroups
      .map((g) => ({ status: g.status, count: g._count._all }))
      .sort((a, b) => b.count - a.count),
  };

  /* -- products ------------------------------------------------------------ */

  const byId = new Map(productRows.map((p) => [p.id, p]));
  // Rate-based figures need a real rate. On "All time" the window is the
  // store's whole life, and dividing by it produces a cover figure nobody
  // should act on, so it is withheld rather than fudged.
  const rateDays = win.days;

  const products: ProductDemand[] = [];
  const seenKeys = new Set<string>();

  for (const [key, a] of demand) {
    seenKeys.add(key);
    const p = a.productId ? byId.get(a.productId) : undefined;
    const snapshotNames = [...a.names];
    const resolved: ProductDemand["resolved"] = p
      ? "catalogue"
      : a.productId
        ? "deleted"
        : "unlinked";
    const stock = p?.stock ?? null;
    const daysOfCover =
      rateDays && p && a.units > 0 ? Math.round((p.stock / (a.units / rateDays)) * 10) / 10 : null;

    products.push({
      key,
      productId: a.productId,
      // The current catalogue name wins, so one product renamed mid-window is
      // one row under its name today — not two rows nobody can reconcile.
      name: p?.name ?? snapshotNames[0] ?? "Unnamed item",
      slug: p?.slug ?? null,
      resolved,
      snapshotNames,
      units: a.units,
      netRevenue: a.netRevenue,
      orders: a.orders.size,
      stock,
      isActive: p?.isActive ?? null,
      price: p?.price ?? null,
      cartAdds: cartAddsByProduct.get(key) ?? 0,
      wishlistSaves: p?.slug ? wishlistBySlug.get(p.slug) ?? 0 : 0,
      unitsReturned: returnedUnitsByProduct.get(key) ?? 0,
      returnRate: pct(returnedUnitsByProduct.get(key) ?? 0, a.units),
      daysOfCover,
    });
  }

  // Products that sold nothing still belong in the report — a slow mover is
  // invisible if the table is built only from order lines.
  for (const p of productRows) {
    if (seenKeys.has(p.id)) continue;
    products.push({
      key: p.id,
      productId: p.id,
      name: p.name,
      slug: p.slug,
      resolved: "catalogue",
      snapshotNames: [],
      units: 0,
      netRevenue: 0,
      orders: 0,
      stock: p.stock,
      isActive: p.isActive,
      price: p.price,
      cartAdds: cartAddsByProduct.get(p.id) ?? 0,
      wishlistSaves: wishlistBySlug.get(p.slug) ?? 0,
      unitsReturned: 0,
      returnRate: null,
      daysOfCover: null,
    });
  }

  products.sort((a, b) => b.netRevenue - a.netRevenue || b.units - a.units);

  /* -- coupons ------------------------------------------------------------- */

  let coupons: CouponUse[] = [];
  if (couponGroups.length > 0) {
    const rows = await prisma.coupon
      .findMany({
        where: { id: { in: couponGroups.map((g) => g.couponId) } },
        select: { id: true, code: true, isActive: true },
      })
      .catch(soft([]));
    const codes = new Map(rows.map((c) => [c.id, c]));
    coupons = couponGroups
      .map((g) => ({
        code: codes.get(g.couponId)?.code ?? "(deleted coupon)",
        uses: g._count._all,
        discount: g._sum.amount ?? 0,
        isActive: codes.get(g.couponId)?.isActive ?? false,
      }))
      .sort((a, b) => b.discount - a.discount);
  }

  /* -- refunds ------------------------------------------------------------- */

  const refunds: RefundSummary = {
    paidCount: refundPaid?._count._all ?? 0,
    gross: refundPaid?._sum.refundGross ?? 0,
    fee: refundPaid?._sum.refundFee ?? 0,
    net: refundPaid?._sum.refundAmount ?? 0,
    raised: refundRaised,
    pendingCount: refundPending?._count._all ?? 0,
    pendingValue: refundPending?._sum.refundAmount ?? 0,
  };

  /* -- previous period ----------------------------------------------------- */

  let previous: FinanceReport["previous"] = null;
  if (win.previous && previousAgg) {
    const orders = previousAgg._count._all;
    const netRevenue = (previousAgg._sum.subtotal ?? 0) - (previousAgg._sum.discountTotal ?? 0);
    const units = previousUnitsRows.reduce(
      (n, r) => n + parseLines(r.items).reduce((m, l) => m + l.quantity, 0),
      0
    );
    previous = {
      label: `previous ${win.days} days`,
      orders,
      netRevenue,
      units,
      aov: orders > 0 ? Math.round(netRevenue / orders) : 0,
    };
  }

  const splitSort = (a: Split, b: Split) => b.netRevenue - a.netRevenue || b.orders - a.orders;

  return {
    window: win,
    granularity,
    granularityForced,
    revenue,
    cash,
    refunds,
    series,
    months,
    byPaymentMethod: [...methods.values()].sort(splitSort),
    // Status has a natural lifecycle order; sorting it by size would scramble
    // the one thing the reader is looking for — where orders are piling up.
    byStatus: [...statuses.values()].sort(
      (a, b) =>
        ORDER_STATUS_ORDER.indexOf(a.key as (typeof ORDER_STATUS_ORDER)[number]) -
        ORDER_STATUS_ORDER.indexOf(b.key as (typeof ORDER_STATUS_ORDER)[number])
    ),
    places,
    optionMix,
    returnRate,
    fulfilment,
    products,
    funnel,
    coupons,
    catalogue,
    previous,
    degraded,
  };
}

/* ------------------------------------------------------------------ */
/*  Derived views                                                      */
/* ------------------------------------------------------------------ */

/**
 * Pieces selling faster than the shelf can stand — the list that actually
 * costs money, because a stockout is revenue that simply never happens.
 *
 * Ranked by days of cover ascending: how long the current stock lasts at the
 * rate this window measured. Withheld entirely on "All time", where the rate
 * is a lifetime average and would recommend restocking a piece that stopped
 * selling a year ago.
 */
export function highDemandLowStock(products: ProductDemand[], limit = 8): ProductDemand[] {
  return products
    .filter(
      (p) =>
        p.resolved === "catalogue" &&
        p.isActive &&
        p.units > 0 &&
        p.daysOfCover !== null &&
        p.daysOfCover < 30
    )
    .sort((a, b) => (a.daysOfCover ?? 0) - (b.daysOfCover ?? 0) || b.units - a.units)
    .slice(0, limit);
}

/**
 * Active catalogue pieces that sold nothing in the window, worst first by how
 * much stock is tied up in them. Deleted and unlinked rows are excluded —
 * there is nothing left to act on.
 */
export function slowMovers(products: ProductDemand[]): ProductDemand[] {
  return products
    .filter((p) => p.resolved === "catalogue" && p.isActive && p.units === 0)
    .sort(
      (a, b) =>
        (b.stock ?? 0) * (b.price ?? 0) - (a.stock ?? 0) * (a.price ?? 0) ||
        b.cartAdds - a.cartAdds
    );
}

/** Signed percentage change, or `null` when the base period had nothing. */
export function delta(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}

/**
 * Month-on-month change over the monthly series.
 *
 * The **last** row is almost always a part month — the window ends "now", not
 * at a month boundary — so its change is a comparison of half a month against
 * a whole one. It is flagged rather than dropped: dropping it would hide the
 * current month entirely, and showing its delta unflagged is how a dashboard
 * announces a 60% collapse on the 12th of the month.
 */
export function monthOnMonth(
  months: SeriesPoint[],
  now: Date
): { point: SeriesPoint; change: number | null; partial: boolean }[] {
  const currentMonth = bucketOf(istDayKey(now), "month").key;
  return months.map((point, i) => ({
    point,
    change: i === 0 ? null : delta(point.netRevenue, months[i - 1].netRevenue),
    partial: point.key === currentMonth,
  }));
}

/* ------------------------------------------------------------------ */
/*  Customers — identity comes from lib/customers, never from here     */
/* ------------------------------------------------------------------ */

/**
 * Below this many buyers, terciles are not a segmentation — they are three
 * labels attached to noise. Four customers cut into thirds puts one person in
 * "Champions" because they happened to order most recently, and an owner will
 * act on that. The screen says why the panel is withheld instead.
 */
const MIN_RFM_BUYERS = 6;

export const RFM_SEGMENT_LABEL: Record<RfmSegmentKey, string> = {
  champions: "Champions",
  loyal: "Loyal",
  promising: "Promising",
  needsAttention: "Needs attention",
  atRisk: "At risk",
  lost: "Lost",
};

/**
 * The whole 3×3 map, written out rather than computed from a score sum.
 *
 * Adding R and F into one number loses the thing that matters: "ordered once,
 * yesterday" and "ordered five times, a year ago" both score 4 and need
 * opposite actions.
 */
const RFM_SEGMENT: Record<string, RfmSegmentKey> = {
  "3-3": "champions",
  "3-2": "loyal",
  "3-1": "promising",
  "2-3": "loyal",
  "2-2": "needsAttention",
  "2-1": "needsAttention",
  "1-3": "atRisk",
  "1-2": "atRisk",
  "1-1": "lost",
};

/** The 33rd and 67th percentiles of a sorted list — the tercile cut-points. */
function terciles(sortedAscending: number[]): [number, number] {
  const at = (q: number) => {
    if (sortedAscending.length === 0) return 0;
    const idx = Math.min(
      sortedAscending.length - 1,
      Math.max(0, Math.round(q * (sortedAscending.length - 1)))
    );
    return sortedAscending[idx];
  };
  return [at(1 / 3), at(2 / 3)];
}

/** 1, 2 or 3 — higher is better. `invert` for recency, where lower days win. */
function score(value: number, cuts: [number, number], invert = false): number {
  const raw = value <= cuts[0] ? 1 : value <= cuts[1] ? 2 : 3;
  return invert ? 4 - raw : raw;
}

/** `2026-07-01` → months since year 0, so offsets are plain subtraction. */
function monthIndex(monthKey: string): number {
  const [y, m] = monthKey.split("-").map(Number);
  return y * 12 + (m - 1);
}

const EMPTY_CUSTOMER_ANALYTICS: CustomerAnalytics = {
  buyers: 0,
  repeatBuyers: 0,
  repeatRate: null,
  meanLtv: 0,
  medianLtv: 0,
  windowNewOrders: 0,
  windowReturningOrders: 0,
  windowNewRevenue: 0,
  windowReturningRevenue: 0,
  newCustomers: 0,
  rfm: null,
  rfmCutoffs: null,
  rfmGrid: null,
  segments: [],
  cohorts: [],
  cohortWidth: 0,
  top: [],
  degraded: false,
};

/**
 * Repeat purchase, lifetime value, RFM and cohort retention.
 *
 * **Every identity decision is `lib/customers`', not this module's.** Who is
 * one person is a merge rule over six tables — guest orders joined to accounts
 * by email, phones shared by families deliberately not merged — and rewriting
 * an approximation of it here is precisely how two admin screens end up
 * disagreeing about the same shopper. `getCustomers()` is wrapped in React
 * `cache()`, so Admin → Customers and this workspace rendering in the same
 * request share one resolution.
 *
 * Two clocks, kept apart on purpose:
 *
 * - **Lifetime figures** (buyers, repeat rate, LTV, RFM) are ALL-TIME. A
 *   "repeat rate over the last 7 days" mostly measures the length of the
 *   window, and would fall every time the reader narrowed it.
 * - **New vs returning** IS windowed: each counted order in the window is new
 *   when it is that customer's first counted order ever, returning otherwise.
 *
 * Scale: this reads every order in the store. At ~50k orders page the orders
 * query inside `lib/customers` and resolve a page at a time — the merge rule
 * itself does not change. See the note at the top of that file.
 */
export async function getCustomerAnalytics(
  win: FinanceWindow,
  now: Date = new Date()
): Promise<CustomerAnalytics> {
  let directory: Awaited<ReturnType<typeof getCustomers>>;
  try {
    directory = await getCustomers();
  } catch (err) {
    console.error("[analytics] customer directory failed:", err);
    return { ...EMPTY_CUSTOMER_ANALYTICS, degraded: true };
  }

  const isCounted = (status: string) => status !== CANCELLED;
  const inWindow = (d: Date) =>
    d.getTime() < win.to.getTime() && (win.from === null || d.getTime() >= win.from.getTime());

  /** Every customer who has ever placed a counted order, with that history. */
  type Buyer = {
    record: CustomerRecord;
    /** Counted orders, oldest first — the order the "first order" rule needs. */
    orders: { at: Date; net: number; billed: number }[];
  };

  const buyers: Buyer[] = [];
  for (const c of directory.customers) {
    const orders = c.orders
      .filter((o) => isCounted(o.status))
      .map((o) => ({
        at: o.createdAt,
        // Same definition as the headline: net of discount, excluding shipping.
        net: o.subtotal - o.discountTotal,
        billed: o.total,
      }))
      .sort((a, b) => a.at.getTime() - b.at.getTime());
    if (orders.length > 0) buyers.push({ record: c, orders });
  }

  if (buyers.length === 0) return EMPTY_CUSTOMER_ANALYTICS;

  /* -- lifetime ----------------------------------------------------------- */

  const repeatBuyers = buyers.filter((b) => b.orders.length >= 2).length;
  const spends = buyers.map((b) => b.record.stats.lifetimeSpend).sort((a, b) => a - b);
  const mid = Math.floor(spends.length / 2);
  const medianLtv =
    spends.length % 2 === 1 ? spends[mid] : Math.round((spends[mid - 1] + spends[mid]) / 2);
  const meanLtv = Math.round(spends.reduce((n, v) => n + v, 0) / spends.length);

  /* -- windowed: new vs returning ----------------------------------------- */

  let windowNewOrders = 0;
  let windowReturningOrders = 0;
  let windowNewRevenue = 0;
  let windowReturningRevenue = 0;
  let newCustomers = 0;

  for (const b of buyers) {
    b.orders.forEach((o, i) => {
      if (!inWindow(o.at)) return;
      if (i === 0) {
        windowNewOrders++;
        windowNewRevenue += o.net;
      } else {
        windowReturningOrders++;
        windowReturningRevenue += o.net;
      }
    });
    if (inWindow(b.orders[0].at)) newCustomers++;
  }

  /* -- RFM ---------------------------------------------------------------- */

  const daysSince = (d: Date) => Math.max(0, (now.getTime() - d.getTime()) / DAY_MS);

  let rfm: RfmCustomer[] | null = null;
  let rfmCutoffs: CustomerAnalytics["rfmCutoffs"] = null;
  let rfmGrid: number[][] | null = null;
  let segments: CustomerAnalytics["segments"] = [];

  if (buyers.length >= MIN_RFM_BUYERS) {
    const recencyCuts = terciles(
      buyers.map((b) => daysSince(b.orders[b.orders.length - 1].at)).sort((a, b) => a - b)
    );
    const frequencyCuts = terciles(buyers.map((b) => b.orders.length).sort((a, b) => a - b));
    const spendCuts = terciles(spends);

    rfmCutoffs = { recencyDays: recencyCuts, frequency: frequencyCuts, spend: spendCuts };

    rfm = buyers.map((b) => {
      const last = b.orders[b.orders.length - 1].at;
      const days = daysSince(last);
      // Recency is inverted: fewer days since the last order is a better score.
      const r = score(days, recencyCuts, true);
      const f = score(b.orders.length, frequencyCuts);
      const m = score(b.record.stats.lifetimeSpend, spendCuts);
      return {
        id: b.record.id,
        name: b.record.displayName,
        recency: r,
        frequency: f,
        monetary: m,
        segment: RFM_SEGMENT[`${r}-${f}`] ?? "needsAttention",
        daysSinceLastOrder: Math.round(days),
        orders: b.orders.length,
        spend: b.record.stats.lifetimeSpend,
      };
    });

    // grid[recency-1][frequency-1] — rows read top-to-bottom as 3, 2, 1 in the
    // UI, which is the axis direction a reader expects (best at the top).
    rfmGrid = [0, 1, 2].map(() => [0, 0, 0]);
    for (const c of rfm) rfmGrid[c.recency - 1][c.frequency - 1] += 1;

    const bySegment = new Map<RfmSegmentKey, { customers: number; spend: number }>();
    for (const c of rfm) {
      const a = bySegment.get(c.segment) ?? { customers: 0, spend: 0 };
      a.customers += 1;
      a.spend += c.spend;
      bySegment.set(c.segment, a);
    }
    segments = (Object.keys(RFM_SEGMENT_LABEL) as RfmSegmentKey[])
      .map((key) => ({
        key,
        label: RFM_SEGMENT_LABEL[key],
        customers: bySegment.get(key)?.customers ?? 0,
        spend: bySegment.get(key)?.spend ?? 0,
      }))
      .filter((s) => s.customers > 0);
  }

  /* -- cohorts ------------------------------------------------------------ */
  //
  // Rows are the month of a customer's FIRST counted order; columns are whole
  // months since. A cell is the share of that cohort that placed a counted
  // order in that month, so column 0 is 100% by construction — it is the
  // cohort's own definition, kept visible as the baseline the rest is read
  // against. Future cells are `null`, never 0: a cohort formed last month has
  // not had a month-2 yet, and drawing that as zero retention would invent a
  // collapse out of the calendar.

  const nowMonth = monthIndex(bucketOf(istDayKey(now), "month").key);
  const cohortMap = new Map<string, { label: string; members: Set<string>; active: Map<number, Set<string>> }>();

  for (const b of buyers) {
    const firstMonth = bucketOf(istDayKey(b.orders[0].at), "month");
    const base = monthIndex(firstMonth.key);
    const cohort =
      cohortMap.get(firstMonth.key) ??
      { label: firstMonth.label, members: new Set<string>(), active: new Map<number, Set<string>>() };
    cohort.members.add(b.record.id);
    for (const o of b.orders) {
      const offset = monthIndex(bucketOf(istDayKey(o.at), "month").key) - base;
      if (offset < 0) continue;
      const set = cohort.active.get(offset) ?? new Set<string>();
      set.add(b.record.id);
      cohort.active.set(offset, set);
    }
    cohortMap.set(firstMonth.key, cohort);
  }

  const cohorts: CohortRow[] = [...cohortMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, c]) => {
      const base = monthIndex(key);
      const width = nowMonth - base + 1;
      const cells: (number | null)[] = [];
      const counts: (number | null)[] = [];
      for (let k = 0; k < width; k++) {
        const active = c.active.get(k)?.size ?? 0;
        counts.push(active);
        cells.push(Math.round((active / c.members.size) * 1000) / 10);
      }
      return { key, label: c.label, size: c.members.size, cells, counts };
    });

  const cohortWidth = cohorts.reduce((n, c) => Math.max(n, c.cells.length), 0);

  /* -- top buyers ---------------------------------------------------------- */
  //
  // Built from the buyer list rather than from `rfm`, which is withheld on a
  // small store — "who spends the most" is answerable with two customers even
  // though "which tercile are they in" is not.

  const scored = new Map((rfm ?? []).map((c) => [c.id, c]));
  const top: RfmCustomer[] = buyers
    .map((b): RfmCustomer => {
      const s = scored.get(b.record.id);
      const days = Math.round(daysSince(b.orders[b.orders.length - 1].at));
      return {
        id: b.record.id,
        name: b.record.displayName,
        // Zero means "not scored" — the UI hides the scores rather than
        // printing a 0 that would read as the worst possible tercile.
        recency: s?.recency ?? 0,
        frequency: s?.frequency ?? 0,
        monetary: s?.monetary ?? 0,
        segment: s?.segment ?? "needsAttention",
        daysSinceLastOrder: days,
        orders: b.orders.length,
        spend: b.record.stats.lifetimeSpend,
      };
    })
    .sort((a, b) => b.spend - a.spend || b.orders - a.orders)
    .slice(0, 10);

  return {
    buyers: buyers.length,
    repeatBuyers,
    repeatRate: Math.round((repeatBuyers / buyers.length) * 1000) / 10,
    meanLtv,
    medianLtv,
    windowNewOrders,
    windowReturningOrders,
    windowNewRevenue,
    windowReturningRevenue,
    newCustomers,
    rfm,
    rfmCutoffs,
    rfmGrid,
    segments: segments.sort((a, b) => b.spend - a.spend || b.customers - a.customers),
    cohorts,
    cohortWidth,
    top,
    degraded: false,
  };
}

/** Buyers needed before the RFM panel will draw. Rendered in its empty state. */
export const RFM_MINIMUM = MIN_RFM_BUYERS;

/* ------------------------------------------------------------------ */
/*  The queue — what is waiting for a human right now                  */
/* ------------------------------------------------------------------ */

export type AttentionQueue = {
  pendingOrders: number;
  awaitingDispatch: number;
  draftStaged: number;
  openReturns: number;
  unreadChats: number;
  unreadInquiries: number;
  unapprovedReviews: number;
  interestedLeads: number;
  outOfStock: number;
  degraded: boolean;
};

/**
 * Everything sitting in a queue, **right now** — deliberately not filtered by
 * the time range.
 *
 * An order that has been waiting three months to be confirmed is more urgent
 * than one from this morning, not less, so scoping this panel to "the last 30
 * days" would hide exactly the rows that matter. Every other figure in the
 * workspace is windowed; this one says so on screen.
 *
 * Nine `count`s, which is nine index scans and no rows on the wire. They run
 * in one `Promise.all` alongside the main report.
 */
export async function getAttentionQueue(): Promise<AttentionQueue> {
  let degraded = false;
  const soft = (err: unknown) => {
    degraded = true;
    console.error("[analytics] attention query failed:", err);
    return 0;
  };

  const [
    pendingOrders,
    awaitingDispatch,
    draftStaged,
    openReturns,
    unreadChats,
    unreadInquiries,
    unapprovedReviews,
    interestedLeads,
    outOfStock,
  ] = await Promise.all([
    prisma.order.count({ where: { status: "pending" } }).catch(soft),
    prisma.order.count({ where: { status: "confirmed", trackingNumber: null } }).catch(soft),
    prisma.order
      .count({
        where: { status: "confirmed", trackingNumber: null, nimbusShipmentId: { not: null } },
      })
      .catch(soft),
    prisma.returnRequest
      .count({ where: { status: { in: ["pending", "approved", "picked_up", "received"] } } })
      .catch(soft),
    prisma.chatThread.count({ where: { adminUnread: { gt: 0 } } }).catch(soft),
    prisma.message.count({ where: { isRead: false } }).catch(soft),
    prisma.review.count({ where: { approved: false } }).catch(soft),
    prisma.lead.count({ where: { status: "interested" } }).catch(soft),
    prisma.product.count({ where: { isActive: true, stock: { lte: 0 } } }).catch(soft),
  ]);

  return {
    pendingOrders,
    awaitingDispatch,
    draftStaged,
    openReturns,
    unreadChats,
    unreadInquiries,
    unapprovedReviews,
    interestedLeads,
    outOfStock,
    degraded,
  };
}

/* ------------------------------------------------------------------ */
/*  Metric definitions — rendered verbatim in the UI                   */
/* ------------------------------------------------------------------ */

/**
 * Every number in the analytics workspace carries one of these behind an (i).
 *
 * They live beside the arithmetic on purpose. A definition kept in the page
 * is a definition that goes stale the first time the query changes, and a
 * figure a reader cannot reproduce from its own description is worse than no
 * figure at all.
 */
export const METRIC = {
  netRevenue:
    "Σ (order subtotal − discount) over orders PLACED in this period, cancelled ones excluded. Shipping is not included — it is money passed through to a courier, not goods sold. Counted at placement, not at payment, so it is revenue booked rather than cash in hand.",
  grossGoods:
    "Σ order subtotal — the goods at the price shown on the product page, before any coupon. Cancelled orders excluded.",
  discounts:
    "Σ coupon discount applied at checkout, over the same counted orders. This is revenue given away, not a cost.",
  billed:
    "Σ order total — subtotal + shipping − discount. What the customer was actually asked to pay, whether or not they have paid it.",
  shippingCharged:
    "Σ shipping charged to customers. Most products are set to free shipping, so this is usually small; it is not profit, and the courier's actual bill is not in this database.",
  orders:
    "Orders placed in this period with a status other than cancelled. An order counts from the moment it is placed, even if it is still pending review.",
  cancelled:
    "Orders placed in this period and later cancelled. Excluded from every money figure above and shown here so the exclusion is visible rather than silent.",
  units:
    "Σ quantity across every line of every counted order. Lines are read from the order's own items snapshot, so a later price or name change does not rewrite history.",
  aov:
    "Net revenue ÷ counted orders. Uses the same net-of-discount, excluding-shipping definition as the headline, so the two always reconcile.",
  collected:
    "Money actually in hand: everything paid online (amountPaid), plus the cash-on-delivery balance of orders the courier has delivered. An undelivered COD balance is a demand, not a receipt, so it is not counted here.",
  online:
    "Σ amountPaid — money that reached Razorpay. Full value on a prepaid order, the advance on a part-paid one, zero on cash on delivery.",
  onDelivery:
    "Σ balanceDue on orders marked delivered (or manually marked paid). balanceDue is written once at checkout and never decremented, so the delivery scan is the only evidence the cash was actually taken.",
  outstanding:
    "Σ balanceDue on counted orders that are not yet delivered. Billed, not collected — on a COD-heavy store this is the gap between what the dashboard says you sold and what is in the bank.",
  refundsPaid:
    "Σ refundAmount on return requests whose refundedAt falls in this period — money that left the account. Dated by the refund, NOT by the original order, so a refund here can belong to an order from an earlier period. It is reported beside net revenue rather than subtracted inside the chart for exactly that reason.",
  refundFee:
    "Σ refundFee on the same requests — the part of the gross the store kept under its refund policy. Revenue retained, not revenue earned.",
  refundGross:
    "Σ refundGross — the value of the returned goods before the fee. gross − fee = what the customer received.",
  refundPending:
    "Return requests approved, picked up or received but not yet paid out, whenever they were raised. Money the store still owes; it is not in any period's refund total until it is actually sent.",
  daysOfCover:
    "Current stock ÷ (units sold in this period ÷ days in the period). How many more days the shelf lasts at the rate just measured. Withheld on All time, where the rate is a lifetime average and would be meaningless.",
  productRevenue:
    "Σ (line price × quantity) less that line's exact pro-rata share of the order's coupon discount. The shares are allocated against a running total so they sum back to the order discount to the rupee, which is why these rows add up to the headline.",
  cartAdds:
    "Rows in the Lead table — one per add-to-cart EVENT, not per person. The same shopper adding an item twice is two rows, and removing it again does not delete one.",
  cartBrowsers:
    "Distinct visitorId values among those events. That id is a random UUID in the browser's localStorage, so it counts BROWSERS, not people: a new device, a private window or cleared site data is a new id, and one person on a phone and a laptop is two.",
  wishlistSaves:
    "WishlistItem rows created in this period. Signed-in accounts only — a guest wishlist lives in localStorage and never reaches the database, so this undercounts by an unknown amount.",
  couponUse:
    "CouponRedemption rows recorded in this period, and the discount each one actually applied. A redemption is kept even if the order is later cancelled, so this can exceed the discount in the revenue figures.",

  /* ---- where ---------------------------------------------------------- */

  place:
    "Counted orders grouped by the city or state the customer typed at checkout. There is no dropdown behind those fields, so the grouping folds case and stray spaces together — \"gujarat\" and \"Gujarat\" are one row — and nothing else. A misspelling stays its own row on purpose: correcting one would need a place list and a guess, and a wrong guess silently merges two real places into a number nobody can unpick.",
  missingPlace:
    "Counted orders whose city or state field was blank. Excluded from the list above rather than bucketed as \"Unknown\", so the rows shown always add up to the orders that actually named a place.",

  /* ---- variants -------------------------------------------------------- */

  optionMix:
    "Units sold per chosen option value, read from each order line's own options snapshot — the size the shopper actually picked, frozen at purchase, so re-editing a product later cannot rewrite it. Within one dimension the values add up to that dimension's total exactly, because a line carries at most one value for it.",
  optionWithout:
    "Units on lines that carried no value for this option at all — a product that does not offer it, or a line saved before it existed. Shown so the percentages have a stated denominator instead of an implied one.",
  optionRevenue:
    "Σ line revenue (price × quantity, less that line's exact share of the order discount) for lines carrying this value. It is the same per-line figure the product rankings use, so the two reconcile.",

  /* ---- returns --------------------------------------------------------- */

  returnRate:
    "Of the orders PLACED in this period, the share that have since had a return request raised against them — whenever it was raised. Numerator and denominator are the same set of orders, which is what makes this a rate rather than two counts divided by each other. It is right-censored: an order placed yesterday has had one day to be returned, so a recent period always reads low.",
  unitReturnRate:
    "Σ quantity on return requests against orders placed in this period, over units sold in the same orders. Same cohort rule as above, and the same censoring caveat.",
  returnReason:
    "The reason the customer chose when raising the request, over the same cohort. Reasons are admin-editable in Returns, so a renamed reason starts a new row rather than rewriting history.",
  refundRate:
    "Refunds paid out in this period over net revenue booked in this period. The two are on different clocks — a refund here can belong to an order from an earlier period — so read it as cash out over cash booked, not as a restatement of revenue.",

  /* ---- fulfilment ------------------------------------------------------ */

  dispatchTime:
    "Time from the order being placed to the first \"shipped\" entry in its own status history. Only orders that have actually shipped are counted, so an order still sitting unshipped does not appear as a fast dispatch — it is simply not in the denominator, which is stated beside the figure.",
  deliveryTime:
    "Time from the first \"shipped\" entry to the first \"delivered\" entry in the order's status history. Courier scans are recorded with the courier's own timestamp, so this measures the parcel's journey rather than when an admin got round to updating it.",
  endToEndTime:
    "Time from the order being placed to the first \"delivered\" entry — dispatch and delivery together, which is the only one of the three the customer experiences.",
  medianVsMean:
    "The median is the middle order: half were faster, half slower. The mean is the average. One parcel stuck in a depot for a fortnight moves the mean by days and the median not at all, so they are shown together — when they disagree, the gap is the tail.",
  awaitingDispatch:
    "Confirmed orders in this period with no AWB yet. The ones with a NimbusPost draft already staged are counted separately: that is the deliberate review gate, not a backlog.",
  courierSplit:
    "Shipped and delivered orders grouped by the courier recorded on the order. NimbusPost allocates the carrier at booking, so this is who actually carried the parcel, not who was chosen.",
  rto:
    "Orders whose latest RAW courier status mentions RTO (return to origin). There is no RTO order status — a completed RTO maps to cancelled — so this reads Order.deliveryStatus, which is whatever the courier last reported, and it only counts orders NimbusPost is tracking.",

  /* ---- customers ------------------------------------------------------- */

  repeatRate:
    "Of everyone who has ever placed a counted order, the share who have placed two or more. Deliberately ALL-TIME and not filtered by the period above: a repeat rate over seven days would mostly measure the length of the window, and would fall every time the reader narrowed it.",
  newVsReturning:
    "Every counted order in this period, split by whether it was that customer's first counted order ever. Who a customer IS comes from lib/customers.ts, which merges guest orders onto accounts by email and phone — the same rule Admin → Customers uses, so the two screens cannot disagree.",
  ltv:
    "Average and median lifetime spend per buyer, all-time. This uses order TOTAL — what the customer was billed, including shipping — because that is the figure Admin → Customers shows on each person. It is therefore slightly higher than net revenue, which excludes shipping. Two questions, two definitions, stated rather than reconciled by accident.",
  rfmScore:
    "Each buyer is scored 1–3 on Recency (days since their last order), Frequency (counted orders) and Monetary (lifetime spend). The cut-points are this store's own 33rd and 67th percentiles, not industry thresholds — so a score is a rank against your other customers and means nothing next to another store's.",
  rfmSegment:
    "A name for each Recency × Frequency cell, not a sum of the two scores. Adding them loses the difference that matters: \"ordered once yesterday\" and \"ordered five times a year ago\" both total 4 and need opposite actions. Champions ordered recently and often; Loyal order often; Promising ordered recently but once; At risk used to order often and have gone quiet; Lost did neither.",
  cohortRetention:
    "Customers grouped by the month of their first counted order; each column is the share of that group who ordered again in that many months' time. Month 0 is 100% by definition — it is the group's own definition — and is kept as the baseline everything to its right is read against. An empty cell is a month that has not happened yet for that group, never a zero.",
  cohortSize:
    "How many customers started in that month. A retention percentage over three people moves 33 points when one of them orders, so read the width of the row before the colour of it.",
} as const;

/**
 * What this workspace cannot tell you, and the one change each would take.
 *
 * Rendered verbatim: in full on Overview, and filtered by `scope` at the foot
 * of the section each one belongs to. The temptation with an analytics screen
 * is to fill the gap with something impressive-looking; an invented impression
 * count would be worse than an honest blank, because a real decision would get
 * made on it. This list is also the roadmap — every row is one column or one
 * script away from becoming a real figure.
 */
export type NotMeasuredScope =
  | "overview"
  | "sales"
  | "products"
  | "customers"
  | "fulfilment"
  | "finance";

export const NOT_MEASURED: {
  metric: string;
  why: string;
  toGetIt: string;
  /** Which sections show this row. Overview shows every row regardless. */
  scopes: NotMeasuredScope[];
}[] = [
  {
    metric: "Visits, sessions, page views",
    why: "No analytics provider is wired up to this store, and nothing in the database records a page being viewed. There is no row to count.",
    toGetIt:
      "Add a privacy-friendly analytics script (Vercel Analytics or Plausible) to the root layout. Both give visits and page views without a cookie banner.",
    scopes: ["sales"],
  },
  {
    metric: "Conversion rate",
    why: "A conversion rate needs visits as its denominator. Without them, any figure here would be orders divided by something invented.",
    toGetIt: "Falls out of the above once visits are recorded — no other change needed.",
    scopes: ["sales", "products"],
  },
  {
    metric: "Return on ad spend (ROAS), marketing cost",
    why: "Nothing in this database records what was spent on advertising, and no order carries a campaign, referrer or UTM parameter — so neither half of the ratio exists.",
    toGetIt:
      "Capture UTM parameters onto the Lead and Order rows at checkout, and record ad spend somewhere it can be read per period. Both halves are needed; either one alone still gives no ROAS.",
    scopes: ["sales"],
  },
  {
    metric: "Cart abandonment",
    why: "A Lead row is written when something is added to the cart and never removed when it is taken out or bought. Orders carry no visitorId, so an add-to-cart event cannot be matched to the order that followed it. Cart adds and orders can be counted side by side, but the drop-off between them cannot be attributed to the same people.",
    toGetIt:
      "Persist the cart's visitorId onto the Order at checkout. One column, and cart-to-order becomes a real per-browser funnel.",
    scopes: ["products"],
  },
  {
    metric: "Profit and margin",
    why: "There is no cost price on a product. Revenue is not profit, and nothing anywhere in this workspace should be read as if it were.",
    toGetIt:
      "A costPrice column on Product, written from the admin product form. Margin per product, per order and per period all follow from that one column.",
    scopes: ["overview", "sales", "products", "finance"],
  },
  {
    metric: "What shipping actually cost",
    why: "The courier's bill is not in this database. The shipping figure on an order is what the CUSTOMER was charged — usually zero, since most products ship free — not what NimbusPost charged the store.",
    toGetIt:
      "Record the NimbusPost charge onto the order when a shipment is booked; the booking response already carries it.",
    scopes: ["fulfilment", "finance"],
  },
  {
    metric: "Why a parcel was late",
    why: "Dispatch and delivery times come from the order's own status history, which records when a status changed and not why. A courier delay, a stockout and a festival holiday all look identical here.",
    toGetIt:
      "Store the courier's full scan list per shipment rather than only the latest status — the tracking response already returns it.",
    scopes: ["fulfilment"],
  },
  {
    metric: "Why a customer stopped ordering",
    why: "Cohort retention shows that a group went quiet; nothing in the database says whether they were disappointed, moved, or simply have not needed another hoodie.",
    toGetIt:
      "Not a schema change — a post-purchase or win-back email with a reply worth reading. No analytics column substitutes for asking.",
    scopes: ["customers"],
  },
  {
    metric: "Predicted lifetime value, churn risk, AI insight",
    why: "This store has a few dozen orders. Any model fitted to that would be fitting noise, and a confident-looking prediction is far more dangerous than a blank — it is the one number an owner would act on without checking.",
    toGetIt:
      "Time. Revisit at a few thousand orders across several seasons. Until then the recency-and-frequency grid on Customers is the honest version of the same question: it ranks who has gone quiet without pretending to know why or what happens next.",
    scopes: ["customers"],
  },
];

/** The rows one section should show at its foot. */
export function notMeasuredFor(scope: NotMeasuredScope) {
  return scope === "overview"
    ? NOT_MEASURED
    : NOT_MEASURED.filter((r) => r.scopes.includes(scope));
}
