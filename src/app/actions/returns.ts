"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { runAutomationTrigger } from "@/lib/automation";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, requireAdminWrite } from "@/lib/auth";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { draftReturnPickup } from "@/lib/fulfilment";
import {
  bookReturnPickup,
  listRtoOrders,
  quoteReturnPickup,
  syncAllOpenReturns,
  syncReturnFromNimbus,
} from "@/lib/nimbus-returns";
import {
  MAX_REFUND_REFERENCE_LENGTH,
  MAX_RETURN_REASONS,
  MAX_RETURN_REASON_LENGTH,
  PARCEL_HOLDER_LABEL,
  REFUND_DESTINATIONS,
  REFUND_METHODS,
  RETURN_OUTCOMES,
  RETURN_STATUSES,
  computeRefund,
  evaluateReturnEligibility,
  formatReturnDate,
  generateReturnNumber,
  goodsAreBack,
  isReturnStatus,
  matchReturnReason,
  normaliseReturnReasons,
  normaliseUpiId,
  outcomeOfRefundMethod,
  parcelHolder,
  refundDestinationsFor,
  refundMethodFor,
  refundMovesMoney,
  reverseLegOf,
  type RefundDestination,
  type RefundMethod,
  type RefundOrder,
  type ReturnBlock,
  type ReturnStatus,
} from "@/lib/returns";

/**
 * Identity **and** permission for every write in this module, routed through
 * the one write gate in `lib/auth.ts`. See the long note there: it is also
 * where a temporary admin's activity is recorded, so a new action that calls
 * this is gated and logged without its author doing anything.
 */
async function requireAdmin(what?: string, opts?: { quiet?: boolean }) {
  return requireAdminWrite(what, opts);
}

/** For the actions here that only read — view-only access may look at everything. */
async function requireAdminRead() {
  return requireAdminSession();
}

/* ------------------------------------------------------------ policy read */

type ReturnSettings = {
  returnsEnabled: boolean;
  defaultReturnable: boolean;
  returnWindowDays: number;
  returnReasons: string[];
  returnPolicyNote: string;
  /**
   * The store's plain-English refund wording. **There are no refund *rules* to
   * read any more** — a return is a full refund of the goods, the advance on a
   * part-paid order is never returned, and the store carries the return leg
   * when the fault is its own. All three are in `computeRefund`, which no
   * longer takes a settings argument, so no query can change what a refund
   * comes to.
   */
  refundPolicyNote: string;
};

/**
 * The live return policy, straight from the settings row.
 *
 * Deliberately NOT `getSettings()`: that DTO predates `returnReasons` /
 * `returnPolicyNote` and swallows DB errors into store defaults. Here a failed
 * read must be distinguishable from "returns are on", because the caller
 * refuses the request rather than guessing — `null` means "couldn't check",
 * which is the one answer that must never be treated as permission.
 *
 * A missing row (fresh database) is not an error: the schema defaults apply.
 */
async function readReturnSettings(): Promise<ReturnSettings | null> {
  try {
    const row = await prisma.siteSettings.findUnique({
      where: { id: "main" },
      select: {
        returnsEnabled: true,
        defaultReturnable: true,
        returnWindowDays: true,
        returnReasons: true,
        returnPolicyNote: true,
        refundPolicyNote: true,
      },
    });
    return {
      returnsEnabled: row?.returnsEnabled ?? DEFAULT_SETTINGS.returnsEnabled,
      defaultReturnable: row?.defaultReturnable ?? DEFAULT_SETTINGS.defaultReturnable,
      returnWindowDays: row?.returnWindowDays ?? DEFAULT_SETTINGS.returnWindowDays,
      returnReasons: normaliseReturnReasons(row?.returnReasons),
      returnPolicyNote: (row?.returnPolicyNote ?? "").trim(),
      refundPolicyNote: (row?.refundPolicyNote ?? "").trim(),
    };
  } catch (err) {
    console.error("[returns] could not read the return policy:", err);
    return null;
  }
}

/* ------------------------------------------------------------ refund maths */

/**
 * The money columns `computeRefund` needs, plus the one thing it cannot see
 * from a single row: what earlier returns on the SAME order have already paid
 * out. Without that, two requests against one order would each be measured
 * against the full pot and could, between them, refund more than was collected.
 *
 * `siblings` is every other return on the order. Rejected and cancelled ones
 * are skipped — no money left on those. A `refundAmount` is counted from the
 * moment it is recorded (at approval), not only once paid, so an approved-but-
 * unpaid refund still reserves its share of the pot.
 */
function refundOrderFrom(
  order: {
    total: number;
    amountPaid: number;
    balanceDue: number;
    subtotal: number;
    shipping: number;
    paymentFee: number;
    discountTotal: number;
    status: string;
    paymentStatus: string;
  },
  siblings: { id: string; status: string; refundAmount: number | null }[],
  excludeRequestId?: string
): RefundOrder {
  const alreadyRefunded = siblings.reduce((sum, r) => {
    if (r.id === excludeRequestId) return sum;
    if (r.status === "rejected" || r.status === "cancelled") return sum;
    return sum + (r.refundAmount ?? 0);
  }, 0);

  return {
    total: order.total,
    amountPaid: order.amountPaid,
    balanceDue: order.balanceDue,
    subtotal: order.subtotal,
    // Carried so the breakdown can *name* what the store keeps in rupees.
    // Neither is ever refunded and neither is part of the goods value, so they
    // change no arithmetic — they only stop the customer inventing a fee to
    // explain the gap between the order total and the refund.
    shipping: order.shipping,
    paymentFee: order.paymentFee,
    discountTotal: order.discountTotal,
    status: order.status,
    paymentStatus: order.paymentStatus,
    alreadyRefunded,
  };
}

/** The exact shape every refund query needs. One place, so they can't drift. */
const REFUND_ORDER_SELECT = {
  total: true,
  amountPaid: true,
  balanceDue: true,
  subtotal: true,
  shipping: true,
  paymentFee: true,
  discountTotal: true,
  status: true,
  paymentStatus: true,
} as const;

function revalidateReturns(orderNumber?: string | null) {
  revalidatePath("/admin/returns");
  revalidatePath("/admin");
  if (orderNumber) revalidatePath(`/order/${orderNumber}`);
}

