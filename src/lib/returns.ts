// Returns — shared status/reason config and the policy resolution rule.
//
// Policy lives in two layers, mirroring the product-info blocks:
//   SiteSettings.defaultReturnable / returnWindowDays / defaultReturnsInfo
//   Product.returnable (null = inherit) / Product.returnsInfo (null = inherit)
// `SiteSettings.returnsEnabled` is a master switch above both — OFF means no
// product is returnable no matter what it says, which is how the owner closes
// returns during a festival rush without editing 22 products.
//
// The refund half lives at the bottom of this file, beside the policy it
// depends on: `computeRefund` is the one place the money is worked out, and
// both the admin panel and the customer's order page call it.
//
// This module is imported by client components, so it must stay free of
// `prisma` and any server-only import. Everything here is pure.

import { formatINR } from "@/lib/utils";
import { mapNimbusStatus } from "@/lib/nimbus-status";

export const RETURN_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "picked_up",
  "received",
  "refunded",
  "cancelled",
] as const;

export type ReturnStatus = (typeof RETURN_STATUSES)[number];

export function isReturnStatus(v: string): v is ReturnStatus {
  return (RETURN_STATUSES as readonly string[]).includes(v);
}

export const RETURN_STATUS_LABEL: Record<ReturnStatus, string> = {
  pending: "Awaiting review",
  approved: "Approved",
  rejected: "Rejected",
  picked_up: "Picked up",
  received: "Received",
  refunded: "Refunded",
  cancelled: "Cancelled",
};

/** Tailwind pill classes — same palette as the order/lead badges. */
export const RETURN_STATUS_COLOR: Record<ReturnStatus, string> = {
  pending: "bg-accent/15 text-accent",
  approved: "bg-blue-500/15 text-blue-500",
  rejected: "bg-danger/15 text-danger",
  picked_up: "bg-violet-500/15 text-violet-500",
  received: "bg-cyan-500/15 text-cyan-600",
  refunded: "bg-success/15 text-success",
  cancelled: "bg-muted-foreground/15 text-muted-foreground",
};

/**
 * Statuses that still need someone to act. Drives the "Needs action" tab and the
 * sidebar count, so a request can't sit unnoticed.
 */
export const OPEN_RETURN_STATUSES: ReturnStatus[] = [
  "pending",
  "approved",
  "picked_up",
  "received",
];

/**
 * How far along its lifecycle a status is, for the one rule every writer needs:
 * **never walk a return backwards.** A late or duplicated courier scan must not
 * turn a received parcel back into one in transit.
 *
 * `rejected` / `cancelled` are deliberately absent — they are side exits, not
 * points on this line, and are handled by {@link isTerminalReturnStatus}.
 */
const RETURN_RANK: Record<ReturnStatus, number> = {
  pending: 0,
  approved: 1,
  picked_up: 2,
  received: 3,
  refunded: 4,
  rejected: -1,
  cancelled: -1,
};

/** Nothing automated may move a return out of one of these. */
export function isTerminalReturnStatus(status: ReturnStatus): boolean {
  return status === "refunded" || status === "rejected" || status === "cancelled";
}

/**
 * The next status a courier scan may set, or `null` for "leave it alone".
 *
 * Same discipline as `mapNimbusStatus` returning null: an event that doesn't
 * clearly advance the request changes nothing, because a wrong automatic move
 * is far worse than a missed one.
 */
export function advanceReturnStatus(
  current: ReturnStatus,
  proposed: ReturnStatus
): ReturnStatus | null {
  if (isTerminalReturnStatus(current)) return null;
  if (RETURN_RANK[proposed] <= RETURN_RANK[current]) return null;
  return proposed;
}

/* ------------------------------------------------------------ reverse leg */
/*
 * The physical journey of the goods coming back, which is a different thing
 * from the *decision* recorded in `status`. An admin can mark a return
 * "received" by hand the moment it is approved; that says what a human
 * believes, not where the parcel is. These helpers answer the second question,
 * and they are what the refund panel shows beside the payout button.
 *
 * There is NO second status vocabulary here. The courier's own words are read
 * by `mapNimbusStatus` — the one table the webhook and the poller share — and
 * translated into this store's return statuses by `reverseReturnStatus` below.
 */

export type ReverseLeg =
  /** Nothing staged with the courier at all. */
  | "none"
  /** An unbooked draft exists in NimbusPost. No courier has been paid or sent. */
  | "drafted"
  /** Booked: an AWB exists and a courier is due to collect. */
  | "booked"
  /** Collected from the customer and travelling back to us. */
  | "in_transit"
  /** Back with us. */
  | "back"
  /** The courier leg broke — nothing is coming until someone acts. */
  | "failed";

export const REVERSE_LEG_LABEL: Record<ReverseLeg, string> = {
  none: "No pickup arranged",
  drafted: "Draft only — not booked",
  booked: "Booked, awaiting collection",
  in_transit: "On its way back",
  back: "Back with you",
  failed: "Pickup failed",
};

/** Who is physically holding the goods right now. */
export type ParcelHolder = "customer" | "courier" | "store";

