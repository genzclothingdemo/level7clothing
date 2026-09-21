/**
 * The order pipeline's decisions, in one pure module.
 *
 * Everything here is a plain function over plain data: **no Prisma, no
 * `getSettings()`, no `"use server"`, no React**. That is deliberate and it is
 * the point of the file. Three questions decide whether a customer is charged
 * twice, shipped without a human looking, or left waiting:
 *
 *   1. does this order confirm itself?          → {@link shouldAutoConfirm}
 *   2. how much does the courier collect?       → {@link resolveCollection}
 *   3. which courier carries it?                → {@link pickCourier}
 *
 * Each has exactly one implementation, callable from the checkout action, the
 * payment-verification action, the admin bulk actions and a throwaway script,
 * with no database in the way. The moment one of these answers is inlined at a
 * call site it starts drifting from the others — which is how `pickup done`
 * came to mean two different things (see `lib/nimbus-status.ts`).
 */

/* ------------------------------------------------------------------ */
/*  Settings                                                           */
/* ------------------------------------------------------------------ */

/**
 * How a freshly placed order reaches "confirmed".
 *
 * - `manual`    — nothing confirms itself. Every order waits for a human,
 *                 including one that is already paid in full.
 * - `byPayment` — the three flags below decide, per payment method.
 * - `auto`      — everything confirms itself.
 */
export type OrderConfirmMode = "manual" | "byPayment" | "auto";

/** How the courier is chosen when the shipment is booked without a human. */
export type AutoShipCourier = "cheapest" | "fastest";

/**
 * The pipeline half of `SiteSettings`. Only these columns — the shape is kept
 * narrow so a caller can hand over a literal in a test without inventing forty
 * branding fields.
 */
export type PipelineSettings = {
  orderConfirmMode: OrderConfirmMode;
  autoConfirmPrepaid: boolean;
  autoConfirmPartial: boolean;
  autoConfirmCod: boolean;
  autoShipOnConfirm: boolean;
  autoShipCourier: AutoShipCourier;
};

/**
 * Must stay in step with the `@default(...)` values on `SiteSettings` in
 * `prisma/schema.prisma`. Used when the settings row cannot be read, so a
 * database blip degrades to "a human confirms and nothing books itself"
 * rather than to whatever `undefined` happens to coerce to.
 */
export const PIPELINE_DEFAULTS: PipelineSettings = {
  orderConfirmMode: "manual",
  autoConfirmPrepaid: true,
  autoConfirmPartial: true,
  autoConfirmCod: false,
  autoShipOnConfirm: false,
  autoShipCourier: "cheapest",
};

const CONFIRM_MODES: readonly OrderConfirmMode[] = ["manual", "byPayment", "auto"];
const COURIER_PREFERENCES: readonly AutoShipCourier[] = ["cheapest", "fastest"];

/** Both columns are plain `String`, so every read has to be narrowed. */
export function parseConfirmMode(raw: unknown): OrderConfirmMode {
  return CONFIRM_MODES.includes(raw as OrderConfirmMode)
    ? (raw as OrderConfirmMode)
    : PIPELINE_DEFAULTS.orderConfirmMode;
}

export function parseCourierPreference(raw: unknown): AutoShipCourier {
  return COURIER_PREFERENCES.includes(raw as AutoShipCourier)
    ? (raw as AutoShipCourier)
    : PIPELINE_DEFAULTS.autoShipCourier;
}

/** Narrow a raw settings row (or a partial one) into a usable shape. */
export function normalisePipelineSettings(
  row: Partial<Record<keyof PipelineSettings, unknown>> | null | undefined
): PipelineSettings {
  const bool = (v: unknown, fallback: boolean) =>
    typeof v === "boolean" ? v : fallback;
  return {
    orderConfirmMode: parseConfirmMode(row?.orderConfirmMode),
    autoConfirmPrepaid: bool(row?.autoConfirmPrepaid, PIPELINE_DEFAULTS.autoConfirmPrepaid),
    autoConfirmPartial: bool(row?.autoConfirmPartial, PIPELINE_DEFAULTS.autoConfirmPartial),
    autoConfirmCod: bool(row?.autoConfirmCod, PIPELINE_DEFAULTS.autoConfirmCod),
    autoShipOnConfirm: bool(row?.autoShipOnConfirm, PIPELINE_DEFAULTS.autoShipOnConfirm),
    autoShipCourier: parseCourierPreference(row?.autoShipCourier),
  };
}

/* ------------------------------------------------------------------ */
/*  Payment kind                                                       */
/* ------------------------------------------------------------------ */

/**
 * What kind of money an order is, derived from the stored `paymentMethod`
 * label. `unknown` is not paranoia: the column is a free string written at
 * checkout, and an order placed by an older build (or by a payment method
 * added later) must never fall through into a branch that ships it.
 */
export type PaymentKind = "prepaid" | "partial" | "cod" | "direct" | "unknown";

const METHOD_KIND: Record<string, PaymentKind> = {
  razorpay: "prepaid",
  prepaid: "prepaid",
  partial: "partial",
  cod: "cod",
  direct: "direct",
};