/**
 * Tell the automation engine a return moved. **The only way a return emails
 * anybody** — there is no hardcoded sender for the reverse leg and there must
 * not be one.
 *
 * Called *after* the row is written and revalidated, for the same reason
 * `requestReturn` does it that way: a rule that fails must not cost the
 * customer the decision that was just made. `runAutomationTrigger` is written
 * never to throw, so the `.catch` is belt and braces.
 *
 * The courier-driven statuses (`picked_up`, `received`) are written by
 * `lib/nimbus-returns.ts` and the NimbusPost webhook, which do not call this.
 * They are picked up instead by the sweep inside every automation pass — and
 * because both land on the dedupe key `<returnId>:<status>`, a status that
 * somehow arrives down both paths still emails once.
 */
async function notifyReturnMoved(id: string, previousStatus: string) {
  await runAutomationTrigger("return.status_changed", {
    id,
    context: { previousStatus },
  }).catch((err) => console.error("[returns] automation trigger failed:", err));
}

type HistoryEntry = { status: string; note?: string; at: string; by?: string };

function readHistory(value: unknown): HistoryEntry[] {
  return Array.isArray(value) ? (value as HistoryEntry[]) : [];
}

/* ------------------------------------------------------------ customer side */

const requestSchema = z.object({
  orderNumber: z.string().trim().min(1),
  /** Index into Order.items — the line being returned. */
  itemIndex: z.coerce.number().int().min(0),
  quantity: z.coerce.number().int().min(1).default(1),
  // Validated against the admin's configured list below, not here: the list
  // lives in the database and can change between renders.
  reason: z.string().trim().min(1, "Pick a reason"),
  /**
   * What the customer wants to happen. Defaults to `refund` so a client that
   * predates this field still behaves exactly as it did.
   */
  outcome: z.enum(RETURN_OUTCOMES).default("refund"),
  /**
   * Where a refund should go. Only consulted when `outcome` is `refund`, and
   * re-checked against the order below — a cash-on-delivery order has no
   * original rail to send money down, whatever the form posts.
   */
  refundDestination: z.enum(REFUND_DESTINATIONS).optional(),
  customerNote: z.string().trim().max(1000).optional(),
  images: z.array(z.string()).max(6).default([]),
});

export type RequestReturnInput = z.input<typeof requestSchema>;

type OrderItem = {
  productId?: string;
  name: string;
  quantity: number;
  price: number;
  options?: { name: string; value: string }[];
};

/**
 * A customer raises a return for one line of a delivered order.
 *
 * **This is the enforcement boundary, not the button.** A Server Action is a
 * POST endpoint anyone can hit directly, so every rule the form appears to
 * apply is re-decided here from the database row: the master switch, the
 * product's returnable / made-to-order flags, the delivery date, the window,
 * the chosen reason, the line and the quantity. The form is only a hint about
 * what to offer; nothing it sends is trusted.
 */
export async function requestReturn(input: RequestReturnInput) {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0].message };
  }
  const data = parsed.data;

  const settings = await readReturnSettings();
  if (!settings) {
    // Couldn't read the policy — refuse rather than assume returns are open.
    return {
      ok: false as const,
      error: "We couldn't check the returns policy just now — please try again.",
    };
  }

  const order = await prisma.order
    .findUnique({
      where: { orderNumber: data.orderNumber },
      include: { returnRequests: true },
    })
    .catch(() => null);
  if (!order) return { ok: false as const, error: "Order not found" };

  const items = (Array.isArray(order.items) ? order.items : []) as unknown as OrderItem[];
  const item = items[data.itemIndex];
  if (!item) return { ok: false as const, error: "That item isn't on this order" };

  const product = item.productId
    ? await prisma.product
        .findUnique({
          where: { id: item.productId },
          select: { returnable: true, returnsInfo: true, isCustomisable: true },
        })
        .catch(() => null)
    : null;

  // One call decides it — the same one the order page renders from, so the
  // page and the endpoint can never disagree about whether this is allowed.
  const verdict = evaluateReturnEligibility({
    order,
    product: product ?? {},
    settings,
    now: new Date(),
  });
  if (!verdict.allowed) {
    return { ok: false as const, error: verdict.message, code: verdict.code };
  }

  const reason = matchReturnReason(data.reason, settings.returnReasons);
  if (!reason) {
    return {
      ok: false as const,
      error: "Pick one of the listed reasons.",
    };
  }

  // One open request per line — a second one would book two pickups for the
  // same parcel. A rejected/cancelled one doesn't block a fresh attempt.
  const alreadyOpen = order.returnRequests.some(
    (r) =>
      r.productName === item.name &&
      !["rejected", "cancelled", "refunded"].includes(r.status)
  );
  if (alreadyOpen) {
    return { ok: false as const, error: "A return for this item is already in progress." };
  }

  if (data.quantity > item.quantity) {
    return {
      ok: false as const,
      error: `You ordered ${item.quantity} of this item.`,
    };
  }

  const variantLabel = (item.options ?? [])
    .map((o) => `${o.name}: ${o.value}`)
    .join(" · ");

  /**
   * The customer's chosen outcome, recorded now.
   *
   * It rides on `refundMethod` (see `refundMethodFor`), which is why a
   * replacement or an exchange needs no new column — and why the admin panel
   * opens on what the customer actually asked for instead of defaulting every
   * request to "send the money back".
   *
   * The destination is re-derived from the order rather than trusted: a
   * cash-on-delivery order has no card to refund, so a posted `original` is
   * silently corrected to `upi` rather than stored as a promise nothing can
   * keep.
   */
  const offered = refundDestinationsFor({
    total: order.total,
    amountPaid: order.amountPaid,
    balanceDue: order.balanceDue,
  });
  const destination: RefundDestination =
    data.refundDestination && offered.includes(data.refundDestination)
      ? data.refundDestination
      : offered[0];
  const refundMethod = refundMethodFor(data.outcome, destination);

  try {
    const created = await prisma.returnRequest.create({
      data: {
        requestNumber: generateReturnNumber(),
        orderId: order.id,
        productId: item.productId ?? null,
        productName: item.name,
        variantLabel: variantLabel || null,
        quantity: data.quantity,
        unitPrice: item.price,
        reason,
        customerNote: data.customerNote?.trim() || null,
        images: data.images,
        status: "pending",
        // The ask, not a decision: no figure is written until the admin
        // approves, so this cannot be mistaken for a refund that was agreed.
        refundMethod,
        statusHistory: [
          {
            status: "pending",
            note: `Requested by customer — wants ${
              data.outcome === "replace"
                ? "a replacement"
                : data.outcome === "exchange"
                  ? "a different size"
                  : destination === "upi"
                    ? "a refund by UPI"
                    : "a refund to the original payment"
            }`,
            at: new Date().toISOString(),
          },
        ] as unknown as object[],
      },
      select: { id: true, requestNumber: true },
    });
    revalidateReturns(order.orderNumber);

    // Automation rules bound to `return.requested`. Deliberately after the row
    // exists and after revalidation: a rule that fails must not cost the
    // customer the return they just raised. `runAutomationTrigger` never throws.
    await runAutomationTrigger("return.requested", { id: created.id }).catch(
      (err) => console.error("[returns] automation trigger failed:", err)
    );

    return {
      ok: true as const,
      requestNumber: created.requestNumber,
      message: `Return ${created.requestNumber} raised. We'll review it within 24 hours.`,
    };
  } catch (err) {
    console.error("[returns] requestReturn failed:", err);
    return { ok: false as const, error: "Could not raise the return — please try again." };
  }
}