export const PARCEL_HOLDER_LABEL: Record<ParcelHolder, string> = {
  customer: "Still with the customer",
  courier: "With the courier",
  store: "Back with you",
};

/** Just the columns the reverse-leg reading needs, so any caller can build one. */
export type ReverseLegInput = {
  status: ReturnStatus;
  /** The NimbusPost draft id, set the moment a reverse pickup is staged. */
  nimbusOrderId?: string | null;
  /** The reverse AWB. Only ever set once the draft has actually been booked. */
  nimbusAwb?: string | null;
  /** Last reverse-pickup failure, if any. */
  nimbusError?: string | null;
};

/**
 * Where the parcel has got to, read from the row rather than assumed.
 *
 * The return's own status is allowed to *win* — someone who ticks "received"
 * has the box in their hands, whatever the courier's API last said — but it is
 * never allowed to invent a courier leg that does not exist. A return sitting
 * at "approved" with no draft is `none`, and that is exactly the state the
 * refund panel needs to be able to say out loud.
 */
export function reverseLegOf(input: ReverseLegInput): ReverseLeg {
  const { status } = input;

  // A human has confirmed the goods are here. Nothing the courier says later
  // moves this backwards.
  if (status === "received" || status === "refunded") return "back";

  if (input.nimbusError) return "failed";
  if (status === "picked_up") return "in_transit";
  if (input.nimbusAwb) return "booked";
  if (input.nimbusOrderId) return "drafted";
  return "none";
}

/**
 * Who is holding the goods. The honest answer the refund action is shown
 * beside — the point is not to block a payout but to stop one happening by
 * accident while the box is still in the customer's hallway.
 */
export function parcelHolder(leg: ReverseLeg): ParcelHolder {
  if (leg === "back") return "store";
  if (leg === "in_transit") return "courier";
  return "customer";
}

/**
 * True when the goods are demonstrably back. The single rule both the admin UI
 * and `markRefundPaid` branch on, so the checkbox the owner ticks and the
 * condition the server enforces cannot drift.
 */
export function goodsAreBack(input: ReverseLegInput): boolean {
  return parcelHolder(reverseLegOf(input)) === "store";
}

/**
 * A courier status, for a parcel travelling the REVERSE leg, as one of this
 * store's return statuses.
 *
 * Built on `mapNimbusStatus` on purpose — the courier vocabulary is read once,
 * in one table, and only its *meaning* is reinterpreted here. On the reverse
 * leg the two ends swap over:
 *
 *   `shipped`   — it left the customer, so the return is `picked_up`
 *   `delivered` — it arrived at OUR warehouse, so the return is `received`
 *
 * Everything else returns `null`, i.e. "record the scan, change nothing".
 * `cancelled` in particular must NOT cancel the return: a dead courier job
 * means the pickup needs rebooking, not that the customer's return is void.
 */
export function reverseReturnStatus(raw: string | null | undefined): ReturnStatus | null {
  switch (mapNimbusStatus(raw)) {
    case "shipped":
      return "picked_up";
    case "delivered":
      return "received";
    default:
      return null;
  }
}

/**
 * True when the courier is reporting a **return to origin** on a FORWARD
 * shipment: delivery failed and the parcel is being carried back to us.
 *
 * Read off the raw courier text rather than `mapNimbusStatus`, which
 * deliberately collapses RTO into `shipped` / `cancelled` and so cannot tell an
 * ordinary cancellation apart from goods physically coming back. That
 * distinction is the whole point: an RTO ends with stock on our shelf and money
 * the customer may be owed, and nothing else in the pipeline says so.
 */
export function isRtoStatus(raw: string | null | undefined): boolean {
  return /\brto\b|return to origin/i.test(String(raw ?? ""));
}

/** True once an RTO parcel has actually completed its journey back. */
export function isRtoComplete(raw: string | null | undefined): boolean {
  const v = String(raw ?? "").trim().toLowerCase();
  return isRtoStatus(v) && (v.includes("delivered") || v.includes("received"));
}

/* ----------------------------------------------------------------- reasons */

/**
 * Legacy fixed reasons, stored as slugs on rows raised before the list became
 * admin-editable. Kept only so those rows still render a sentence instead of
 * "wrong_item" — new requests are never validated against this list.
 */
export const RETURN_REASONS = [
  { value: "damaged", label: "Arrived damaged or broken" },
  { value: "wrong_item", label: "Wrong item or variant sent" },
  { value: "not_as_described", label: "Not as described / photos" },
  { value: "quality", label: "Quality not as expected" },
  { value: "missing_parts", label: "Something was missing" },
  { value: "other", label: "Other reason" },
] as const;

export type ReturnReason = (typeof RETURN_REASONS)[number]["value"];

/**
 * What the customer may choose, when `SiteSettings.returnReasons` is empty.
 * Which grounds a return is accepted on is a policy decision, so the live list
 * is admin-editable at Admin → Returns → Return policy; this is the floor that
 * keeps the form usable if that list is ever emptied. Mirrors the
 * `@default(...)` on SiteSettings.returnReasons — keep the two in step.
 */
