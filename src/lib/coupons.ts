/**
 * coupons — the one place a coupon is judged.
 *
 * There used to be two copies of these rules: one in the validate route and one
 * inline in `placeOrder`. They disagreed, which is the specific way a discount
 * goes wrong — accepted in the cart, silently different (or refused) at
 * checkout. Everything below is the single implementation both now call, and
 * nothing that decides a discount may live anywhere else.
 *
 * ---------------------------------------------------------------------------
 * Decisions worth not re-litigating
 * ---------------------------------------------------------------------------
 *
 * **Money is whole rupees.** Every price, subtotal and discount in this store
 * is an integer. Nothing here produces a fraction.
 *
 * **Rounding is DOWN (`Math.floor`), always.** A percentage discount is
 * truncated to the rupee, so 10% of ₹1,999 is ₹199, not ₹200. Rounding down is
 * the store-favouring direction: the discount can never exceed the percentage
 * that was advertised, and no coupon quietly grows by a rupee. It also matches
 * what the old code did, so no live coupon changes value on this rewrite.
 * A coupon whose discount floors to ₹0 is refused rather than "applied" for
 * nothing.
 *
 * **`minSpend` is measured against the ELIGIBLE subtotal, not the cart total.**
 * The eligible subtotal is the sum of the lines this coupon can actually
 * discount:
 *   - unscoped coupon (`productIds` empty) → every line, so eligible == cart
 *     subtotal and the distinction disappears;
 *   - product-scoped coupon → only the matching lines.
 * So "spend ₹2,000, get ₹300 off hoodies" means ₹2,000 of *hoodies*. The
 * alternative (threshold on the whole cart, discount on a subset) lets a ₹200
 * hoodie carry a ₹300 discount off the back of an unrelated ₹1,800 jacket.
 * Whichever is chosen it must be one rule, and this is it.
 *
 * **Boundaries.** `minSpend` is inclusive (a cart exactly on the threshold
 * qualifies). `startsAt` is inclusive, `expiresAt` is exclusive — the coupon is
 * dead the instant the clock reaches it.
 *
 * **The discount is clamped to the eligible subtotal.** Not to the cart total,
 * which is the looser bound: clamping to the eligible lines means a ₹500 code
 * on a ₹200 eligible line takes ₹200, shipping is never discounted, and
 * `subtotal + shipping - discount` cannot go negative because the discount is
 * capped by a value that is itself ≤ subtotal.
 *
 * **Per-person is matched on `userId` when there is one, otherwise on the
 * lowercased email.** Deliberately not "either/or": the checkout email field is
 * editable, so an OR would let one shopper's redemption block a different
 * account that happened to type the same address.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { comboKey } from "@/lib/options";
import { repairSelection } from "@/lib/variants";
import type { Attribute, SellableVariant } from "@/lib/types";

/* ------------------------------------------------------------------ */
/*  Shapes                                                             */
/* ------------------------------------------------------------------ */

/** One priced cart line. `price` is the unit price in whole rupees. */
export type CouponLine = {
  productId: string;
  price: number;
  quantity: number;
};

/**
 * The coupon fields the rules read. Structural rather than `Coupon` from
 * Prisma so the pure evaluator can be exercised with plain objects in a script
 * without a database.
 */
export type CouponRule = {
  id: string;
  code: string;
  discountAmount: number;
  isPercentage: boolean;
  isActive: boolean;
  productIds: string[];
  usageLimit: number | null;
  usedCount: number;
  minSpend: number | null;
  maxDiscount: number | null;
  perUserLimit: number | null;
  startsAt: Date | null;
  expiresAt: Date | null;
};

/** Why a coupon was refused. The message is what the shopper reads. */
export type CouponRefusal =
  | "not_found"
  | "inactive"
  | "not_started"
  | "expired"
  | "usage_limit"
  | "per_user_limit"
  | "empty_cart"
  | "no_eligible_items"
  | "min_spend"
  | "no_discount";