/* ------------------------------------------------- policy, for the customer */

export type ReturnLineVerdict = {
  /** Index into Order.items — the same handle `requestReturn` takes. */
  index: number;
  allowed: boolean;
  code: ReturnBlock;
  /** Empty when allowed; otherwise the sentence to show beside the line. */
  message: string;
};

export type ReturnPolicySnapshot = {
  /** False when the policy couldn't be read. Callers then keep what they had. */
  ok: boolean;
  /** The admin's accepted grounds for a return, in their order. */
  reasons: string[];
  /** Plain-English rules, one per line, shown above the form. */
  policyNote: string;
  windowDays: number;
  daysLeft: number;
  /** Pre-formatted so the date reads identically on the server and the client. */
  closesOn: string | null;
  deliveredOn: string | null;
  /** Store-level verdict: the master switch, delivery and the window only. */
  code: ReturnBlock;
  message: string;
  /** Per-line verdict, which adds the product's own rules on top. */
  lines: ReturnLineVerdict[];
  /**
   * Everything the form needs to work out the refund itself, so the figure a
   * shopper is shown before submitting comes from the same `computeRefund`
   * the admin approves with. Sending the inputs rather than a number lets the
   * preview update live as they change the outcome or the reason, with no extra
   * round trip and no second implementation of the maths.
   *
   * There is no `settings` here any more: the rules are not configurable, so
   * there is nothing to send. What *is* sent is `destinations` — a COD order
   * cannot refund to a card, and the form must offer one option rather than two
   * with one of them dimmed.
   *
   * Null only when the order could not be read.
   */
  refund: {
    order: RefundOrder;
    /** Refund destinations this order can actually support, in order. */
    destinations: RefundDestination[];
    /** The store's plain-English refund rules, shown above the preview. */
    note: string;
  } | null;
};

const POLICY_UNAVAILABLE: ReturnPolicySnapshot = {
  ok: false,
  reasons: [],
  policyNote: "",
  windowDays: 0,
  daysLeft: 0,
  closesOn: null,
  deliveredOn: null,
  code: "store_disabled",
  message: "",
  lines: [],
  refund: null,
};

/**
 * The authoritative answer to "what may this customer do with this order?",
 * for the return form to render from.
 *
 * It exists because the order page is a different file with a different owner,
 * and a form built from props can drift from the rule the action enforces —
 * which is how a shopper ends up filling in a form that is rejected on submit.
 * Both sides now call `evaluateReturnEligibility` on the same freshly-read
 * row, so the form only ever offers what the action will accept.
 *
 * Reachable with an order number alone, exactly like `requestReturn` and the
 * order page itself. It returns no customer data — only policy text and a
 * verdict per line index — so it reveals nothing the page hasn't already shown
 * to whoever holds the link.
 */
export async function getReturnPolicySnapshot(
  orderNumber: string
): Promise<ReturnPolicySnapshot> {
  const wanted = typeof orderNumber === "string" ? orderNumber.trim() : "";
  if (!wanted) return POLICY_UNAVAILABLE;

  const settings = await readReturnSettings();
  if (!settings) return POLICY_UNAVAILABLE;

  const order = await prisma.order
    .findUnique({
      where: { orderNumber: wanted },
      select: {
        ...REFUND_ORDER_SELECT,
        createdAt: true,
        deliveryStatusAt: true,
        items: true,
        // Siblings, for the "already paid out on this order" cap.
        returnRequests: { select: { id: true, status: true, refundAmount: true } },
      },
    })
    .catch(() => null);
  if (!order) return POLICY_UNAVAILABLE;

  const items = (Array.isArray(order.items) ? order.items : []) as unknown as OrderItem[];
  const productIds = [
    ...new Set(items.map((i) => i.productId).filter((id): id is string => !!id)),
  ];
  const products = productIds.length
    ? await prisma.product
        .findMany({
          where: { id: { in: productIds } },
          select: { id: true, returnable: true, isCustomisable: true },
        })
        .catch(() => [])
    : [];
  const byId = new Map(products.map((p) => [p.id, p]));

  const now = new Date();
  // Store-level view: a hypothetical always-returnable product, so this
  // reports the switch, the delivery and the window without a per-product
  // exclusion masquerading as "the window is shut".
  const store = evaluateReturnEligibility({
    order,
    product: { returnable: true },
    settings,
    now,
  });

  const lines: ReturnLineVerdict[] = items.map((item, index) => {
    const verdict = evaluateReturnEligibility({
      order,
      product: (item.productId && byId.get(item.productId)) || {},
      settings,
      now,
    });
    return {
      index,
      allowed: verdict.allowed,
      code: verdict.code,
      message: verdict.message,
    };
  });

  return {
    ok: true,
    reasons: settings.returnReasons,
    policyNote: settings.returnPolicyNote,
    windowDays: settings.returnWindowDays,
    daysLeft: store.window.daysLeft,
    closesOn: store.window.closesAt ? formatReturnDate(store.window.closesAt) : null,
    deliveredOn: store.window.deliveredAt
      ? formatReturnDate(store.window.deliveredAt)
      : null,
    code: store.code,
    message: store.message,
    lines,
    refund: (() => {
      const refundOrder = refundOrderFrom(order, order.returnRequests);
      return {
        order: refundOrder,
        destinations: refundDestinationsFor(refundOrder),
        note: settings.refundPolicyNote,
      };
    })(),
  };
}

/* --------------------------------------------------------------- admin side */

const decideSchema = z.object({
  id: z.string().min(1),
  approve: z.boolean(),
  /** Shown to the customer on their order page. */
  adminNote: z.string().trim().max(1000).optional(),
  /**
   * Replace the computed net with a hand-picked figure. Null or absent takes
   * what `computeRefund` worked out — which is the path that should be used
   * almost always, and the one that needs no justification.
   */
  refundOverride: z.coerce.number().int().min(0).nullable().optional(),
  /** Required whenever `refundOverride` differs from the computed net. */
  overrideReason: z.string().trim().max(300).optional(),
  refundMethod: z.enum(REFUND_METHODS).nullable().optional(),
  /** Where a UPI payout goes. The customer can also supply this themselves. */
  refundUpi: z.string().trim().max(100).optional(),
  /** Book the reverse pickup with NimbusPost on approval. */
  bookPickup: z.boolean().default(true),
});