export const DEFAULT_RETURN_REASONS: string[] = [
  "Wrong size",
  "Damaged or defective",
  "Wrong item delivered",
  "Not as described",
  "Changed my mind",
];

/** Bounds for the admin editor, enforced again in `normaliseReturnReasons`. */
export const MAX_RETURN_REASONS = 12;
export const MAX_RETURN_REASON_LENGTH = 60;

/**
 * Clean an admin-supplied reason list into what is safe to store and show:
 * trimmed, blank-free, length-capped, de-duplicated case-insensitively.
 *
 * An empty result falls back to `DEFAULT_RETURN_REASONS` rather than saving
 * nothing — a settings row with no reasons would leave the customer's dropdown
 * empty and returns unraisable, which is not what "save" should ever mean.
 */
export function normaliseReturnReasons(
  list: readonly string[] | null | undefined
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list ?? []) {
    if (typeof raw !== "string") continue;
    const value = raw.trim().replace(/\s+/g, " ").slice(0, MAX_RETURN_REASON_LENGTH);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= MAX_RETURN_REASONS) break;
  }
  return out.length ? out : [...DEFAULT_RETURN_REASONS];
}

/**
 * The reason exactly as the admin spelled it, or `null` when the submitted
 * value is not on the configured list. Returning the canonical string (rather
 * than a boolean) is what stops a client storing its own casing or an option
 * the admin has since removed.
 */
export function matchReturnReason(
  input: string,
  configured: readonly string[]
): string | null {
  const value = input.trim();
  if (!value) return null;
  return configured.find((r) => r.toLowerCase() === value.toLowerCase()) ?? null;
}

/** Legacy slug → sentence; an admin-configured reason is already a sentence. */
export function returnReasonLabel(value: string): string {
  return RETURN_REASONS.find((r) => r.value === value)?.label ?? value;
}

export function isReturnReason(v: string): v is ReturnReason {
  return RETURN_REASONS.some((r) => r.value === v);
}

/** Legacy slugs that meant "our mistake". Matched exactly. */
export const OUR_FAULT_REASONS: ReturnReason[] = [
  "damaged",
  "wrong_item",
  "missing_parts",
];

/**
 * Substrings that mark a reason as our mistake rather than a change of mind.
 *
 * The reason is admin-authored free text now, so this can't be a fixed list.
 * Note "wrong item" and not "wrong" — "Wrong size" is the shopper guessing,
 * not us mis-picking, and flagging it as our fault would distort the queue.
 * Also used to build the admin's "our fault" filter, so a badge on the card
 * and a row in the filtered list can never disagree.
 */
export const OUR_FAULT_PATTERNS: string[] = [
  "damag",
  "defect",
  "broken",
  "faulty",
  "wrong item",
  "wrong product",
  "missing",
  "not as described",
];

export function isOurFaultReason(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (!v) return false;
  if ((OUR_FAULT_REASONS as readonly string[]).includes(v)) return true;
  return OUR_FAULT_PATTERNS.some((p) => v.includes(p));
}

/* ------------------------------------------------------------- eligibility */

/** Why a return can't be raised. `ok` is the only value that permits one. */
export type ReturnBlock =
  | "ok"
  | "store_disabled"
  | "product_excluded"
  | "product_customised"
  | "not_delivered"
  | "window_closed";

export type ReturnPolicy = {
  /** Can this product be returned at all right now? */
  returnable: boolean;
  /** Days after delivery a request is still accepted. */
  windowDays: number;
  /** The customer-facing policy copy (already resolved product → store). */
  text: string;
  /** Why it isn't returnable, for the UI to explain rather than just hide. */
  reason: "ok" | "store_disabled" | "product_excluded" | "product_customised";
};

/**
 * Resolve the effective return policy for one product. The only place the
 * two-layer rule is implemented — the product page, the order page and the
 * request action all call this so they can never disagree about whether
 * something is returnable.
 *
 * Three inputs, in strict order of authority:
 *   1. `settings.returnsEnabled` — the store is closed to returns, full stop.
 *   2. `product.returnable` — an explicit true/false set by the admin.
 *   3. `product.isCustomisable` — made-to-order pieces default to NOT
 *      returnable, because there is nothing to resell. The admin can still
 *      override that by ticking `returnable` on the product itself, which is
 *      why this is only consulted when `returnable` is NULL.
 */
export function resolveReturnPolicy(
  product: {
    returnable?: boolean | null;
    returnsInfo?: string | null;
    isCustomisable?: boolean | null;
  },
  settings: {
    returnsEnabled: boolean;
    defaultReturnable: boolean;
    returnWindowDays: number;
    defaultReturnsInfo?: string;
  }
): ReturnPolicy {
  const text = (product.returnsInfo ?? settings.defaultReturnsInfo ?? "").trim();
  const windowDays = settings.returnWindowDays;

  if (!settings.returnsEnabled) {
    return { returnable: false, windowDays, text, reason: "store_disabled" };
  }

  // Only `null`/`undefined` inherits — an explicit `false` is the admin
  // excluding this piece, and an explicit `true` re-admits a customised one.
  if (product.returnable === false) {
    return { returnable: false, windowDays, text, reason: "product_excluded" };
  }
  if (product.returnable === true) {
    return { returnable: true, windowDays, text, reason: "ok" };
  }
  if (product.isCustomisable) {
    return { returnable: false, windowDays, text, reason: "product_customised" };
  }

  const returnable = settings.defaultReturnable;
  return {
    returnable,
    windowDays,
    text,
    reason: returnable ? "ok" : "product_excluded",
  };
}