export type CouponOk = {
  ok: true;
  couponId: string;
  code: string;
  /** Whole rupees to subtract from the order. Always ≥ 1. */
  discount: number;
  /** Subtotal of the lines this coupon applied to. */
  eligibleSubtotal: number;
  /** False when the coupon is pinned to specific products. */
  wholeCart: boolean;
  /**
   * Carried through so `redeemCoupon` doesn't have to re-read the row inside
   * the order transaction. Every query in there is a round trip to Mumbai from
   * a function in Washington (see CLAUDE.md), and the transaction has a
   * five-second budget it shares with the order insert and one update per line.
   */
  usageLimit: number | null;
  perUserLimit: number | null;
};

export type CouponRefused = {
  ok: false;
  reason: CouponRefusal;
  /** Shopper-facing. Says what is wrong and, where useful, what would fix it. */
  message: string;
};

export type CouponResult = CouponOk | CouponRefused;

function refuse(reason: CouponRefusal, message: string): CouponRefused {
  return { ok: false, reason, message };
}

/** Rupees for a shopper-facing message — Indian grouping, no decimals. */
function rupees(n: number): string {
  return `₹${n.toLocaleString("en-IN")}`;
}

/* ------------------------------------------------------------------ */
/*  Time zone                                                          */
/* ------------------------------------------------------------------ */

/**
 * The store runs on IST, which has no DST and so is a fixed +05:30 — meaning a
 * wall-clock string can be converted both ways exactly, with no library.
 *
 * This matters because the admin types a window into a `datetime-local` input
 * and Vercel's functions run in UTC. Formatting and parsing both go through
 * here, so "expires 31 Oct, 23:59" means the same instant on the admin's
 * laptop, on the server, and in the database.
 */
const IST_OFFSET_MINUTES = 5 * 60 + 30;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** A `Date` → the `YYYY-MM-DDTHH:mm` a `datetime-local` input wants, in IST. */
export function toStoreDateTimeInput(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const shifted = new Date(d.getTime() + IST_OFFSET_MINUTES * 60_000);
  return (
    `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}` +
    `T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`
  );
}

