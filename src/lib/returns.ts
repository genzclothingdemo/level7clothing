// Returns — shared status/reason config and the policy resolution rule.
//
// Policy lives in two layers, mirroring the product-info blocks:
//   SiteSettings.defaultReturnable / returnWindowDays / defaultReturnsInfo
//   Product.returnable (null = inherit) / Product.returnsInfo (null = inherit)
// `SiteSettings.returnsEnabled` is a master switch above both — OFF means no
// product is returnable no matter what it says, which is how the owner closes
// returns during a festival rush without editing 22 products.

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

/** What the customer picks as the reason. Free text goes in `customerNote`. */
export const RETURN_REASONS = [
  { value: "damaged", label: "Arrived damaged or broken" },
  { value: "wrong_item", label: "Wrong item or variant sent" },
  { value: "not_as_described", label: "Not as described / photos" },
  { value: "quality", label: "Quality not as expected" },
  { value: "missing_parts", label: "Something was missing" },
  { value: "other", label: "Other reason" },
] as const;

export type ReturnReason = (typeof RETURN_REASONS)[number]["value"];

export function returnReasonLabel(value: string): string {
  return RETURN_REASONS.find((r) => r.value === value)?.label ?? value;
}

export function isReturnReason(v: string): v is ReturnReason {
  return RETURN_REASONS.some((r) => r.value === v);
}

/**
 * Reasons that point at our mistake rather than a change of mind. Used to
 * pre-tick "refund shipping" style decisions and to sort the admin queue —
 * a torn seam matters more than a taste preference.
 */
export const OUR_FAULT_REASONS: ReturnReason[] = [
  "damaged",
  "wrong_item",
  "missing_parts",
];

export type ReturnPolicy = {
  /** Can this product be returned at all right now? */
  returnable: boolean;
  /** Days after delivery a request is still accepted. */
  windowDays: number;
  /** The customer-facing policy copy (already resolved product → store). */
  text: string;
  /** Why it isn't returnable, for the UI to explain rather than just hide. */
  reason: "ok" | "store_disabled" | "product_excluded";
};

/**
 * Resolve the effective return policy for one product. The only place the
 * two-layer rule is implemented — the product page, the order page and the
 * request action all call this so they can never disagree about whether
 * something is returnable.
 */
export function resolveReturnPolicy(
  product: { returnable?: boolean | null; returnsInfo?: string | null },
  settings: {
    returnsEnabled: boolean;
    defaultReturnable: boolean;
    returnWindowDays: number;
    defaultReturnsInfo: string;
  }
): ReturnPolicy {
  const text = (product.returnsInfo ?? settings.defaultReturnsInfo).trim();
  const windowDays = settings.returnWindowDays;

  if (!settings.returnsEnabled) {
    return { returnable: false, windowDays, text, reason: "store_disabled" };
  }
  // Only `null` inherits — an explicit `false` is the admin excluding this piece.
  const returnable = product.returnable ?? settings.defaultReturnable;
  return {
    returnable,
    windowDays,
    text,
    reason: returnable ? "ok" : "product_excluded",
  };
}

/**
 * Is the order still inside its return window? Measured from delivery when we
 * know it, else from when the order was placed — never from "now", which would
 * make every order eligible forever.
 *
 * Returns `daysLeft` so the UI can say "3 days left" instead of just yes/no.
 */
export function returnWindow(
  order: { status: string; deliveryStatusAt?: Date | null; createdAt: Date },
  windowDays: number,
  now: Date
): { open: boolean; daysLeft: number; deliveredAt: Date | null } {
  const deliveredAt =
    order.status === "delivered" ? order.deliveryStatusAt ?? order.createdAt : null;
  if (!deliveredAt) return { open: false, daysLeft: 0, deliveredAt: null };

  const elapsedDays = Math.floor(
    (now.getTime() - deliveredAt.getTime()) / 86_400_000
  );
  const daysLeft = windowDays - elapsedDays;
  return { open: daysLeft > 0, daysLeft: Math.max(0, daysLeft), deliveredAt };
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