export function paymentKindOf(paymentMethod: string | null | undefined): PaymentKind {
  return METHOD_KIND[String(paymentMethod ?? "").trim().toLowerCase()] ?? "unknown";
}

/** The subset of an order the confirmation decision is allowed to see. */
export type ConfirmableOrder = {
  paymentMethod: string | null | undefined;
  paymentStatus: string | null | undefined;
};

export type ConfirmDecision = {
  confirm: boolean;
  kind: PaymentKind;
  /** Plain English, written into `statusHistory` and shown in the admin. */
  reason: string;
};

/**
 * Should this order confirm itself?
 *
 * The one decision function. Pure, total, and safe to call twice.
 *
 * Two gates are applied **before** the mode, and they hold even in `auto`:
 *
 *  - **A failed payment never confirms.** `auto` means "I trust my orders", not
 *    "ship to anyone whose card was declined". There is no reading of `auto`
 *    under which a bounced payment should reach a courier.
 *  - **A money-backed method needs the money.** Prepaid and partial orders
 *    exist in the database from the instant the Razorpay window opens, i.e.
 *    before anyone has paid. Confirming on creation would confirm every
 *    abandoned checkout — and with auto-ship on, book and pay for a courier
 *    for a parcel nobody bought. They confirm when the payment verifies,
 *    which is a second call to this same function with a real
 *    `paymentStatus`.
 *
 * COD and Direct have nothing to verify up front, so they are governed by the
 * mode alone.
 */
export function shouldAutoConfirm(
  order: ConfirmableOrder,
  settings: PipelineSettings
): ConfirmDecision {
  const kind = paymentKindOf(order.paymentMethod);
  const status = String(order.paymentStatus ?? "").trim().toLowerCase();
  const decide = (confirm: boolean, reason: string): ConfirmDecision => ({
    confirm,
    kind,
    reason,
  });

  if (status === "failed") {
    return decide(false, "Payment failed — a failed payment never auto-confirms.");
  }

  const moneyBacked = kind === "prepaid" || kind === "partial";
  const moneyIn = status === "paid" || status === "partial";
  if (moneyBacked && !moneyIn) {
    return decide(
      false,
      `${labelFor(kind)} order with no payment recorded yet — it confirms when the payment verifies.`
    );
  }

  switch (settings.orderConfirmMode) {
    case "manual":
      return decide(false, "Confirmation is set to manual — every order waits for a human.");

    case "auto":
      return decide(true, "Confirmation is set to automatic — every order confirms itself.");

    case "byPayment": {
      switch (kind) {
        case "prepaid":
          return decide(
            settings.autoConfirmPrepaid,
            settings.autoConfirmPrepaid
              ? "Paid online in full, and prepaid orders are set to confirm themselves."
              : "Prepaid auto-confirm is switched off."
          );
        case "partial":
          return decide(
            settings.autoConfirmPartial,
            settings.autoConfirmPartial
              ? "Advance received, and part-paid orders are set to confirm themselves."
              : "Part-paid auto-confirm is switched off."
          );
        case "cod":
          return decide(
            settings.autoConfirmCod,
            settings.autoConfirmCod
              ? "Cash-on-delivery orders are set to confirm themselves."
              : "Cash-on-delivery auto-confirm is switched off — confirm it once you have spoken to the customer."
          );
        // No flag governs these two, and inventing one silently would be worse
        // than waiting. A customised order is money paid to the owner outside
        // the store, and "unknown" is a method this build does not recognise.
        case "direct":
          return decide(
            false,
            "Customised orders are paid to you directly, so there is nothing for the store to verify — confirm it once the money arrives."
          );
        default:
          return decide(
            false,
            `Unrecognised payment method "${order.paymentMethod ?? ""}" — confirm it by hand.`
          );
      }
    }
  }
}

function labelFor(kind: PaymentKind): string {
  switch (kind) {
    case "prepaid":
      return "Prepaid";
    case "partial":
      return "Part-paid";
    case "cod":
      return "Cash-on-delivery";
    case "direct":
      return "Customised";
    default:
      return "Unrecognised";
  }
}

/* ------------------------------------------------------------------ */
/*  What the courier collects                                          */
/* ------------------------------------------------------------------ */

/** The money facts a shipment needs. All rupees, all integers. */
export type CollectableOrder = {
  paymentMethod: string | null | undefined;
  paymentStatus: string | null | undefined;
  total: number;
  amountPaid: number;
  balanceDue: number;
};

export type Collection = {
  /** What NimbusPost is told. `cod` is the only mode that collects money. */
  paymentType: "prepaid" | "cod";
  /** Rupees the courier hands over at the door. Always 0 when prepaid. */
  collectAmount: number;
  reason: string;
};