/** The inverse: a `datetime-local` string read as IST. Blank/invalid → null. */
export function fromStoreDateTimeInput(value: string | null | undefined): Date | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Seconds are optional in what the browser emits; append them when missing so
  // the offset suffix lands on a well-formed ISO string.
  const withSeconds = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)
    ? `${trimmed}:00`
    : trimmed;
  const d = new Date(`${withSeconds}+05:30`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/* ------------------------------------------------------------------ */
/*  Status (admin list + filters)                                      */
/* ------------------------------------------------------------------ */

export type CouponStatus = "active" | "hidden" | "scheduled" | "expired" | "exhausted";

/**
 * The one word that answers "can someone use this right now, and if not why".
 * Ordered by which fact the admin needs first: a coupon they switched off is
 * "Hidden" even if it also expired, because that is the thing they changed.
 */
export function couponStatus(
  c: Pick<CouponRule, "isActive" | "startsAt" | "expiresAt" | "usageLimit" | "usedCount">,
  now: Date = new Date()
): CouponStatus {
  if (!c.isActive) return "hidden";
  if (c.expiresAt && now.getTime() >= c.expiresAt.getTime()) return "expired";
  if (c.usageLimit !== null && c.usedCount >= c.usageLimit) return "exhausted";
  if (c.startsAt && now.getTime() < c.startsAt.getTime()) return "scheduled";
  return "active";
}

/* ------------------------------------------------------------------ */
/*  The evaluator                                                      */
/* ------------------------------------------------------------------ */

/**
 * Pure. Given a coupon, a priced cart and how many times this person has
 * already redeemed it, decide. No database, no clock of its own — `now` is a
 * parameter so an expiry can be tested without waiting for one.
 */
export function evaluateCoupon(input: {
  coupon: CouponRule;
  lines: CouponLine[];
  /** Redemptions already recorded for this person. Pass 0 when unknown. */
  priorUserUses?: number;
  now?: Date;
}): CouponResult {
  const { coupon } = input;
  const now = input.now ?? new Date();
  const priorUserUses = input.priorUserUses ?? 0;

  // Defensive: a negative quantity or price would invert the arithmetic below.
  const lines = input.lines.filter(
    (l) => l.quantity > 0 && l.price >= 0 && Number.isFinite(l.price * l.quantity)
  );

  if (!lines.length) {
    return refuse("empty_cart", "Your cart is empty.");
  }

  if (!coupon.isActive) {
    return refuse("inactive", "This code is no longer available.");
  }

  if (coupon.startsAt && now.getTime() < coupon.startsAt.getTime()) {
    return refuse("not_started", "This code isn't active yet.");
  }

  if (coupon.expiresAt && now.getTime() >= coupon.expiresAt.getTime()) {
    return refuse("expired", "This code has expired.");
  }

  if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
    return refuse("usage_limit", "This code has been fully claimed.");
  }

  if (coupon.perUserLimit !== null && priorUserUses >= coupon.perUserLimit) {
    return refuse(
      "per_user_limit",
      coupon.perUserLimit === 1
        ? "You've already used this code."
        : `You've already used this code ${coupon.perUserLimit} times.`
    );
  }

  // ---- Scope: which lines can this coupon touch? ----
  const wholeCart = coupon.productIds.length === 0;
  const eligible = wholeCart
    ? lines
    : lines.filter((l) => coupon.productIds.includes(l.productId));

  // Covers the "cart edited after the code was applied" case: once the last
  // matching line goes, there is nothing to discount and the code drops off.
  if (!eligible.length) {
    return refuse(
      "no_eligible_items",
      "This code doesn't apply to anything in your cart."
    );
  }

  const eligibleSubtotal = eligible.reduce((n, l) => n + l.price * l.quantity, 0);

  // ---- Minimum spend, measured on the eligible lines (see header note). ----
  if (coupon.minSpend !== null && eligibleSubtotal < coupon.minSpend) {
    const short = coupon.minSpend - eligibleSubtotal;
    return refuse(
      "min_spend",
      wholeCart
        ? `Spend ${rupees(short)} more to use this code (minimum ${rupees(coupon.minSpend)}).`
        : `Add ${rupees(short)} more of the eligible items to use this code (minimum ${rupees(
            coupon.minSpend
          )}).`
    );
  }

  // ---- The amount. Floor, then cap, then clamp. ----
  let discount: number;
  if (coupon.isPercentage) {
    // A percentage over 100 is nonsense the editor rejects, but the clamp
    // below is what actually makes it harmless if one is already in the table.
    const pct = Math.max(0, coupon.discountAmount);
    discount = Math.floor((eligibleSubtotal * pct) / 100);
    if (coupon.maxDiscount !== null) {
      discount = Math.min(discount, Math.max(0, coupon.maxDiscount));
    }
  } else {
    // `maxDiscount` is deliberately ignored for flat coupons — the flat amount
    // IS the cap. Keeping the stored value untouched means flipping a coupon to
    // percentage and back doesn't lose it.
    discount = Math.max(0, Math.floor(coupon.discountAmount));
  }

  // The clamp that makes a negative total impossible.
  discount = Math.min(discount, eligibleSubtotal);

  if (discount <= 0) {
    return refuse("no_discount", "This code doesn't take anything off your cart.");
  }

  return {
    ok: true,
    couponId: coupon.id,
    code: coupon.code,
    discount,
    eligibleSubtotal,
    wholeCart,
    usageLimit: coupon.usageLimit,
    perUserLimit: coupon.perUserLimit,
  };
}

/* ------------------------------------------------------------------ */
/*  Pricing a cart the same way checkout does                          */
/* ------------------------------------------------------------------ */