export type DecideReturnInput = z.input<typeof decideSchema>;

/**
 * Approve or reject a return, and fix the refund figure at the same moment.
 *
 * **The numbers are recomputed here, never taken from the client.** The panel
 * shows a breakdown, but a Server Action is a POST endpoint: the only figure
 * that is trusted is the one this function derives from the order row through
 * `computeRefund`. The admin may override the *net*, and that is bounded too —
 * a payout larger than the pot the customer actually paid into is refused,
 * because the one thing this whole feature must never do is send out money
 * that was never collected.
 *
 * `refundGross` / `refundFee` / `refundAmount` are **written now and never
 * recomputed**, which is the only way a refund history can be audited: a row
 * decided last month still reads as it was decided, whatever has changed since.
 *
 * ## The outcome is honoured, not assumed
 *
 * `refundMethod` carries what the customer asked for — refund, replacement or
 * size exchange — and this function reads it before it writes any figure. On a
 * replacement or an exchange the three money columns are written as **zero**,
 * deliberately and explicitly: nothing is owed, nothing reserves a share of the
 * order's refundable pool, and `markRefundPaid` has nothing to pay. The admin
 * can still change the outcome here (a replacement is out of stock, so it
 * becomes a refund) — but only by saying so, never by omission.
 *
 * On approval the reverse pickup is drafted with NimbusPost. That call is
 * allowed to fail without failing the approval — the decision is ours, the
 * courier booking is a third party. When it fails, `nimbusError` is stored and
 * returned so the admin sees "approved, pickup NOT booked" rather than a green
 * tick hiding a broken pickup.
 */
export async function decideReturn(input: DecideReturnInput) {
  await requireAdmin("decideReturn");
  const parsed = decideSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0].message };
  }
  const data = parsed.data;

  const existing = await prisma.returnRequest.findUnique({
    where: { id: data.id },
    include: {
      order: {
        select: {
          ...REFUND_ORDER_SELECT,
          orderNumber: true,
          returnRequests: { select: { id: true, status: true, refundAmount: true } },
        },
      },
    },
  });
  if (!existing) return { ok: false as const, error: "Return request not found" };
  if (existing.status !== "pending") {
    return {
      ok: false as const,
      error: `This request is already ${existing.status.replace("_", " ")}.`,
    };
  }
  if (!data.approve && !data.adminNote?.trim()) {
    // A bare rejection leaves the customer with no idea why.
    return { ok: false as const, error: "Add a note explaining the rejection." };
  }

  /* ---------------------------------------------------------- rejection */
  if (!data.approve) {
    const history = readHistory(existing.statusHistory);
    history.push({
      status: "rejected",
      note: data.adminNote?.trim() || undefined,
      at: new Date().toISOString(),
      by: "admin",
    });
    await prisma.returnRequest.update({
      where: { id: data.id },
      data: {
        status: "rejected",
        adminNote: data.adminNote?.trim() || null,
        // A rejected return owes nothing — clear any figure, don't keep a
        // stale one hanging around to be paid by mistake.
        refundGross: null,
        refundFee: null,
        refundAmount: null,
        refundMethod: null,
        resolvedAt: new Date(),
        statusHistory: history as unknown as object[],
      },
    });
    revalidateReturns(existing.order.orderNumber);
    await notifyReturnMoved(data.id, existing.status);
    return {
      ok: true as const,
      status: "rejected",
      refund: null,
      pickupBooked: false,
      pickupIssue: null,
    };
  }

  /* ------------------------------------------------------------ approval */
  const refundOrder = refundOrderFrom(
    existing.order,
    existing.order.returnRequests,
    existing.id
  );

  // What is being agreed: the admin's choice if they made one, otherwise the
  // outcome the customer asked for when they raised the request. Never a bare
  // default — "send the money back" has to be something somebody chose.
  const method: RefundMethod =
    data.refundMethod ?? (existing.refundMethod as RefundMethod | null) ?? "original";
  const outcome = outcomeOfRefundMethod(method);
  const movesMoney = refundMovesMoney(method);

  const computed = computeRefund({
    order: refundOrder,
    lines: [{ unitPrice: existing.unitPrice, quantity: existing.quantity }],
    reason: existing.reason,
    outcome,
    destination: method === "upi" ? "upi" : "original",
  });

  // The hard ceiling, independent of the line maths: what is left of the money
  // this customer actually parted with, once the non-refundable advance and
  // earlier refunds are subtracted. An override may go above the computed net
  // (goodwill, return postage) but never above this.
  const ceiling = computed.payable;

  // A replacement or a size exchange settles at zero, explicitly — not by the
  // arithmetic happening to produce nothing. That is what stops a fulfilment
  // outcome reserving a slice of the order's refundable pool, and what makes
  // "only refund moves money" a property of this function rather than a habit.
  let net = movesMoney ? computed.net : 0;
  let gross = movesMoney ? computed.gross : 0;
  // Always 0 now: a return pays back the full value of the goods. The column
  // stays because rows decided under the old fee policy still carry one.
  let fee = 0;
  let overrideNote: string | null = null;

  const wants = data.refundOverride;
  if (typeof wants === "number" && wants !== net) {
    if (!movesMoney) {
      return {
        ok: false as const,
        error:
          "This return is being settled with a replacement or an exchange, so there is no amount to pay. Switch it to a refund first.",
      };
    }
    if (!data.overrideReason?.trim()) {
      return {
        ok: false as const,
        error: "Say why you're changing the refund amount.",
      };
    }
    if (wants > ceiling) {
      return {
        ok: false as const,
        error: `That's more than this order has left to refund (${ceiling}). The customer only paid in so much.`,
      };
    }
    net = wants;
    // Keep the gross honest: an above-computed payout is goodwill, not a
    // negative fee, so the gross follows the net up.
    gross = Math.max(computed.gross, net);
    fee = Math.max(0, gross - net);
    overrideNote = `Refund set to ${net} by hand (computed ${computed.net}): ${data.overrideReason.trim()}`;
  }

  const upi = data.refundUpi?.trim() ? normaliseUpiId(data.refundUpi) : null;
  if (data.refundUpi?.trim() && !upi) {
    return { ok: false as const, error: "That doesn't look like a UPI ID (name@bank)." };
  }

  const history = readHistory(existing.statusHistory);
  history.push({
    status: "approved",
    note:
      [
        // The outcome is in the timeline, not only in a column, so "we agreed
        // to replace this" survives a later change of method.
        movesMoney
          ? `Refund agreed — ${method === "upi" ? "by UPI" : "to the original payment"}`
          : outcome === "replace"
            ? "Agreed: replacement, no refund"
            : "Agreed: different size, no refund",
        data.adminNote?.trim(),
        overrideNote,
      ]
        .filter(Boolean)
        .join(" · ") || undefined,
    at: new Date().toISOString(),
    by: "admin",
  });

  await prisma.returnRequest.update({
    where: { id: data.id },
    data: {
      status: "approved",
      adminNote: data.adminNote?.trim() || null,
      refundGross: gross,
      refundFee: fee,
      refundAmount: net,
      refundMethod: method,
      refundUpi: upi ?? existing.refundUpi,
      resolvedAt: null,
      statusHistory: history as unknown as object[],
    },
  });

  let pickup: { ok: boolean; error?: string; skipped?: string } | null = null;
  if (data.bookPickup) {
    pickup = await draftReturnPickup(data.id);
  }

  revalidateReturns(existing.order.orderNumber);
  // After the pickup draft, not before: the approval email quotes the pickup
  // courier when there is one, and there is nothing to quote until this point.
  await notifyReturnMoved(data.id, existing.status);

  return {
    ok: true as const,
    status: "approved",
    refund: { gross, fee, net, method, outcome },
    /** Our mistake ⇒ the store carries the reverse leg. A cost, not a deduction. */
    storePaysReturnShipping: computed.storePaysReturnShipping,
    pickupBooked: pickup?.ok ?? false,
    pickupIssue: pickup && !pickup.ok ? pickup.error ?? pickup.skipped ?? null : null,
  };
}

