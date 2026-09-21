/**
 * Analytics — the one place every figure on Admin → Finance is worked out.
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
 * No sessions, page views, impressions, reach, bounce rate or conversion
 * rate-from-traffic. No analytics provider is wired up to this store, so none
 * of those exist in any table. See `NOT_MEASURED` at the bottom — the UI
 * renders it verbatim rather than leaving a plausible-looking gap.
 *
 * ── Performance ──────────────────────────────────────────────────────────────
 *
 * Everything is one `Promise.all` of roughly ten queries; the per-product and
 * per-day breakdowns are folded in memory from a single windowed `findMany`
 * over orders, because `Order.items` is JSON and no `groupBy` can reach inside
 * it. Scalar-only work (the previous period, refunds, coupons, lead and
 * wishlist counts) uses `aggregate`/`groupBy` so those rows are never shipped.
 *
 * **This store is small** — 22 products and orders in the low hundreds, so the
 * windowed row set is tens of kilobytes and the fold is microseconds. The
 * thing that would break first if it grew is the unbounded
 * `findMany` over orders on the "All time" range: at ~50k orders that is a
 * multi-megabyte payload. The fix then is a nightly rollup table
 * (order_day / product_day) written on order state change, with this module
 * reading the rollup for anything older than the current month and live rows
 * only for the current one. Nothing in the definitions above would change.
 */

import { prisma } from "@/lib/prisma";
import { cashInHand } from "@/lib/returns";

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
    return { key, label: "All time", days: null, from: null, to: now, previous: null };
  }
  const from = new Date(now.getTime() - spec.days * DAY_MS);
  return {
    key,
    label: `Last ${spec.days} days`,
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
    out.push({ productId, name, price, quantity });
  }
  return out;
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

export type FinanceReport = {
  window: FinanceWindow;
  granularity: Granularity;
  revenue: RevenueSummary;
  cash: CashSummary;
  refunds: RefundSummary;
  series: SeriesPoint[];
  byPaymentMethod: Split[];
  byStatus: Split[];
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
 * Not wrapped in React `cache()`: each Finance tab asks for exactly one report
 * and the range lives in the URL, so there is nothing to dedupe within a
 * request. Every query degrades to an empty result rather than throwing —
 * a Finance page is somewhere you go *when* something looks wrong, and a
 * missing coupon table should not take the revenue figure down with it. The
 * report says `degraded: true` so the page can admit it.
 */
export async function getFinanceReport(
  rangeParam: string | undefined,
  now: Date = new Date()
): Promise<FinanceReport> {
  const win = resolveWindow(rangeParam, now);
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
  const granularity = pickGranularity(spanDays);

  const buckets = new Map<string, SeriesPoint>();
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
    const b = bucketOf(istDayKey(o.createdAt), granularity);
    const point = buckets.get(b.key) ?? { key: b.key, label: b.label, netRevenue: 0, orders: 0, units: 0 };
    point.netRevenue += net;
    point.orders += 1;
    point.units += units;
    buckets.set(b.key, point);

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

    // -- product demand --
    lines.forEach((l, i) => {
      const key = l.productId ?? `name:${l.name.toLowerCase()}`;
      const a =
        demand.get(key) ??
        { productId: l.productId, names: new Set<string>(), units: 0, netRevenue: 0, orders: new Set<string>() };
      a.names.add(l.name);
      a.units += l.quantity;
      a.netRevenue += Math.max(0, l.price * l.quantity - shares[i]);
      a.orders.add(o.id);
      demand.set(key, a);
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
    revenue,
    cash,
    refunds,
    series,
    byPaymentMethod: [...methods.values()].sort(splitSort),
    // Status has a natural lifecycle order; sorting it by size would scramble
    // the one thing the reader is looking for — where orders are piling up.
    byStatus: [...statuses.values()].sort(
      (a, b) =>
        ORDER_STATUS_ORDER.indexOf(a.key as (typeof ORDER_STATUS_ORDER)[number]) -
        ORDER_STATUS_ORDER.indexOf(b.key as (typeof ORDER_STATUS_ORDER)[number])
    ),
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

/* ------------------------------------------------------------------ */
/*  Metric definitions — rendered verbatim in the UI                   */
/* ------------------------------------------------------------------ */

/**
 * Every number on the Finance screens carries one of these behind an (i).
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
} as const;

/**
 * What this dashboard cannot tell you, and what it would take.
 *
 * Rendered as-is on the Demand tab. The temptation with an analytics screen is
 * to fill the gap with something impressive-looking; an invented impression
 * count would be worse than an honest blank, because a real decision would get
 * made on it.
 */
export const NOT_MEASURED: { metric: string; why: string; toGetIt: string }[] = [
  {
    metric: "Visits, sessions, page views",
    why: "No analytics provider is wired up to this store, and nothing in the database records a page being viewed. There is no row to count.",
    toGetIt:
      "Add a privacy-friendly analytics script (Vercel Analytics or Plausible) to the root layout. Both give visits and page views without a cookie banner.",
  },
  {
    metric: "Conversion rate",
    why: "A conversion rate needs visits as its denominator. Without them, any figure here would be orders divided by something invented.",
    toGetIt: "Falls out of the above once visits are recorded.",
  },
  {
    metric: "Cart abandonment",
    why: "A Lead row is written when something is added to the cart and never removed when it is taken out or bought. Orders carry no visitorId, so an add-to-cart event cannot be matched to the order that followed it. Cart adds and orders can be counted side by side, but the drop-off between them cannot be attributed to the same people.",
    toGetIt:
      "Persist the cart's visitorId onto the Order at checkout. One column, and cart-to-order becomes a real per-browser funnel.",
  },
  {
    metric: "Traffic source, campaign attribution, reach",
    why: "No referrer, UTM parameter or ad spend is stored anywhere in this database.",
    toGetIt:
      "Capture UTM parameters into the Lead and Order rows, and record ad spend somewhere, before any return-on-spend figure can be honest.",
  },
  {
    metric: "Profit, margin, courier cost",
    why: "There is no cost-of-goods column on Product and no courier invoice in the database. Revenue is not profit, and nothing here should be read as if it were.",
    toGetIt:
      "A costPrice column on Product, plus recording the NimbusPost charge on the order when a shipment is booked.",
  },
  {
    metric: "Returning vs new customers",
    why: "Computable, but not from this module — it needs the identity resolution in lib/customers.ts, which merges guests and accounts on contact details. Duplicating that rule here is exactly how two screens end up disagreeing about the same shopper.",
    toGetIt: "Admin → Customers already shows it per person.",
  },
];