/**
 * What the product page's **Returns & Refunds** block should say — or `null`
 * when it must say nothing at all.
 *
 * The bug this exists to close: the block used to be driven purely by whether
 * `resolveProductInfo()` produced any copy, so a piece marked non-returnable
 * (or a made-to-order piece, or the whole store with returns switched off) still
 * advertised "7-day easy returns". The copy and the rule were resolved by two
 * different functions and nothing made them agree.
 *
 * `null` means render no block. A caller that wants to explain the silence can
 * read `resolveReturnPolicy().reason` itself; the default is to stay quiet,
 * because "this is final sale" belongs next to the buy button, not in an
 * accordion the shopper has to open.
 */
export function productReturnsBlock(
  product: {
    returnable?: boolean | null;
    returnsInfo?: string | null;
    isCustomisable?: boolean | null;
  },
  settings: {
    returnsEnabled: boolean;
    defaultReturnable: boolean;
    returnWindowDays: number;
    defaultReturnsInfo?: string;
  }
): { text: string; windowDays: number } | null {
  const policy = resolveReturnPolicy(product, settings);
  if (!policy.returnable) return null;
  const text = policy.text.trim();
  return text ? { text, windowDays: policy.windowDays } : null;
}

const DAY_MS = 86_400_000;

export type ReturnWindow = {
  /** True while a request can still be raised. */
  open: boolean;
  /** Whole days remaining, rounded up. 0 once closed. */
  daysLeft: number;
  /** When the clock started, or null when it hasn't. */
  deliveredAt: Date | null;
  /** The instant the window shuts. Null when the clock hasn't started. */
  closesAt: Date | null;
  /** Which timestamp the clock was measured from — surfaced for admin audit. */
  measuredFrom: "delivery" | "order_date" | null;
};

/**
 * Is the order still inside its return window?
 *
 * The clock starts at the courier's delivery scan (`deliveryStatusAt`) and
 * falls back to the order date when an order was marked delivered by hand with
 * no scan behind it. It never starts at "now", which would make every order
 * eligible forever, and it never starts at all until the order is delivered.
 *
 * **Boundary rule (documented on purpose):** the window is the half-open
 * interval `[deliveredAt, deliveredAt + windowDays × 24h)`. Delivered 6 days
 * ago with a 7-day window is open; delivered exactly 7 days ago, to the
 * millisecond, is **closed**; 8 days ago is closed. "7-day returns" therefore
 * means seven complete days of opportunity, not eight.
 *
 * Returns `daysLeft` (rounded up, so a few hours left still reads "1 day") and
 * `closesAt`, so the UI can name the date instead of just hiding a button.
 */
export function returnWindow(
  order: { status: string; deliveryStatusAt?: Date | null; createdAt: Date },
  windowDays: number,
  now: Date
): ReturnWindow {
  const shut: ReturnWindow = {
    open: false,
    daysLeft: 0,
    deliveredAt: null,
    closesAt: null,
    measuredFrom: null,
  };
  if (order.status !== "delivered") return shut;

  const scan = order.deliveryStatusAt ?? null;
  const deliveredAt = scan ?? order.createdAt;
  if (!deliveredAt) return shut;

  // Defensive: a corrupt or absurd setting must not open the window forever.
  const days = Number.isFinite(windowDays)
    ? Math.min(365, Math.max(0, Math.trunc(windowDays)))
    : 0;
  const closesAt = new Date(deliveredAt.getTime() + days * DAY_MS);
  const msLeft = closesAt.getTime() - now.getTime();

  return {
    open: msLeft > 0,
    daysLeft: msLeft > 0 ? Math.ceil(msLeft / DAY_MS) : 0,
    deliveredAt,
    closesAt,
    measuredFrom: scan ? "delivery" : "order_date",
  };
}