/* ------------------------------------------------------------- pay it out */

const paidSchema = z.object({
  id: z.string().min(1),
  /** UTR / transaction reference. What the customer looks for on a statement. */
  reference: z.string().trim().max(MAX_REFUND_REFERENCE_LENGTH).optional(),
  method: z.enum(REFUND_METHODS).optional(),
  upi: z.string().trim().max(100).optional(),
  /** Optional extra line for the customer. */
  note: z.string().trim().max(500).optional(),
  /**
   * "Pay anyway — I know the goods aren't back yet."
   *
   * Required only when there is money to send AND the parcel is demonstrably
   * not with us. Deliberately a *choice* rather than a block: paying early is a
   * legitimate goodwill call, and a hard refusal would only push the owner into
   * ticking "received" dishonestly to get past it — which would destroy the one
   * record of where the goods actually are. See `markRefundPaid`.
   */
  acknowledgeNotReceived: z.boolean().default(false),
});

export type MarkRefundPaidInput = z.input<typeof paidSchema>;

/**
 * Record that the money has actually gone out, and close the request.
 *
 * Separate from `setReturnStatus` on purpose: "refunded" is the one status
 * that asserts money moved, and it must not be reachable by a bare status
 * change. A reference is required whenever there is a payout, so a customer
 * asking "where is my refund?" can always be given something to look up.
 *
 * Figures are NOT recomputed here. Whatever was agreed at approval is what is
 * paid — the point of storing `refundGross`/`refundFee`/`refundAmount` then is
 * that a settings change between approval and payout cannot move the number.
 * The only exception is a request approved before refunds existed, which has
 * no stored figure at all; that one is computed once, here, and then stored.
 *
 * ## Money and physical reality
 *
 * The status machine alone cannot answer "are the goods back?": `approved` is
 * a payable status, and an approved return's parcel is normally still in the
 * customer's hallway. So a payout is measured against the **reverse leg** —
 * where the courier says the parcel actually is — and paying before it arrives
 * requires `acknowledgeNotReceived`.
 *
 * That is a confirmation, not a block, and the difference matters: a hard
 * refusal would be routed around by marking the return "received" when it
 * isn't, which would corrupt the only record of where the goods are. The
 * choice is instead made deliberately and written into the timeline, so
 * "refunded before it came back" is auditable rather than indistinguishable
 * from the normal path.
 */