/**
 * How much the courier must collect on delivery — the single most expensive
 * thing on this screen to get wrong, in both directions.
 *
 * **Send a prepaid order as COD and the customer pays twice.** They already
 * paid online; the courier turns up asking for the full amount again, takes
 * it, and the store now owes a refund it has to notice before the customer
 * does. **Send a COD order as prepaid** and the courier hands the parcel over
 * for nothing and the sale is simply gone.
 *
 * The rule, in order:
 *
 * 1. **`paymentStatus === "paid"` ⇒ collect nothing.** Money is in, whatever
 *    route it came by. This is what protects a *Direct* (customised) order:
 *    those are paid to the owner outside the store, so `balanceDue` is still
 *    the full total even though nothing is owed. Marking it paid is the
 *    admin's way of saying so, and it must reach the courier.
 * 2. **Otherwise the collectable is `balanceDue`, never `total`.** For a
 *    part-paid order `balanceDue` is *only the remainder* — the advance was
 *    already charged online, so collecting `total` would charge the advance a
 *    second time. This is the exact case the pipeline exists to protect.
 * 3. **Cross-check against `total - amountPaid` and take the smaller.** The
 *    two records of "what is left" are written at different times by
 *    different code paths. When they disagree, under-collecting leaves a debt
 *    the store can chase; over-collecting takes money from a customer at
 *    their door that no automated path gives back. Prefer the recoverable
 *    error.
 * 4. **Zero or less ⇒ prepaid.** No `order_collectable_amount` is sent at all
 *    (see `buildOrderPayload` in `lib/nimbuspost.ts`), so the courier is never
 *    given an amount it could round up from.
 */
export function resolveCollection(order: CollectableOrder): Collection {
  const kind = paymentKindOf(order.paymentMethod);
  const status = String(order.paymentStatus ?? "").trim().toLowerCase();

  const prepaid = (reason: string): Collection => ({
    paymentType: "prepaid",
    collectAmount: 0,
    reason,
  });

  if (status === "paid") {
    return prepaid(
      kind === "direct"
        ? "Customised order marked paid — the money reached you directly, so the courier collects nothing."
        : "Already paid in full — the courier collects nothing."
    );
  }

  const total = Math.max(0, Math.round(Number(order.total) || 0));
  const balanceDue = Math.round(Number(order.balanceDue) || 0);
  const paid = Math.max(0, Math.round(Number(order.amountPaid) || 0));
  const unpaid = total - paid;

  // Rule 3: the lower of the two views of "what is left", clamped into range.
  const collectAmount = Math.min(Math.max(balanceDue, 0), Math.max(unpaid, 0), total);

  if (collectAmount <= 0) {
    return prepaid("Nothing left to collect — shipped prepaid.");
  }

  if (paid > 0) {
    return {
      paymentType: "cod",
      collectAmount,
      // Named explicitly so a human reading the history sees the arithmetic.
      reason: `Part-paid: ₹${paid} was taken online, so the courier collects only the ₹${collectAmount} balance — never the ₹${total} total.`,
    };
  }

  return {
    paymentType: "cod",
    collectAmount,
    reason: `Cash on delivery — the courier collects ₹${collectAmount}.`,
  };
}

/* ------------------------------------------------------------------ */
/*  Courier choice                                                     */
/* ------------------------------------------------------------------ */

/**
 * Structural, so this accepts a `CourierOption` from `lib/nimbuspost.ts` or the
 * client-side copy in `components/admin/order-types.ts` without either having
 * to import the other.
 */
export type CourierQuote = {
  total: number;
  tatDays: number | null;
};

/**
 * Pick the courier an unattended booking should use.
 *
 * `cheapest` is lowest wallet charge, `fastest` is lowest transit time. A
 * courier that quotes no ETA sorts last under `fastest` rather than first —
 * a missing number is not a fast one. Both sort defensively instead of
 * trusting the order `listCourierOptions` happens to return, because "it is
 * already sorted" is a fact that stops being true silently.
 */
export function pickCourier<T extends CourierQuote>(
  options: readonly T[],
  preference: AutoShipCourier
): T | null {
  if (!options.length) return null;

  const eta = (o: T) =>
    typeof o.tatDays === "number" && Number.isFinite(o.tatDays)
      ? o.tatDays
      : Number.POSITIVE_INFINITY;

  const ranked = [...options].sort((a, b) =>
    preference === "fastest"
      ? eta(a) - eta(b) || a.total - b.total
      : a.total - b.total || eta(a) - eta(b)
  );
  return ranked[0];
}

/* ------------------------------------------------------------------ */
/*  Labels                                                             */
/* ------------------------------------------------------------------ */

/** Shared wording, so the settings panel and the toasts say the same thing. */
export const CONFIRM_MODE_LABEL: Record<OrderConfirmMode, string> = {
  manual: "Manual",
  byPayment: "By payment method",
  auto: "Automatic",
};

export const COURIER_PREFERENCE_LABEL: Record<AutoShipCourier, string> = {
  cheapest: "Cheapest",
  fastest: "Fastest",
};

/**
 * True for the one combination that books real shipments, spends real money
 * and shows a human nothing until it is done. The UI has to say so out loud.
 */
export function isFullyUnattended(settings: PipelineSettings): boolean {
  return settings.orderConfirmMode === "auto" && settings.autoShipOnConfirm;
}