/** `12 Sep 2026` — fixed format, so server and client can never disagree. */
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function formatReturnDate(date: Date): string {
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

export type ReturnEligibility = {
  /** The only thing a caller should branch on before creating a request. */
  allowed: boolean;
  code: ReturnBlock;
  /** Plain-English and safe to show a customer verbatim. */
  message: string;
  windowDays: number;
  window: ReturnWindow;
};

/**
 * **The single gate for raising a return.** The server action calls it before
 * writing anything, and the customer's order page calls it (through
 * `getReturnPolicySnapshot`) to decide what to offer — so what the UI says and
 * what the server allows are computed by the same code, from the same row.
 *
 * Order of checks matters: the most useful explanation wins. "Returns are
 * paused" beats "window closed", because re-opening returns is the admin's
 * decision and the date is irrelevant while the switch is off.
 */
export function evaluateReturnEligibility(input: {
  order: { status: string; deliveryStatusAt?: Date | null; createdAt: Date };
  product: {
    returnable?: boolean | null;
    returnsInfo?: string | null;
    isCustomisable?: boolean | null;
  };
  settings: {
    returnsEnabled: boolean;
    defaultReturnable: boolean;
    returnWindowDays: number;
    defaultReturnsInfo?: string;
  };
  now: Date;
}): ReturnEligibility {
  const { order, product, settings, now } = input;
  const policy = resolveReturnPolicy(product, settings);
  const win = returnWindow(order, policy.windowDays, now);
  const base = { windowDays: policy.windowDays, window: win };

  if (!settings.returnsEnabled) {
    return {
      ...base,
      allowed: false,
      code: "store_disabled",
      message: "Returns are paused right now — please message us directly.",
    };
  }
  if (policy.reason === "product_customised") {
    return {
      ...base,
      allowed: false,
      code: "product_customised",
      message:
        "This piece is made to order, so it can't be returned. If it arrived damaged, message us and we'll sort it out.",
    };
  }
  if (!policy.returnable) {
    return {
      ...base,
      allowed: false,
      code: "product_excluded",
      message:
        "This item is marked non-returnable. Message us if something arrived wrong and we'll still take a look.",
    };
  }
  if (!win.deliveredAt || !win.closesAt) {
    return {
      ...base,
      allowed: false,
      code: "not_delivered",
      message: "You can raise a return once this order has been delivered.",
    };
  }
  if (!win.open) {
    return {
      ...base,
      allowed: false,
      code: "window_closed",
      message: `Return window closed on ${formatReturnDate(win.closesAt)}.`,
    };
  }
  return { ...base, allowed: true, code: "ok", message: "" };
}

/** RET-A1B2C3 — short enough to read out on a phone call, unique in practice. */
export function generateReturnNumber(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `RET-${out}`;
}

/* ================================================================= refunds */
/*
 * The money half of returns.
 *
 * `computeRefund` below is the ONLY place a refund figure is worked out. The
 * admin's approval panel and the customer's return form both call it with the
 * same order row, so the number the shopper is promised and the number the
 * owner pays out are produced by one function and cannot drift apart.
 *
 * It is pure on purpose — no Prisma, no clock, no settings lookup. Everything
 * it needs is passed in, which is what makes the arithmetic testable and what
 * lets the browser recompute the preview live as the reason changes.
 */

/** How the money is sent back. Matches `ReturnRequest.refundMethod`. */
export const REFUND_METHODS = ["original", "upi", "replacement", "none"] as const;

export type RefundMethod = (typeof REFUND_METHODS)[number];

export function isRefundMethod(v: string): v is RefundMethod {
  return (REFUND_METHODS as readonly string[]).includes(v);
}

export const REFUND_METHOD_LABEL: Record<RefundMethod, string> = {
  original: "Back to the original payment",
  upi: "UPI transfer",
  replacement: "Replacement instead of money",
  none: "No money to send",
};

/**
 * Which of the three payment shapes an order took. Derived from the money on
 * the row rather than the `paymentMethod` label, because the label is free
 * text set at checkout and the columns are what actually moved.
 *
 * - `prepaid`  — paid in full online, nothing left for the door.
 * - `cod`      — nothing online, the whole total collected as cash.
 * - `partial`  — an online advance AND a balance for the door.
 * - `unpaid`   — no money was ever due or taken (a Direct request that was
 *                never delivered, or a prepaid order whose payment failed).
 */
export type RefundPaymentCase = "prepaid" | "cod" | "partial" | "unpaid";

export const REFUND_PAYMENT_LABEL: Record<RefundPaymentCase, string> = {
  prepaid: "Prepaid",
  cod: "Cash on delivery",
  partial: "Advance + balance",
  unpaid: "Nothing collected",
};

/** The store's refund rules. Mirrors the SiteSettings columns of the same names. */
export type RefundSettings = {
  /** Percent of the gross the store keeps. Summed with the flat fee. */
  refundFeePercent: number;
  /** Flat amount the store keeps, in whole rupees. Summed with the percent. */
  refundFeeFlat: number;
  /** Partial orders: is the online advance handed back, or kept? */
  partialAdvanceRefundable: boolean;
  /** Damaged / wrong item → charge no fee at all. */
  waiveRefundFeeOnOurFault: boolean;
};

/**
 * How much of the money comes back, as one decision rather than two numbers.
 *
 * There is **no `refundMode` column** and there must not be one: the mode is
 * entirely determined by the two fee fields, so storing it as well would create
 * a second source of truth that can disagree with the arithmetic
 * `computeRefund` actually performs.
 *
 *   `full` — both fees are zero. Every approved return pays the goods value back.
 *   `fee`  — at least one fee is set, so the store keeps a slice.
 *
 * The admin UI is the only thing that needs the distinction, and it needs it
 * badly: "0 and 0" is not a policy an owner recognises as "full refund", which
 * is most of why the refund block read as confusing.
 */
export type RefundMode = "full" | "fee";

export function refundModeOf(
  settings: Pick<RefundSettings, "refundFeePercent" | "refundFeeFlat">
): RefundMode {
  return settings.refundFeePercent > 0 || settings.refundFeeFlat > 0
    ? "fee"
    : "full";
}

/**
 * What picking a mode does to the two columns.
 *
 * Switching to `full` must **zero** the fees rather than merely hide them: a
 * hidden non-zero fee would keep being deducted while the screen claimed full
 * refunds, which is precisely the class of bug the conditional UI exists to
 * remove.
 *
 * Switching to `fee` must **seed** one, which is less obvious but just as
 * necessary. The mode is derived from the fees and deliberately not stored, so
 * returning the settings untouched would leave `refundModeOf` still answering
 * `full` and the control would refuse to move — the fields that let you enter a
 * fee only exist in fee mode, so nothing could ever reach it. The seed is a
 * starting point the owner immediately sees and edits, not a decision made for
 * them, and an existing fee is never overwritten.
 */
export const REFUND_FEE_SEED_PERCENT = 10;

export function applyRefundMode<T extends Pick<RefundSettings, "refundFeePercent" | "refundFeeFlat">>(
  mode: RefundMode,
  settings: T
): T {
  if (mode === "full") {
    return { ...settings, refundFeePercent: 0, refundFeeFlat: 0 };
  }
  return refundModeOf(settings) === "fee"
    ? settings
    : { ...settings, refundFeePercent: REFUND_FEE_SEED_PERCENT };
}

/**
 * Mirrors the `@default(...)` values on SiteSettings — keep the two in step.
 * Used when the settings row can't be read, so a DB blip charges no fee rather
 * than inventing one.
 */
export const DEFAULT_REFUND_SETTINGS: RefundSettings = {
  refundFeePercent: 0,
  refundFeeFlat: 0,
  partialAdvanceRefundable: false,
  waiveRefundFeeOnOurFault: true,
};

/** Just the columns the arithmetic needs, so any caller can build one. */
export type RefundOrder = {
  /** Whole-order value actually charged (subtotal + shipping − discount). */
  total: number;
  /** Collected ONLINE: the full total for prepaid, the advance for partial. */
  amountPaid: number;
  /**
   * Cash the courier was told to collect at the door. Fixed when the order is
   * created and never decremented, so it is a *demand*, not a receipt — see
   * `cashInHand` for when it counts as money the store holds.
   */
  balanceDue: number;
  /** Order lifecycle status. Cash only counts once this reads `delivered`. */
  status?: string | null;
  /** `paid` also settles the cash, for an order the owner squared off by hand. */
  paymentStatus?: string | null;
  /** Line subtotal before shipping and discount — the discount's denominator. */
  subtotal?: number | null;
  /** Order-level coupon discount, shared across the lines pro rata. */
  discountTotal?: number | null;
  /** Net already paid out on earlier returns against this same order. */
  alreadyRefunded?: number | null;
};

/** One returned line, captured by value exactly as `ReturnRequest` stores it. */
export type RefundLine = { unitPrice: number; quantity: number };

export type RefundBreakdown = {
  /** Refundable value of the returned goods, after every cap below. */
  gross: number;
  /** What the store keeps out of the gross. Never more than the gross. */
  fee: number;
  /** What the customer is actually paid. `gross − fee`, never negative. */
  net: number;
  /** Where the money should go. The admin can still override it. */
  method: RefundMethod;
  /** Short, customer-safe sentences explaining every deduction. */
  explanation: string[];

  /* ---- the working, kept so a UI can show its reasoning ---- */
  payment: RefundPaymentCase;
  /** Sticker value of the lines: Σ unitPrice × quantity. */
  lineValue: number;
  /** The lines' pro-rata share of an order-level coupon discount. */
  discountShare: number;
  /** Money the customer actually parted with, across the whole order. */
  collected: number;
  /** Of that, what policy does not give back (a partial order's advance). */
  nonRefundable: number;
  /** The slice of the advance these particular lines forfeit. */
  advanceForfeited: number;
  /** Ceiling on this payout once earlier refunds are subtracted. */
  payable: number;
  /** Earlier net refunds on this order, already committed. */
  alreadyRefunded: number;
  /** The reason was our mistake and the fee was waived. */
  feeWaived: boolean;
  /**
   * What the fee *would* have been, had it not been waived. Zero whenever no
   * fee was configured in the first place.
   *
   * `feeWaived` alone can't be shown to anyone: it is true for a damaged item
   * even on a store that charges nothing, where "the fee is waived" names a fee
   * that never existed. This is the number that makes the waiver worth saying —
   * both to the owner ("this one is full refund because it's our fault") and to
   * the shopper.
   */
  waivedFee: number;
  /** The fee came out bigger than the gross and was clamped to it. */
  feeCapped: boolean;
};

/** Whole rupees, never negative, never NaN. Every input is funnelled through it. */
function rupees(value: number | null | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value as number)) : 0;
}