export async function markRefundPaid(input: MarkRefundPaidInput) {
  await requireAdmin("markRefundPaid");
  const parsed = paidSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0].message };
  }
  const data = parsed.data;

  const existing = await prisma.returnRequest.findUnique({
    where: { id: data.id },
    include: {
      order: {
        select: {
          ...REFUND_ORDER_SELECT,
          orderNumber: true,
          returnRequests: { select: { id: true, status: true, refundAmount: true } },
        },
      },
    },
  });
  if (!existing) return { ok: false as const, error: "Return request not found" };
  if (existing.status === "refunded") {
    return { ok: false as const, error: "This refund is already recorded as paid." };
  }
  if (!["approved", "picked_up", "received"].includes(existing.status)) {
    return {
      ok: false as const,
      error: "Approve the return before recording a refund.",
    };
  }

  const method: RefundMethod =
    data.method ?? (existing.refundMethod as RefundMethod | null) ?? "original";

  // Backfill for a request approved before this screen existed. Computed with
  // the same outcome that is about to be recorded, so a replacement that was
  // never given a figure backfills as zero rather than as a payout.
  let gross = existing.refundGross;
  let fee = existing.refundFee;
  let net = existing.refundAmount;
  if (net == null) {
    const computed = computeRefund({
      order: refundOrderFrom(
        existing.order,
        existing.order.returnRequests,
        existing.id
      ),
      lines: [{ unitPrice: existing.unitPrice, quantity: existing.quantity }],
      reason: existing.reason,
      outcome: outcomeOfRefundMethod(method),
      destination: method === "upi" ? "upi" : "original",
    });
    gross = computed.gross;
    fee = 0;
    net = computed.net;
  }

  // A replacement or an exchange can never pay out, whatever is on the row.
  // The stored figure is trusted for a refund and overruled here for the other
  // two, because the outcome is the thing that decides it.
  if (!refundMovesMoney(method)) {
    gross = 0;
    fee = 0;
    net = 0;
  }

  const upi = data.upi?.trim() ? normaliseUpiId(data.upi) : null;
  if (data.upi?.trim() && !upi) {
    return { ok: false as const, error: "That doesn't look like a UPI ID (name@bank)." };
  }
  const upiOnFile = upi ?? existing.refundUpi;
  if (method === "upi" && net > 0 && !upiOnFile) {
    return {
      ok: false as const,
      error: "Add the customer's UPI ID before recording a UPI payout.",
    };
  }

  const reference = data.reference?.trim() || null;
  // A replacement or an exchange moves goods, not money, and a ₹0 payout has
  // nothing to look up — everything else must leave a trail.
  if (!reference && net > 0 && refundMovesMoney(method)) {
    return {
      ok: false as const,
      error: "Add the payment reference (UTR) so the customer can trace it.",
    };
  }

  // Where the parcel actually is, from the reverse leg rather than from the
  // return's status word. Same function the admin panel renders from, so the
  // sentence on screen and the condition enforced here are one rule.
  const legInput = {
    status: existing.status as ReturnStatus,
    nimbusOrderId: existing.nimbusOrderId,
    nimbusAwb: existing.nimbusAwb,
    nimbusError: existing.nimbusError,
  };
  const back = goodsAreBack(legInput);
  const holder = parcelHolder(reverseLegOf(legInput));

  if (net > 0 && !back && !data.acknowledgeNotReceived) {
    return {
      ok: false as const,
      error: `${PARCEL_HOLDER_LABEL[holder]} — nothing has come back yet. Tick “pay before it arrives” if you mean to refund now anyway.`,
      needsAcknowledgement: true as const,
      holder,
    };
  }

  const now = new Date();
  const history = readHistory(existing.statusHistory);
  history.push({
    status: "refunded",
    note:
      [
        net > 0
          ? `Refund of ${net} paid by ${method}`
          : method === "replacement"
            ? "Closed — replacement sent, no payout"
            : method === "exchange"
              ? "Closed — different size sent, no payout"
              : "Closed with no payout",
        reference ? `ref ${reference}` : null,
        // Recorded on the row, not just permitted. Six weeks later "why did we
        // pay this one out early?" has an answer.
        net > 0 && !back
          ? `PAID BEFORE COLLECTION — ${PARCEL_HOLDER_LABEL[holder].toLowerCase()} at the time of payout`
          : null,
        data.note?.trim() || null,
      ]
        .filter(Boolean)
        .join(" · ") || undefined,
    at: now.toISOString(),
    by: "admin",
  });

  await prisma.returnRequest.update({
    where: { id: data.id },
    data: {
      status: "refunded",
      refundGross: gross,
      refundFee: fee,
      refundAmount: net,
      refundMethod: method,
      refundUpi: upiOnFile,
      refundReference: reference,
      refundedAt: now,
      resolvedAt: now,
      statusHistory: history as unknown as object[],
    },
  });

  revalidateReturns(existing.order.orderNumber);
  await notifyReturnMoved(data.id, existing.status);
  return { ok: true as const, net, reference };
}

/* --------------------------------------------------- customer's UPI handle */

const upiSchema = z.object({
  orderNumber: z.string().trim().min(1),
  requestNumber: z.string().trim().min(1),
  upi: z.string().trim().min(1).max(100),
});

export type SetRefundUpiInput = z.input<typeof upiSchema>;

/**
 * The customer tells us where to send a COD refund.
 *
 * Asked for only **after** approval, and only when the payout is by UPI: a
 * prepaid refund goes straight back down the card rail and needs nothing from
 * them, so asking would be collecting a payment handle for no reason.
 *
 * Authorised by the order number **and** the request number together, which is
 * the same trust model the rest of this page already runs on (anyone holding
 * the link can see the order and raise a return). It is deliberately not a
 * one-shot write — a typo has to be fixable — and the admin sees the handle in
 * the queue before any money moves, which is where a wrong one gets caught.
 *
 * A UPI VPA is all that is ever accepted here. A bank account number would be
 * a different class of data and would need encryption and a retention policy
 * before it could be stored at all.
 */
export async function setReturnRefundUpi(input: SetRefundUpiInput) {
  const parsed = upiSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: "Enter your UPI ID." };
  }
  const data = parsed.data;

  const upi = normaliseUpiId(data.upi);
  if (!upi) {
    return {
      ok: false as const,
      error: "That doesn't look like a UPI ID — it should read like name@bank.",
    };
  }

  const request = await prisma.returnRequest
    .findUnique({
      where: { requestNumber: data.requestNumber },
      select: {
        id: true,
        status: true,
        refundedAt: true,
        order: { select: { orderNumber: true } },
      },
    })
    .catch(() => null);

  // Both halves must match. A request number alone is not enough.
  if (!request || request.order.orderNumber !== data.orderNumber) {
    return { ok: false as const, error: "We couldn't find that return." };
  }
  if (request.refundedAt) {
    return {
      ok: false as const,
      error: "This refund has already been sent — message us if it went astray.",
    };
  }
  if (!["approved", "picked_up", "received"].includes(request.status)) {
    return {
      ok: false as const,
      error: "We'll ask for this once your return is approved.",
    };
  }

  try {
    await prisma.returnRequest.update({
      where: { id: request.id },
      data: { refundUpi: upi },
    });
  } catch (err) {
    console.error("[returns] setReturnRefundUpi failed:", err);
    return { ok: false as const, error: "Could not save that — please try again." };
  }

  revalidateReturns(data.orderNumber);
  return { ok: true as const, upi };
}

/**
 * Move an approved return along its lifecycle (picked up → received).
 *
 * "refunded" is deliberately NOT reachable from here. That status asserts the
 * money left the account, and it must carry a reference and a timestamp —
 * `markRefundPaid` is the only door to it.
 */
export async function setReturnStatus(id: string, status: string, note?: string) {
  await requireAdmin("setReturnStatus");
  if (!isReturnStatus(status)) {
    return { ok: false as const, error: "Unknown status" };
  }
  if (status === "refunded") {
    return {
      ok: false as const,
      error: "Use “Record refund” so the payment reference is captured.",
    };
  }
  const existing = await prisma.returnRequest.findUnique({
    where: { id },
    include: { order: { select: { orderNumber: true } } },
  });
  if (!existing) return { ok: false as const, error: "Return request not found" };

  const history = readHistory(existing.statusHistory);
  history.push({
    status,
    note: note?.trim() || undefined,
    at: new Date().toISOString(),
    by: "admin",
  });

  await prisma.returnRequest.update({
    where: { id },
    data: {
      status,
      // "Resolved" means no further action: refunded, rejected or cancelled.
      resolvedAt: ["refunded", "rejected", "cancelled"].includes(status)
        ? new Date()
        : null,
      statusHistory: history as unknown as object[],
    },
  });
  revalidateReturns(existing.order.orderNumber);
  await notifyReturnMoved(id, existing.status);
  return { ok: true as const };
}