/** What the browser sends us. Prices are NOT taken from here. */
export type IncomingCartItem = {
  productId?: unknown;
  quantity?: unknown;
  options?: unknown;
};

/**
 * Turn a client-supplied cart into priced lines, reading every price from the
 * database. The browser's own `price` is ignored on purpose — otherwise the
 * quoted discount could be inflated by editing the request, and the cart would
 * quote a number checkout then disagrees with.
 *
 * Mirrors the variant lookup `placeOrder` does (`repairSelection` → `comboKey`
 * → `sellableVariants`), minus the stock and required-option checks: this is
 * only ever used to *quote* a discount, and checkout re-runs the full thing.
 */
export async function priceCartLines(items: IncomingCartItem[]): Promise<CouponLine[]> {
  const ids = Array.from(
    new Set(
      items
        .map((i) => (typeof i.productId === "string" ? i.productId : null))
        .filter((id): id is string => !!id)
    )
  );
  if (!ids.length) return [];

  const products = await prisma.product.findMany({
    where: { id: { in: ids }, isActive: true },
    select: {
      id: true,
      price: true,
      attributes: true,
      sellableVariants: true,
    },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  const lines: CouponLine[] = [];
  for (const item of items) {
    if (typeof item.productId !== "string") continue;
    const product = byId.get(item.productId);
    if (!product) continue;

    const quantity = Math.floor(Number(item.quantity));
    if (!Number.isFinite(quantity) || quantity <= 0) continue;

    const rawOptions = Array.isArray(item.options) ? item.options : [];
    const rawSelection: Record<string, string> = {};
    for (const o of rawOptions) {
      if (o && typeof o === "object") {
        const { name, value } = o as { name?: unknown; value?: unknown };
        if (typeof name === "string" && typeof value === "string") rawSelection[name] = value;
      }
    }

    const attributes = ((product.attributes as unknown) as Attribute[]) || [];
    const variants = ((product.sellableVariants as unknown) as SellableVariant[]) || [];
    const selection = repairSelection(attributes, rawSelection);
    const match = variants.find((v) => v.id === comboKey(selection));

    lines.push({
      productId: product.id,
      price: match?.price ?? product.price,
      quantity,
    });
  }

  return lines;
}

/* ------------------------------------------------------------------ */
/*  The database-backed entry point                                    */
/* ------------------------------------------------------------------ */

/** Normalised so `summer20`, ` SUMMER20 ` and `SUMMER20` are one code. */
export function normaliseCode(code: string): string {
  return code.trim().toUpperCase();
}

function normaliseEmail(email: string | null | undefined): string | null {
  const e = email?.trim().toLowerCase();
  return e || null;
}

/**
 * Look the code up, count this person's prior uses, and evaluate. This is what
 * the validate route calls when the shopper types a code, and what
 * `placeOrder` calls again before it charges anything — same function, same
 * answer, so the two cannot drift.
 */
export async function validateCoupon(input: {
  code: string;
  lines: CouponLine[];
  userId?: string | null;
  email?: string | null;
  now?: Date;
}): Promise<CouponResult> {
  const code = normaliseCode(input.code ?? "");
  if (!code) return refuse("not_found", "Enter a discount code.");

  const coupon = await prisma.coupon.findUnique({ where: { code } });
  if (!coupon) return refuse("not_found", "That code isn't recognised.");

  // Only pay for the redemption count when the coupon actually limits per
  // person — most don't, and this runs on every keystroke-driven apply.
  let priorUserUses = 0;
  if (coupon.perUserLimit !== null) {
    priorUserUses = await countUserRedemptions(prisma, {
      couponId: coupon.id,
      userId: input.userId ?? null,
      email: input.email ?? null,
    });
  }

  return evaluateCoupon({ coupon, lines: input.lines, priorUserUses, now: input.now });
}

/**
 * Prior uses by this person. `userId` wins when present; the email is only a
 * fallback for a shopper who hasn't logged in yet (see the header note on why
 * this is not an OR).
 */
async function countUserRedemptions(
  db: Prisma.TransactionClient | typeof prisma,
  where: { couponId: string; userId: string | null; email: string | null }
): Promise<number> {
  const email = normaliseEmail(where.email);
  if (!where.userId && !email) return 0;
  return db.couponRedemption.count({
    where: where.userId
      ? { couponId: where.couponId, userId: where.userId }
      : { couponId: where.couponId, email },
  });
}

/* ------------------------------------------------------------------ */
/*  Redeeming                                                          */
/* ------------------------------------------------------------------ */

const CLAIM_ERROR = "CouponClaimError" as const;

/** Thrown inside the order transaction, so a failed claim rolls the order back. */
export class CouponClaimError extends Error {
  readonly name = CLAIM_ERROR;
  readonly reason: CouponRefusal;
  constructor(reason: CouponRefusal, message: string) {
    super(message);
    this.reason = reason;
  }
}

/**
 * Duck-typed rather than `instanceof`, which is the check that survives a
 * module being evaluated twice in a bundled server runtime.
 */
export function isCouponClaimError(err: unknown): err is CouponClaimError {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: unknown }).name === CLAIM_ERROR
  );
}