/**
 * Cash the store is actually holding, as opposed to cash it was owed.
 *
 * `balanceDue` is written once, at checkout, and is never reduced when the
 * courier hands the money over — so reading it as "money we have" would let an
 * undelivered order be refunded out of cash nobody ever collected. It counts
 * only once the parcel was delivered, or the owner marked the order paid.
 */
export function cashInHand(order: RefundOrder): number {
  const due = rupees(order.balanceDue);
  if (due <= 0) return 0;
  const delivered = (order.status ?? "").toLowerCase() === "delivered";
  const settled = (order.paymentStatus ?? "").toLowerCase() === "paid";
  return delivered || settled ? due : 0;
}

/**
 * Which payment shape this order took. Uses `balanceDue` rather than the cash
 * actually in hand, so a part-paid order that hasn't been delivered is still
 * recognised as partial (and its advance still treated as non-refundable).
 */
export function refundPaymentCase(order: RefundOrder): RefundPaymentCase {
  const online = rupees(order.amountPaid);
  const due = rupees(order.balanceDue);
  if (online > 0 && due > 0) return "partial";
  if (online > 0) return "prepaid";
  if (due > 0) return "cod";
  return "unpaid";
}

/**
 * Work out what a return is worth.
 *
 * ## The arithmetic, in order
 *
 * 1. **Line value** — `Σ unitPrice × quantity`, the sticker price of what is
 *    coming back. Shipping is never part of it: the parcel was still carried.
 *
 * 2. **Less its share of an order discount.** A coupon comes off the *order*,
 *    so a ₹1,000 line on an order with ₹200 off a ₹2,000 subtotal only cost
 *    the customer ₹900. Refunding the sticker price there pays back money that
 *    was never collected, which is the whole failure mode this guards against.
 *
 * 3. **What the customer actually parted with** = online money (`amountPaid`)
 *    + cash the courier really collected (`cashInHand`, which is zero until
 *    the parcel is delivered). Capped at the order total, so a data glitch
 *    cannot mint money.
 *
 * 4. **What policy returns of that.** Only a partial order withholds anything:
 *    its online advance, unless `partialAdvanceRefundable` is on. Prepaid and
 *    COD give back everything that was collected.
 *
 * 5. **Scale.** `gross = goods value × (refundable ÷ order total)`.
 *
 *    One line covers all three cases. Prepaid and COD have
 *    `refundable === total`, so the fraction is 1 and the gross is simply the
 *    goods value. A partial order's fraction is the cash share, which spreads
 *    the non-refundable advance across the lines **pro rata**: return one of
 *    three items and a third of the advance is forfeited; return all three and
 *    all of it is. Both routes total the same money, so a customer cannot
 *    recover the advance by returning in instalments, and is not punished for
 *    returning one item either.
 *
 * 6. **Cap** at the goods value and at what is left of the order's refundable
 *    pool after earlier returns, so two requests can never pay out twice.
 *
 * 7. **Fee.** `percent × gross + flat`, waived entirely when the reason is our
 *    mistake and `waiveRefundFeeOnOurFault` is on. Clamped to the gross: the
 *    net is never negative, because a refund that *bills* the customer is a
 *    bug, not a policy.
 */