/**
 * Retry a reverse pickup **draft** that failed (bad pincode, Nimbus outage).
 *
 * Only ever re-stages a draft — it does not book, so it never spends the
 * wallet. The stale draft id is cleared first so `draftReturnPickup` doesn't
 * short-circuit on "already staged" after a half-succeeded attempt.
 *
 * Refuses outright once an AWB exists. Clearing `nimbusOrderId` on a booked
 * shipment would orphan a real, already-paid-for courier job in NimbusPost and
 * leave us drafting a second one beside it.
 */
export async function retryReturnPickup(id: string) {
  await requireAdmin("retryReturnPickup");

  const existing = await prisma.returnRequest.findUnique({
    where: { id },
    select: { nimbusAwb: true },
  });
  if (!existing) return { ok: false as const, error: "Return request not found" };
  if (existing.nimbusAwb) {
    return {
      ok: false as const,
      error: `This pickup is already booked (AWB ${existing.nimbusAwb}). Use “Sync from NimbusPost” instead — re-drafting would leave a paid-for shipment orphaned.`,
    };
  }

  await prisma.returnRequest.update({
    where: { id },
    data: { nimbusOrderId: null, nimbusError: null },
  });
  const result = await draftReturnPickup(id);
  revalidateReturns();
  return result.ok
    ? { ok: true as const }
    : { ok: false as const, error: result.error ?? result.skipped ?? "Could not book pickup" };
}

/* --------------------------------------------------- reverse leg: courier */

/**
 * What booking this pickup would cost, and what is in the wallet.
 *
 * Read before the confirmation is shown, so the charge can be **named** rather
 * than implied. Read-only — it books nothing.
 */
export async function quoteReturnPickupAction(id: string) {
  await requireAdminRead();
  const res = await quoteReturnPickup(id);
  return res.ok
    ? { ok: true as const, quote: res.quote }
    : { ok: false as const, error: res.error };
}

/**
 * Book a staged reverse draft — **this charges the NimbusPost wallet.**
 *
 * The only call in the returns flow that spends money, and it is deliberately
 * separate from approval: approving a return is our decision, paying a courier
 * is not the same act and must not ride along on it. Draft-first is enforced in
 * `bookReturnPickup`, which refuses to create anything.
 */
export async function bookReturnPickupAction(id: string, courierId?: string | null) {
  await requireAdmin("bookReturnPickupAction");
  const res = await bookReturnPickup(id, courierId ?? null);
  revalidateReturns();
  return res;
}

/**
 * Pull a reverse booking (or its latest scan) back from NimbusPost.
 *
 * The returns-side twin of "Sync from NimbusPost" on an order. Needed for
 * exactly the same reason: a draft booked in the NimbusPost dashboard has an
 * AWB there and none here, and the status webhook matches on AWB — so without
 * this, booking outside the admin means the return can never hear from the
 * courier again.
 */
export async function syncReturnPickupAction(id: string) {
  await requireAdmin("syncReturnPickupAction");
  const res = await syncReturnFromNimbus(id);
  revalidateReturns();
  return res;
}

/**
 * Sync every open reverse shipment in one pass.
 *
 * The cron at `/api/cron/nimbus-sync` only walks `Order`, so reverse shipments
 * are never polled automatically. Until that route calls `syncAllOpenReturns`
 * too, this button is the way the queue catches up.
 */
export async function syncAllReturnPickupsAction() {
  await requireAdmin("syncAllReturnPickupsAction");
  const res = await syncAllOpenReturns();
  revalidateReturns();
  return res;
}

/**
 * Forward shipments the courier is bringing back to us (RTO).
 *
 * Not customer-raised returns — there is no `ReturnRequest` behind these — but
 * they end the same way: stock returning to the shelf and, on a prepaid order,
 * money owed. They are surfaced on the returns screen because that is where
 * someone is already looking for "goods coming back"; nothing else in the app
 * mentions them outside an analytics count.
 */
export async function listRtoOrdersAction() {
  await requireAdminRead();
  return listRtoOrders();
}

export async function deleteReturnRequest(id: string) {
  await requireAdmin("deleteReturnRequest");
  await prisma.returnRequest.delete({ where: { id } });
  revalidateReturns();
  return { ok: true as const };
}

/* ------------------------------------------------------- store-wide defaults */

const defaultsSchema = z.object({
  returnsEnabled: z.boolean(),
  defaultReturnable: z.boolean(),
  // 1–90 days. Bounded on both ends: 0 would shut the window at the instant of
  // delivery, and an unbounded value is an accidental forever-window.
  returnWindowDays: z.coerce.number().int().min(1).max(90),
  defaultReturnsInfo: z.string().max(4000).default(""),
  // Over-length input is trimmed by `normaliseReturnReasons` rather than
  // rejected, so a stray paste can't block the whole save.
  returnReasons: z
    .array(z.string().max(MAX_RETURN_REASON_LENGTH * 4))
    .max(MAX_RETURN_REASONS * 4)
    .default([]),
  returnPolicyNote: z.string().max(2000).default(""),
  // ---- Refunds ----
  // Only the wording. `refundFeePercent`, `refundFeeFlat`,
  // `partialAdvanceRefundable` and `waiveRefundFeeOnOurFault` are deliberately
  // NOT accepted: the refund rule is fixed in `computeRefund` and there is no
  // longer a screen that can change it. Zod strips anything not in the schema
  // silently, so a stale client still posting them is simply ignored — and the
  // writer below pins the four columns to their neutral values so the database
  // agrees with the code rather than merely being unread.
  refundPolicyNote: z.string().max(2000).default(""),
});

export type ReturnDefaultsInput = z.input<typeof defaultsSchema>;

/**
 * The store-wide return policy. Lives here rather than in Branding & settings so
 * there is exactly one screen that owns returns — the same "one editor per
 * field" rule the product images follow.
 *
 * `returnReasons` is normalised, never taken as sent: blanks and duplicates are
 * dropped, and an empty result falls back to the constants in `lib/returns.ts`.
 * Saving no reasons at all would leave the customer's dropdown empty and make
 * returns unraisable — a settings screen must not be able to do that by
 * accident.
 *
 * Changing a refund fee here only affects refunds decided **after** the save.
 * Every approved request already carries its own `refundGross`/`refundFee`/
 * `refundAmount`, so history is never rewritten by a settings change.
 */
