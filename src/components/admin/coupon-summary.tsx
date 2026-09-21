/**
 * How a coupon's rules are put into words, and the words for its status.
 *
 * This lives beside the components rather than in `@/lib/coupons` for one
 * mechanical reason: the engine imports Prisma, so anything that imports the
 * engine is server-only. The editor needs the same sentence to update live as
 * the admin types, which makes it a client component — so the wording has to
 * sit in a module with no server imports at all. Nothing here decides
 * anything; every rule is still the engine's.
 *
 * No `"use client"` on purpose: the module is pure, so the list (a server
 * component) and the form (a client one) can both pull it in.
 */

import type { CouponStatus } from "@/lib/coupons";

/** The rules, as the form holds them and as the list reads them back. */
export type CouponRules = {
  discountAmount: number;
  isPercentage: boolean;
  productIds: string[];
  minSpend: number | null;
  maxDiscount: number | null;
  usageLimit: number | null;
  perUserLimit: number | null;
};

function rupees(n: number): string {
  return `₹${n.toLocaleString("en-IN")}`;
}

/**
 * What the coupon takes off, and what has to be true first. One sentence,
 * because the point is to be readable at a glance in a table row.
 */
export function couponOfferSummary(c: CouponRules): string {
  const off = c.isPercentage
    ? `${c.discountAmount}% off`
    : `${rupees(c.discountAmount)} off`;
  const scope = c.productIds.length
    ? `${c.productIds.length} selected product${c.productIds.length === 1 ? "" : "s"}`
    : "the whole cart";

  const parts = [`${off} ${scope}`];
  if (c.isPercentage && c.maxDiscount !== null) parts.push(`capped at ${rupees(c.maxDiscount)}`);
  if (c.minSpend !== null) {
    // Spells out the decision the engine makes: on a scoped coupon the
    // threshold is measured against the matching lines, not the cart.
    parts.push(
      c.productIds.length
        ? `once those lines reach ${rupees(c.minSpend)}`
        : `on carts of ${rupees(c.minSpend)} or more`
    );
  }
  return `${parts.join(", ")}.`;
}

/** The caps, as a second sentence. Empty string when the coupon has none. */
export function couponLimitSummary(c: CouponRules): string {
  const parts: string[] = [];
  if (c.usageLimit !== null)
    parts.push(`${c.usageLimit} use${c.usageLimit === 1 ? "" : "s"} in total`);
  if (c.perUserLimit !== null)
    parts.push(
      c.perUserLimit === 1 ? "once per customer" : `${c.perUserLimit} per customer`
    );
  return parts.length ? `${parts.join(", ")}.` : "";
}

/* ------------------------------------------------------------------ */
/*  Dates                                                              */
/* ------------------------------------------------------------------ */

/**
 * Formatted in the store's own time zone, never the reader's. A window typed
 * as "31 Oct, 23:59" has to read back as that on a laptop in India and in a
 * Vercel function running on UTC — otherwise the admin sets one deadline and
 * the list shows another.
 */
const STORE_DATE = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatStoreDateTime(value: string | Date | null | undefined): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? "" : STORE_DATE.format(d);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The same thing for a raw `datetime-local` value, straight off the input.
 *
 * Reformats the literal `YYYY-MM-DDTHH:mm` rather than building a `Date` from
 * it — the string is already the store's wall clock, so there is no instant to
 * resolve and nothing a time zone could shift. That keeps the editor's live
 * preview honest while the admin is still typing an incomplete date.
 */
export function formatStoreInputValue(value: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value?.trim() ?? "");
  if (!m) return "";
  const [, y, mo, d, h, min] = m;
  const month = MONTHS[Number(mo) - 1];
  if (!month) return "";
  return `${Number(d)} ${month} ${y}, ${h}:${min}`;
}

/** "From 1 Oct" / "Until 31 Oct" / "1 Oct → 31 Oct" / "Always on". */
export function couponWindowSummary(from: string, to: string): string {
  if (from && to) return `${from} → ${to}`;
  if (from) return `From ${from}`;
  if (to) return `Until ${to}`;
  return "Always on";
}

/* ------------------------------------------------------------------ */
/*  Status                                                             */
/* ------------------------------------------------------------------ */

export const COUPON_STATUS_LABEL: Record<CouponStatus, string> = {
  active: "Active",
  hidden: "Hidden",
  scheduled: "Scheduled",
  expired: "Expired",
  exhausted: "Used up",
};

/**
 * Colour carries the same message as the word, so a scan down the column works
 * before anything is read. Violet is the accent — reserved for "waiting", not
 * spent on the ordinary case.
 */
export const COUPON_STATUS_CLASS: Record<CouponStatus, string> = {
  active: "bg-success/15 text-success",
  scheduled: "bg-accent/15 text-accent",
  expired: "bg-danger/10 text-danger",
  exhausted: "bg-danger/10 text-danger",
  hidden: "bg-muted text-muted-foreground",
};

export function CouponStatusPill({ status }: { status: CouponStatus }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-xs ${COUPON_STATUS_CLASS[status]}`}
    >
      {COUPON_STATUS_LABEL[status]}
    </span>
  );
}