export function computeRefund(input: {
  order: RefundOrder;
  lines: readonly RefundLine[];
  settings: RefundSettings;
  /** The customer's stated reason, as stored. Drives the our-fault waiver. */
  reason: string;
}): RefundBreakdown {
  const { order, lines, settings, reason } = input;
  const why: string[] = [];

  const total = rupees(order.total);

  /* 1 — sticker value of the returned lines. */
  const lineValue = lines.reduce(
    (sum, l) => sum + rupees(l.unitPrice) * Math.max(0, Math.trunc(l.quantity || 0)),
    0
  );

  /* 2 — less this line's pro-rata share of any order-level discount. */
  const subtotal = rupees(order.subtotal);
  const discountTotal = rupees(order.discountTotal);
  const discountShare =
    discountTotal > 0 && subtotal > 0
      ? Math.min(lineValue, Math.round((lineValue * discountTotal) / subtotal))
      : 0;
  const goodsValue = Math.max(0, lineValue - discountShare);

  /* 3 — money the customer actually parted with, whole order. */
  const online = rupees(order.amountPaid);
  const cash = cashInHand(order);
  const collected = total > 0 ? Math.min(online + cash, total) : 0;

  /* 4 — of that, what the policy hands back. */
  const payment = refundPaymentCase(order);
  const nonRefundable =
    payment === "partial" && !settings.partialAdvanceRefundable
      ? Math.min(online, collected)
      : 0;
  const refundable = Math.max(0, collected - nonRefundable);

  /* 5 — scale the goods value by the refundable fraction of the order. */
  const scaled = total > 0 ? Math.round((goodsValue * refundable) / total) : 0;
  const advanceForfeited = Math.max(0, Math.min(goodsValue, goodsValue - scaled));

  /* 6 — cap at the goods value and at the pool earlier refunds left behind. */
  const alreadyRefunded = rupees(order.alreadyRefunded);
  const payable = Math.max(0, refundable - alreadyRefunded);
  const gross = Math.max(0, Math.min(scaled, goodsValue, payable));
  const cappedByPool = Math.min(scaled, goodsValue) > payable;

  /* 7 — the fee the store keeps. */
  const ourFault = isOurFaultReason(reason);
  const feeWaived = ourFault && settings.waiveRefundFeeOnOurFault;
  const percentFee = Math.round((gross * rupees(settings.refundFeePercent)) / 100);
  const fullFee = percentFee + rupees(settings.refundFeeFlat);
  const rawFee = feeWaived ? 0 : fullFee;
  const fee = Math.min(Math.max(0, rawFee), gross);
  const feeCapped = rawFee > gross;
  const net = Math.max(0, gross - fee);
  // Clamped the same way the real fee is, so "we waived ₹200" can never quote
  // more than the refund it was going to come out of.
  const waivedFee = feeWaived ? Math.min(fullFee, gross) : 0;

  /* ---- the same numbers, in sentences a customer can read ---- */
  if (collected <= 0) {
    why.push(
      "No money has been collected for this order yet, so there is nothing to refund."
    );
  } else {
    if (discountShare > 0) {
      why.push(
        `${formatINR(discountShare)} of your order discount sat on this item, so its refundable value is ${formatINR(goodsValue)}.`
      );
    }
    if (advanceForfeited > 0) {
      why.push(
        `Part-paid order: the ${formatINR(online)} online advance isn't refundable, so ${formatINR(advanceForfeited)} of this item's value is kept.`
      );
    } else if (payment === "partial" && settings.partialAdvanceRefundable) {
      why.push("Your online advance is refundable on this order.");
    }
    if (cappedByPool) {
      why.push(
        `Capped at ${formatINR(payable)} — the rest of this order's refundable amount has already been paid back.`
      );
    }
    if (waivedFee > 0) {
      why.push(
        `This one is on us, so the ${formatINR(waivedFee)} return fee is waived — you get the full amount back.`
      );
    } else if (fee > 0) {
      why.push(`Less a ${formatINR(fee)} return fee.`);
    }
    if (feeCapped) {
      why.push(
        "The return fee comes to more than the refund, so the payout is nil — we never charge you more than the refund itself."
      );
    }
    // Only when money actually moves — "sent back to your card" under a ₹0
    // payout would read as a promise the store isn't making.
    if (net > 0) {
      why.push(
        payment === "prepaid"
          ? "Sent back to the card or UPI you paid with, in 5–7 working days."
          : "Paid out by UPI — we'll ask for your UPI ID once the return is approved."
      );
    }
  }

  return {
    gross,
    fee,
    net,
    method: gross <= 0 ? "none" : payment === "prepaid" ? "original" : "upi",
    explanation: why,
    payment,
    lineValue,
    discountShare,
    collected,
    nonRefundable,
    advanceForfeited,
    payable,
    alreadyRefunded,
    feeWaived,
    waivedFee,
    feeCapped,
  };
}