export async function updateReturnDefaults(input: ReturnDefaultsInput) {
  await requireAdmin("updateReturnDefaults");
  const parsed = defaultsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0].message };
  }
  const data = {
    ...parsed.data,
    returnReasons: normaliseReturnReasons(parsed.data.returnReasons),
    returnPolicyNote: parsed.data.returnPolicyNote.trim(),
    refundPolicyNote: parsed.data.refundPolicyNote.trim(),
    // The four dead refund columns, neutralised on every save.
    //
    // Nothing reads them — `computeRefund` cannot even be handed a fee — so
    // this is not what makes refunds full. It is what stops a value left over
    // from the old policy sitting in the database looking like a live rule to
    // the next person who opens the table. One writer, one truthful row.
    refundFeePercent: 0,
    refundFeeFlat: 0,
    partialAdvanceRefundable: false,
    waiveRefundFeeOnOurFault: true,
  };

  try {
    await prisma.siteSettings.upsert({
      where: { id: "main" },
      update: data,
      create: { id: "main", ...data },
    });
  } catch (err) {
    console.error("[returns] updateReturnDefaults failed:", err);
    return { ok: false as const, error: "Could not save the policy — please try again." };
  }

  // The window and the reason list are read on the order page, the product
  // pages and the shipping-and-returns page, so invalidate the whole layout.
  revalidatePath("/", "layout");
  revalidatePath("/admin/returns");
  return { ok: true as const, returnReasons: data.returnReasons };
}

/**
 * How the catalogue currently answers "is this returnable?".
 *
 * Three states, not two: a product can say yes, say no, or say nothing and
 * inherit `defaultReturnable`. The admin needs to see the split before a bulk
 * write, because "make everything returnable" and "let everything inherit"
 * look identical on screen until the store default is later flipped.
 */
export async function returnableBreakdown() {
  await requireAdminRead();
  const [inherit, yes, no] = await Promise.all([
    prisma.product.count({ where: { returnable: null } }),
    prisma.product.count({ where: { returnable: true } }),
    prisma.product.count({ where: { returnable: false } }),
  ]).catch(() => [0, 0, 0]);
  return { inherit, yes, no, total: inherit + yes + no };
}

/** The three answers a product can give. `inherit` is NULL, not `false`. */
export type ReturnableMode = "yes" | "no" | "inherit";

/** One row of the catalogue picker. Deliberately tiny — 22 products today, but
 *  this list is rendered in full and filtered in the browser. */
export type ReturnableProduct = {
  id: string;
  name: string;
  category: string;
  /** NULL = inherits `defaultReturnable`. */
  returnable: boolean | null;
  /** Made-to-order: non-returnable while `returnable` is NULL, whatever the
   *  store default says. The row has to show that or the state looks wrong. */
  isCustomisable: boolean;
  isActive: boolean;
};

/**
 * Every product with just the columns the returnable picker needs.
 *
 * Read in one query and filtered client-side rather than round-tripping per
 * keystroke: the catalogue is ~22 rows, and a search that pauses is worse than
 * one that over-fetches 22 names.
 */
export async function listReturnableProducts(): Promise<ReturnableProduct[]> {
  await requireAdminRead();
  try {
    return await prisma.product.findMany({
      orderBy: [{ category: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        category: true,
        returnable: true,
        isCustomisable: true,
        isActive: true,
      },
    });
  } catch (err) {
    console.error("[returns] listReturnableProducts failed:", err);
    return [];
  }
}

/**
 * Set `Product.returnable` on **named products only**.
 *
 * The catalogue-wide write (`bulkSetReturnable`) stays, but it is no longer the
 * only option: "make this one final-sale drop non-returnable" was previously
 * either 22 trips through the product editor or a write that hit everything.
 *
 * Ids are filtered against the catalogue rather than trusted, so a stale tab
 * holding a deleted id updates the rows that still exist instead of failing the
 * whole call.
 */
export async function setReturnableForProducts(
  ids: string[],
  mode: ReturnableMode
) {
  await requireAdmin("setReturnableForProducts");
  if (mode !== "yes" && mode !== "no" && mode !== "inherit") {
    return { ok: false as const, error: "Unknown option" };
  }
  const unique = [...new Set((ids ?? []).filter((id) => typeof id === "string" && id))];
  if (unique.length === 0) {
    return { ok: false as const, error: "Pick at least one product first." };
  }

  const returnable = mode === "inherit" ? null : mode === "yes";

  try {
    const res = await prisma.product.updateMany({
      where: { id: { in: unique } },
      data: { returnable },
    });
    // Product pages render the returns block, so the whole layout is stale.
    revalidatePath("/", "layout");
    revalidatePath("/admin/returns");
    revalidatePath("/admin/products");
    return { ok: true as const, updated: res.count };
  } catch (err) {
    console.error("[returns] setReturnableForProducts failed:", err);
    return {
      ok: false as const,
      error: "Could not update those products — please try again.",
    };
  }
}

/**
 * Bulk-set `Product.returnable` across the whole catalogue.
 *
 * The per-product control is the normal way to do this; here for the cases
 * where it isn't practical — turning returns off across a sale, or undoing a
 * one-by-one mess.
 *
 * `"inherit"` writes NULL, which is the important one: it hands control back
 * to `defaultReturnable` instead of freezing today's answer onto every row.
 * Setting every product to an explicit true/false would mean a later change to
 * the store default silently did nothing, which is the trap this option exists
 * to avoid.
 */
export async function bulkSetReturnable(mode: ReturnableMode) {
  await requireAdmin("bulkSetReturnable");
  if (mode !== "yes" && mode !== "no" && mode !== "inherit") {
    return { ok: false as const, error: "Unknown option" };
  }

  const returnable = mode === "inherit" ? null : mode === "yes";

  try {
    const res = await prisma.product.updateMany({ data: { returnable } });
    // Product pages render the returns block, so the whole layout is stale.
    revalidatePath("/", "layout");
    revalidatePath("/admin/returns");
    revalidatePath("/admin/products");
    return { ok: true as const, updated: res.count };
  } catch (err) {
    console.error("[returns] bulkSetReturnable failed:", err);
    return { ok: false as const, error: "Could not update the catalogue — please try again." };
  }
}

/** Exposed for the admin filter tabs so the list and the UI can't drift. */
export async function returnStatusCounts() {
  await requireAdminRead();
  const grouped = await prisma.returnRequest
    .groupBy({ by: ["status"], _count: { _all: true } })
    .catch(() => [] as { status: string; _count: { _all: number } }[]);
  const counts: Record<string, number> = { all: 0 };
  for (const s of RETURN_STATUSES) counts[s] = 0;
  for (const g of grouped) {
    counts[g.status] = g._count._all;
    counts.all += g._count._all;
  }
  return counts;
}