/**
 * Take one use of a coupon, inside the caller's transaction.
 *
 * The limit is enforced by the UPDATE itself — `usedCount < usageLimit` lives
 * in the WHERE clause, so Postgres evaluates it while holding the row lock and
 * two checkouts racing for the last use cannot both win: the loser matches zero
 * rows and throws, which rolls its whole order back. A read-then-write would
 * let both read 99 and both write 100.
 *
 * The same UPDATE re-checks `isActive` and the date window, so a coupon
 * switched off or expired between "Apply" and "Place order" is caught here even
 * though it passed validation minutes earlier.
 *
 * Claiming before counting also matters: the UPDATE holds the coupon row for
 * the rest of the transaction, so concurrent redemptions of the same coupon
 * serialise behind it and the per-person count below cannot be undercut by a
 * redemption inserted underneath us.
 */
export async function redeemCoupon(
  tx: Prisma.TransactionClient,
  input: {
    couponId: string;
    /** Discount actually applied, whole rupees. Recorded for reporting. */
    amount: number;
    /** Both limits come straight off the `validateCoupon` verdict. */
    usageLimit: number | null;
    perUserLimit: number | null;
    orderId?: string | null;
    userId?: string | null;
    email?: string | null;
    now?: Date;
  }
): Promise<void> {
  const now = input.now ?? new Date();

  const claimed = await tx.coupon.updateMany({
    where: {
      id: input.couponId,
      isActive: true,
      // The ceiling goes in the WHERE, not in an `if` above it. Postgres
      // re-evaluates this predicate against the live row while holding the
      // lock, so the second of two racing checkouts sees the incremented count
      // and matches nothing.
      ...(input.usageLimit !== null ? { usedCount: { lt: input.usageLimit } } : {}),
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      ],
    },
    data: { usedCount: { increment: 1 } },
  });

  // Also covers a coupon deleted between validation and checkout: no row
  // matches, so nothing is claimed and the order rolls back.
  if (claimed.count === 0) {
    throw new CouponClaimError(
      "usage_limit",
      "That discount code was just used up or has expired. Remove it and try again."
    );
  }

  if (input.perUserLimit !== null) {
    const used = await countUserRedemptions(tx, {
      couponId: input.couponId,
      userId: input.userId ?? null,
      email: input.email ?? null,
    });
    if (used >= input.perUserLimit) {
      throw new CouponClaimError(
        "per_user_limit",
        "You've already used that discount code. Remove it and try again."
      );
    }
  }

  await tx.couponRedemption.create({
    data: {
      couponId: input.couponId,
      orderId: input.orderId ?? null,
      userId: input.userId ?? null,
      email: normaliseEmail(input.email),
      amount: Math.max(0, Math.floor(input.amount)),
    },
  });
}
