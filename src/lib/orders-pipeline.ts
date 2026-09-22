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

/**
 * **Q1 — how far a *confirmed* order goes on its own.**
 *
 * The owner described four ways an order reaches the courier. They are not
 * four modes, they are two questions, and this is the first:
 *
 * - `off`   — nothing happens. The order is confirmed and that is all; the
 *             admin dispatches it by hand from the orders screen.
 * - `draft` — a free, unbooked draft is staged in NimbusPost. No courier, no
 *             AWB, no wallet charge, and it can be deleted there. **The
 *             default**, and the review gate CLAUDE.md records as deliberate.
 * - `book`  — the draft is staged *and* booked: courier allocated, AWB
 *             generated, **wallet charged**, with nobody looking.
 *
 * This replaces the boolean `autoShipOnConfirm`, which could only say
 * draft (false) or book (true) and had no way to express "do nothing" — so an
 * owner who wanted the courier left alone until they pressed a button had to
 * switch NimbusPost off store-wide to get it.
 */
export type DispatchOnConfirm = "off" | "draft" | "book";

/** How the courier is chosen when the shipment is booked without a human. */
export type AutoShipCourier = "cheapest" | "fastest";

/**
 * **Q2 — which courier an unattended booking uses**, and only meaningful when
 * Q1 is `book`.
 *
 * Either of the two strategies, or a **pinned courier** — the name (or id) of
 * one courier, stored verbatim in the same column. A store that has negotiated
 * a rate with one carrier does not want "cheapest"; it wants that carrier.
 *
 * `(string & {})` rather than a bare `string` so editors still offer the two
 * strategy literals while any courier name remains assignable.
 */
export type CourierChoice = AutoShipCourier | (string & {});

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
  /**
   * Q1. **Optional only for the migration**, never absent in practice:
   * everything {@link normalisePipelineSettings} returns carries it, and every
   * reader goes through {@link dispatchModeOf} rather than touching it, so a
   * row written before the column existed still resolves.
   *
   * It is optional because the settings screens still construct a
   * `PipelineSettings` literal from their own legacy draft shape. Make it
   * required once they carry the enum.
   */
  dispatchOnConfirm?: DispatchOnConfirm;
  /**
   * @deprecated The legacy boolean this enum replaced. Still written, in step,
   * by the one writer (`updateOrderPipelineSettings`), so a screen that has not
   * migrated yet keeps reading a truthful value. **Never branch on it** — call
   * {@link dispatchModeOf}, which prefers the enum and falls back to this.
   */
  autoShipOnConfirm: boolean;
  autoShipCourier: CourierChoice;
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
  dispatchOnConfirm: "draft",
  autoShipOnConfirm: false,
  autoShipCourier: "cheapest",
};

const CONFIRM_MODES: readonly OrderConfirmMode[] = ["manual", "byPayment", "auto"];
const DISPATCH_MODES: readonly DispatchOnConfirm[] = ["off", "draft", "book"];
const COURIER_PREFERENCES: readonly AutoShipCourier[] = ["cheapest", "fastest"];

/** Both columns are plain `String`, so every read has to be narrowed. */
export function parseConfirmMode(raw: unknown): OrderConfirmMode {
  return CONFIRM_MODES.includes(raw as OrderConfirmMode)
    ? (raw as OrderConfirmMode)
    : PIPELINE_DEFAULTS.orderConfirmMode;
}

/** `null` ⇒ the column predates the enum; the caller falls back to the boolean. */
export function parseDispatchMode(raw: unknown): DispatchOnConfirm | null {
  return DISPATCH_MODES.includes(raw as DispatchOnConfirm)
    ? (raw as DispatchOnConfirm)
    : null;
}

/**
 * Q2 as stored: one of the two strategies, or a pinned courier's name.
 * Anything empty falls back to `cheapest`.
 */
export function parseCourierPreference(raw: unknown): CourierChoice {
  const value = typeof raw === "string" ? raw.trim() : "";
  return value || PIPELINE_DEFAULTS.autoShipCourier;
}

/** True for the two strategies, false for a pinned courier name. */
export function isCourierStrategy(v: CourierChoice): v is AutoShipCourier {
  return COURIER_PREFERENCES.includes(v as AutoShipCourier);
}

/**
 * **The one reading of Q1**, and the only place the old boolean is allowed to
 * matter.
 *
 * The enum column wins when it holds a value it recognises. Otherwise the row
 * predates the migration and the boolean decides — `true` meant "book it",
 * `false` meant "stage a draft and stop" — so an untouched row goes on
 * behaving exactly as it did, and a row someone set to auto-book does not
 * quietly stop booking.
 *
 * Deliberately structural (not `PipelineSettings`), so a raw Prisma row can be
 * handed straight to it.
 */