/**
 * The one line the customer reads before they commit to a return. Deliberately
 * short — the detail sits behind an (i) and "View more".
 */
export function refundPreviewLine(b: RefundBreakdown): string {
  if (b.gross <= 0) {
    return "No refund is payable on this item.";
  }
  if (b.net <= 0) {
    return `You'll receive nothing back — the ${formatINR(b.fee)} return fee covers the whole amount.`;
  }
  // The waiver is named, not just applied. A shopper who has read the policy
  // knows a fee exists; seeing the full amount with no explanation reads as a
  // mistake about to be corrected, which is exactly when they write in.
  if (b.waivedFee > 0) {
    return `You'll receive ${formatINR(b.net)} in full — this one's our fault, so the ${formatINR(b.waivedFee)} return fee is waived`;
  }
  return b.fee > 0
    ? `You'll receive ${formatINR(b.net)} — ${formatINR(b.fee)} return fee applies`
    : `You'll receive ${formatINR(b.net)}`;
}

/* ------------------------------------------------------------------- UPI */

/**
 * A UPI handle (`name@bank`), cleaned up or rejected.
 *
 * Shared by the customer's form and the server action so a value that passes
 * validation in the browser is the same one the endpoint accepts. Only a VPA
 * is ever taken — never a bank account number, which would be a different
 * class of data needing encryption and a retention policy first.
 */
export function normaliseUpiId(input: string): string | null {
  const value = (input ?? "").trim().replace(/\s+/g, "");
  if (value.length < 4 || value.length > 100) return null;
  // Handle, then '@', then the PSP. Letters only after the '@' — every Indian
  // PSP suffix (okaxis, ybl, paytm, upi…) is alphabetic.
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,63}@[a-zA-Z]{2,32}$/.test(value)
    ? value.toLowerCase()
    : null;
}

/** Bounds for the UTR / reference the owner records once the money is sent. */
export const MAX_REFUND_REFERENCE_LENGTH = 64;
