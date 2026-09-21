// Returns — shared status/reason config and the policy resolution rule.
//
// Policy lives in two layers, mirroring the product-info blocks:
//   SiteSettings.defaultReturnable / returnWindowDays / defaultReturnsInfo
//   Product.returnable (null = inherit) / Product.returnsInfo (null = inherit)
// `SiteSettings.returnsEnabled` is a master switch above both — OFF means no
// product is returnable no matter what it says, which is how the owner closes
// returns during a festival rush without editing 22 products.
//
// This module is imported by client components, so it must stay free of
// `prisma` and any server-only import. Everything here is pure.

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