export function dispatchModeOf(settings: {
  dispatchOnConfirm?: unknown;
  autoShipOnConfirm?: unknown;
}): DispatchOnConfirm {
  const explicit = parseDispatchMode(settings.dispatchOnConfirm);
  if (explicit) return explicit;
  return settings.autoShipOnConfirm === true ? "book" : "draft";
}

/** Narrow a raw settings row (or a partial one) into a usable shape. */
export function normalisePipelineSettings(
  row:
    | (Partial<Record<keyof PipelineSettings, unknown>> & {
        dispatchOnConfirm?: unknown;
      })
    | null
    | undefined
): PipelineSettings {
  const bool = (v: unknown, fallback: boolean) =>
    typeof v === "boolean" ? v : fallback;
  const dispatchOnConfirm = dispatchModeOf({
    dispatchOnConfirm: row?.dispatchOnConfirm,
    autoShipOnConfirm: row?.autoShipOnConfirm,
  });
  return {
    orderConfirmMode: parseConfirmMode(row?.orderConfirmMode),
    autoConfirmPrepaid: bool(row?.autoConfirmPrepaid, PIPELINE_DEFAULTS.autoConfirmPrepaid),
    autoConfirmPartial: bool(row?.autoConfirmPartial, PIPELINE_DEFAULTS.autoConfirmPartial),
    autoConfirmCod: bool(row?.autoConfirmCod, PIPELINE_DEFAULTS.autoConfirmCod),
    dispatchOnConfirm,
    // Derived, never independent: whatever the enum says is what the legacy
    // flag reports. One writer, two columns, no chance of them disagreeing.
    autoShipOnConfirm: dispatchOnConfirm === "book",
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
/*  May anything be sent to the courier?                               */
/* ------------------------------------------------------------------ */

/** The only order facts that decide whether the courier may be touched. */
export type ShippableOrder = {
  status: string | null | undefined;
  /** The AWB. Present ⇒ this parcel is already booked, by us or by hand. */
  trackingNumber?: string | null;
  /** The NimbusPost order id ⇒ an unbooked draft is waiting there. */
  nimbusShipmentId?: string | null;
};

/** Where this order has got to with NimbusPost. */
export type ShipmentStage = "none" | "draft" | "booked";

/**
 * Exactly which shipment controls this order may show — and, because the
 * server actions read the same object, exactly which ones will be honoured.
 */
export type ShipmentControls = {
  /** Pick a courier off live rates and book it (stages the draft if needed). */
  shipNow: boolean;
  /** Stage the free, unbooked draft and stop. */
  draft: boolean;
  /** Book the draft that is already staged. Charges the wallet. */
  book: boolean;
  /** Ask NimbusPost what it knows — did someone book it in the dashboard? */
  sync: boolean;
  /** Withdraw a staged draft so it stops sitting in NimbusPost. */
  cancelDraft: boolean;
  /** Show courier / AWB / link / last scan, read-only. */
  tracking: boolean;
};

const NO_CONTROLS: ShipmentControls = {
  shipNow: false,
  draft: false,
  book: false,
  sync: false,
  cancelDraft: false,
  tracking: false,
};

export type ShipmentGate = {
  /** May something NEW be sent to the courier? What the actions enforce. */
  allowed: boolean;
  /** Which rule decided — the UI branches on this, never on the prose. */
  code: "ready" | "staged" | "pending" | "closed" | "booked" | "done";
  stage: ShipmentStage;
  /** The one list of controls the panel may draw. */
  can: ShipmentControls;
  /**
   * One line, in plain English. Shown verbatim wherever there is nothing to
   * press, and returned verbatim by the server actions when they refuse.
   */
  reason: string;
};

/** Statuses at which a parcel's journey is over and nothing new can ship. */
const CLOSED_STATUSES = new Set(["cancelled", "payment_failed"]);
const FINISHED_STATUSES = new Set(["delivered", "returned", "rto"]);

/**
 * The one answer to "what may this order do with the courier right now?".
 *
 * Pure, so the server action that enforces it and the panel that decides what
 * to render cannot disagree — the whole class of bug where a button is shown
 * and then refused (or worse, shown and *not* refused) comes from those two
 * being written twice. The panel reads `can`; the actions read `allowed`.
 *
 * The table it implements, which is the owner's, in order of precedence:
 *
 * | status                | shipment      | controls                          |
 * |-----------------------|---------------|-----------------------------------|
 * | any                   | **AWB**       | tracking + Sync. Nothing bookable. |
 * | pending               | any           | none — confirm the order first     |
 * | cancelled / failed    | any           | none (a staged draft may be withdrawn) |
 * | delivered / returned  | none          | none — nothing left to ship        |
 * | delivered / returned  | draft         | none (the stale draft may be withdrawn) |
 * | confirmed / shipped   | none          | **Ship now** · **Send draft**      |
 * | confirmed / shipped   | draft         | **Book AWB** · Sync · cancel draft |
 *
 * **`booked` is tested first**, and deliberately: a parcel that has already
 * gone out must show its tracking whatever the order's status has since become
 * — an order cancelled after dispatch still has a real parcel in a real van.
 * `trackingNumber` is the test rather than `nimbusShipmentId`, because a parcel
 * handed to a courier by hand is just as booked as one this app booked; only
 * the AWB proves a shipment exists.
 *
 * **`pending` blocks everything.** An unconfirmed order is a request, not work.
 * Staging a draft for one puts an order into NimbusPost that nobody has
 * accepted, and booking it spends the wallet on a parcel that may be cancelled
 * in the next minute.
 *
 * **A finished or cancelled order offers no shipping** — but a draft left
 * behind on one is still a live liability sitting in NimbusPost that a human
 * could book by mistake, so withdrawing it stays available. That is a cleanup,
 * not a dispatch: it cannot put anything on a courier.
 */
export function shipmentGateFor(order: ShippableOrder): ShipmentGate {
  const status = String(order.status ?? "").trim().toLowerCase();
  const awb = order.trackingNumber?.trim();
  const draftId = order.nimbusShipmentId?.trim();
  const stage: ShipmentStage = awb ? "booked" : draftId ? "draft" : "none";

  if (awb) {
    return {
      allowed: false,
      code: "booked",
      stage,
      can: {
        ...NO_CONTROLS,
        tracking: true,
        // Only a parcel this app staged can be looked up in NimbusPost; a
        // hand-typed AWB from another courier has nothing there to ask.
        sync: Boolean(draftId),
      },
      reason: `This order already has an AWB (${awb}). Booking it again would create a second shipment and charge your wallet twice.`,
    };
  }

  if (status === "pending") {
    return {
      allowed: false,
      code: "pending",
      stage,
      can: { ...NO_CONTROLS, cancelDraft: stage === "draft" },
      reason:
        "This order is still pending. Confirm it first — nothing is sent to the courier until an order has been accepted.",
    };
  }

  if (CLOSED_STATUSES.has(status)) {
    return {
      allowed: false,
      code: "closed",
      stage,
      can: { ...NO_CONTROLS, cancelDraft: stage === "draft" },
      reason:
        status === "cancelled"
          ? "This order was cancelled and its stock returned, so there is nothing to ship."
          : "The payment on this order failed, so it is not being packed.",
    };
  }

  if (FINISHED_STATUSES.has(status)) {
    return {
      allowed: false,
      code: "done",
      stage,
      can: { ...NO_CONTROLS, cancelDraft: stage === "draft" },
      reason:
        stage === "draft"
          ? `This order is already ${status} — there is nothing left to ship, but an unbooked draft is still sitting in NimbusPost.`
          : `This order is already ${status}, so there is nothing left to ship.`,
    };
  }

  if (stage === "draft") {
    return {
      allowed: true,
      code: "staged",
      stage,
      can: {
        ...NO_CONTROLS,
        book: true,
        sync: true,
        cancelDraft: true,
      },
      reason:
        "An unbooked draft is waiting in NimbusPost. Nothing has been charged yet.",
    };
  }

  return {
    allowed: true,
    code: "ready",
    stage,
    can: { ...NO_CONTROLS, shipNow: true, draft: true },
    reason: "Nothing has been sent to NimbusPost for this order yet.",
  };
}

/* ------------------------------------------------------------------ */
/*  Bulk eligibility                                                   */
/* ------------------------------------------------------------------ */

/**
 * The bulk verbs. Declared here, in the pure module, so the bar that offers
 * them and the action that runs them agree on both the list and the rules —
 * `components/admin/order-types.ts` re-exports the list for the UI.
 */
export type BulkVerb = "confirm" | "cancel" | "draft" | "book" | "sync";

export type BulkCandidate = ShippableOrder & {
  paymentStatus?: string | null;
};

export type BulkEligibility = {
  ok: boolean;
  /** Why not, in the shape "3 are already confirmed" reads from. */
  reason: string;
};

/**
 * May this verb run on this row?
 *
 * A bulk bar that offers an action the rows cannot take is a bulk bar that
 * reports failures the operator could have been shown beforehand — so the bar
 * counts eligible rows with this, names what it will skip, and the action
 * refuses the same rows for the same reasons.
 *
 * `confirm` and `cancel` mirror `confirmOneOrder` / `cancelOneOrder` in
 * `app/actions/admin.ts`; the three shipment verbs come straight off
 * {@link shipmentGateFor}, so the bulk path can never be a way around the gate.
 */
export function bulkEligibilityFor(
  verb: BulkVerb,
  order: BulkCandidate
): BulkEligibility {
  const status = String(order.status ?? "").trim().toLowerCase();
  const paymentStatus = String(order.paymentStatus ?? "").trim().toLowerCase();
  const gate = shipmentGateFor(order);

  switch (verb) {
    case "confirm":
      return status === "pending"
        ? { ok: true, reason: "" }
        : { ok: false, reason: `already ${status.replace(/_/g, " ")}` };

    case "cancel":
      if (status === "cancelled") return { ok: false, reason: "already cancelled" };
      if (paymentStatus === "paid") {
        return { ok: false, reason: "paid in full — change the status by hand" };
      }
      return { ok: true, reason: "" };

    case "draft":
      if (gate.can.draft) return { ok: true, reason: "" };
      return {
        ok: false,
        reason:
          gate.stage === "draft"
            ? "already staged"
            : gate.stage === "booked"
              ? "already booked"
              : gate.code === "pending"
                ? "not confirmed yet"
                : "nothing left to ship",
      };

    case "book":
      if (gate.can.book) return { ok: true, reason: "" };
      return {
        ok: false,
        reason:
          gate.stage === "booked"
            ? "already booked"
            : gate.stage === "none" && gate.allowed
              ? "no draft staged"
              : gate.code === "pending"
                ? "not confirmed yet"
                : "nothing left to ship",
      };

    case "sync":
      if (gate.can.sync) return { ok: true, reason: "" };
      return {
        ok: false,
        reason:
          gate.stage === "none"
            ? "nothing staged in NimbusPost"
            : "no NimbusPost record to sync against",
      };
  }
}

/** `{ eligible, skipped }` for a whole selection, for the bulk bar's readout. */
export function summariseBulk<T extends BulkCandidate>(
  verb: BulkVerb,
  orders: readonly T[]
): { eligible: T[]; skipped: { order: T; reason: string }[] } {
  const eligible: T[] = [];
  const skipped: { order: T; reason: string }[] = [];
  for (const order of orders) {
    const check = bulkEligibilityFor(verb, order);
    if (check.ok) eligible.push(order);
    else skipped.push({ order, reason: check.reason });
  }
  return { eligible, skipped };
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
  /** Present on the real option types; absent in a bare test fixture. */
  courierId?: string;
  name?: string;
};

/**
 * Pick the courier an unattended booking should use.
 *
 * `cheapest` is lowest wallet charge, `fastest` is lowest transit time. A
 * courier that quotes no ETA sorts last under `fastest` rather than first —
 * a missing number is not a fast one. Both sort defensively instead of
 * trusting the order `listCourierOptions` happens to return, because "it is
 * already sorted" is a fact that stops being true silently.
 *
 * Anything else is a **pinned courier**: matched on id first, then on name,
 * case-insensitively. A pin that is not quoting for this parcel and pincode
 * falls back to cheapest rather than leaving the parcel unshipped — the
 * caller compares what came back with what was pinned and says so (see
 * `runConfirmationPipeline`), because silently shipping with someone else is
 * the kind of thing that shows up on an invoice a month later.
 */
export function pickCourier<T extends CourierQuote>(
  options: readonly T[],
  preference: CourierChoice
): T | null {
  if (!options.length) return null;

  if (!isCourierStrategy(preference)) {
    const wanted = preference.trim().toLowerCase();
    const pinned = options.find(
      (o) =>
        String(o.courierId ?? "").toLowerCase() === wanted ||
        String(o.name ?? "").trim().toLowerCase() === wanted
    );
    if (pinned) return pinned;
    return pickCourier(options, "cheapest");
  }

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

/** Q1, in the words the admin screens use. */
export const DISPATCH_MODE_LABEL: Record<DispatchOnConfirm, string> = {
  off: "Do nothing",
  draft: "Stage a draft",
  book: "Book the AWB",
};

/** Q1 as a state readout — what will actually happen, not what it is called. */
export const DISPATCH_MODE_DETAIL: Record<DispatchOnConfirm, string> = {
  off: "Confirming changes nothing with the courier. You dispatch by hand.",
  draft: "Confirming stages a free, unbooked draft. You book it.",
  book: "Confirming books the AWB and charges your NimbusPost wallet.",
};

/** A strategy reads as a word; anything else is a courier's own name. */
export function courierChoiceLabel(choice: CourierChoice): string {
  return isCourierStrategy(choice) ? COURIER_PREFERENCE_LABEL[choice] : choice;
}

/**
 * True for the one combination that books real shipments, spends real money
 * and shows a human nothing until it is done. The UI has to say so out loud.
 */
export function isFullyUnattended(settings: PipelineSettings): boolean {
  return (
    settings.orderConfirmMode === "auto" && dispatchModeOf(settings) === "book"
  );
}
