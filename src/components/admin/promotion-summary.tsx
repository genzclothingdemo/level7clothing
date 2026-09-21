/**
 * How a promotion's schedule is judged, and the words for it.
 *
 * No `"use client"` on purpose, and no imports that reach the database: the
 * list is a server component and the editor is a client one, and both have to
 * describe a promotion with the same words or the admin is reading two
 * different stories about the same row. This is the same split — and the same
 * reason for it — as `coupon-summary.tsx`.
 *
 * ---------------------------------------------------------------------------
 * Why the status rule works on strings
 * ---------------------------------------------------------------------------
 *
 * The editor holds its two dates as raw `datetime-local` values
 * (`YYYY-MM-DDTHH:mm`), already in the store's own time zone. IST has no DST,
 * so that string *is* the instant, and two of them sort lexicographically in
 * exactly chronological order. Comparing strings therefore needs no parser at
 * all — which matters, because the only IST parser in the codebase
 * (`fromStoreDateTimeInput`) lives in `@/lib/coupons`, a module that pulls in
 * Prisma and so cannot be imported by a client component. The alternative was
 * a second copy of that parser, and a second copy of a time-zone rule is
 * exactly the kind of thing that silently drifts.
 *
 * So there is **one** status rule, `promotionStatusFor`, and both callers hand
 * it the same shape:
 *   - the editor passes the input values straight through;
 *   - the list converts its `Date` columns with `toStoreDateTimeInput`.
 *
 * One consequence, deliberately accepted: comparisons are minute-granular, so
 * a promotion whose window ends at 14:30:45 reads as expired from 14:30. The
 * admin can only type minutes, and the *authoritative* gate is the SQL window
 * in `getLivePromotion()`, which compares real instants. Everything here is a
 * readout.
 */

import type { PromotionKind } from "@/lib/promotions";

/* ------------------------------------------------------------------ */
/*  The store's clock                                                  */
/* ------------------------------------------------------------------ */

const STORE_CLOCK = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  // `hour12: false` alone has historically produced "24" for midnight in V8.
  // `h23` is the explicit form; the clamp below is the belt to its braces.
  hourCycle: "h23",
});

/**
 * "Now", in the shape a `datetime-local` input holds — so it can be compared
 * against the admin's typed values as a plain string.
 *
 * Call this in an effect, never during render: it depends on the wall clock,
 * and a value computed on the server would not survive hydration.
 */
export function storeNowInputValue(now: Date = new Date()): string {
  const parts: Record<string, string> = {};
  for (const p of STORE_CLOCK.formatToParts(now)) parts[p.type] = p.value;
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return `${parts.year}-${parts.month}-${parts.day}T${hour}:${parts.minute}`;
}

/* ------------------------------------------------------------------ */
/*  Status                                                             */
/* ------------------------------------------------------------------ */

export type PromotionStatus = "live" | "scheduled" | "expired" | "paused";

/**
 * The one word that answers "is this on the store right now, and if not why".
 *
 * Ordered by which fact the admin needs first: a promotion they switched off
 * is "Paused" even when it has also expired, because switching it off is the
 * thing they did.
 *
 * Blank dates mean an open end. `startsAt` is inclusive and `endsAt` is
 * exclusive, matching both the coupon engine and the SQL in
 * `getLivePromotion()`.
 *
 * Note this answers "is it *eligible*", not "is it the one showing" — a
 * higher-priority promotion can be eligible at the same time. The list marks
 * the actual winner separately, from `getLivePromotion()` itself.
 */
export function promotionStatusFor(
  isActive: boolean,
  /** `YYYY-MM-DDTHH:mm` in store time, or "" for open-ended. */
  startsAt: string,
  endsAt: string,
  /** `storeNowInputValue()`. */
  nowInput: string
): PromotionStatus {
  if (!isActive) return "paused";
  if (endsAt && nowInput >= endsAt) return "expired";
  if (startsAt && nowInput < startsAt) return "scheduled";
  return "live";
}

export const PROMOTION_STATUS_LABEL: Record<PromotionStatus, string> = {
  live: "Live",
  scheduled: "Scheduled",
  expired: "Expired",
  paused: "Paused",
};

/**
 * Colour carries the same message as the word, so scanning the column works
 * before anything is read. Matches the coupon list's palette exactly — violet
 * is "waiting", green is "on", and the ordinary case never spends the accent.
 */
export const PROMOTION_STATUS_CLASS: Record<PromotionStatus, string> = {
  live: "bg-success/15 text-success",
  scheduled: "bg-accent/15 text-accent",
  expired: "bg-danger/10 text-danger",
  paused: "bg-muted text-muted-foreground",
};

export function PromotionStatusPill({ status }: { status: PromotionStatus }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-xs ${PROMOTION_STATUS_CLASS[status]}`}
    >
      {PROMOTION_STATUS_LABEL[status]}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Wording                                                            */
/* ------------------------------------------------------------------ */

/** Where a promotion is allowed to appear, in words. */
export function promotionSurfaceSummary(kind: PromotionKind): string {
  if (kind === "popup") return "Popup only";
  if (kind === "both") return "Banner + popup";
  return "Banner only";
}

/** How long a dismissal sticks, in words. */
export function promotionDismissSummary(days: number): string {
  if (days <= 0) return "Comes back next visit";
  if (days === 1) return "Hidden for a day once dismissed";
  return `Hidden for ${days} days once dismissed`;
}

/** "From 1 Oct" / "Until 31 Oct" / "1 Oct → 31 Oct" / "No end dates". */
export function promotionWindowSummary(from: string, to: string): string {
  if (from && to) return `${from} → ${to}`;
  if (from) return `From ${from}`;
  if (to) return `Until ${to}`;
  return "No end dates";
}

/**
 * The scheduling mistake worth catching before it is saved: a window that can
 * never contain an instant. Returns the message, or `null` when the dates are
 * fine. The server action re-checks this with real `Date`s — this copy exists
 * so the admin finds out while typing rather than on submit.
 */
export function promotionWindowError(startsAt: string, endsAt: string): string | null {
  if (!startsAt || !endsAt) return null;
  if (endsAt <= startsAt) return "The end has to come after the start.";
  return null;
}
