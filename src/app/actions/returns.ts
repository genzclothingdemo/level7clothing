"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getAdminSession } from "@/lib/auth";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { draftReturnPickup } from "@/lib/fulfilment";
import {
  DEFAULT_REFUND_SETTINGS,
  MAX_REFUND_REFERENCE_LENGTH,
  MAX_RETURN_REASONS,
  MAX_RETURN_REASON_LENGTH,
  REFUND_METHODS,
  RETURN_STATUSES,
  computeRefund,
  evaluateReturnEligibility,
  formatReturnDate,
  generateReturnNumber,
  isReturnStatus,
  matchReturnReason,
  normaliseReturnReasons,
  normaliseUpiId,
  type RefundMethod,
  type RefundOrder,
  type RefundSettings,
  type ReturnBlock,
} from "@/lib/returns";

async function requireAdmin() {
  const session = await getAdminSession();
  if (!session) throw new Error("Unauthorized");
  return session;
}

/* ------------------------------------------------------------ policy read */

type ReturnSettings = {
  returnsEnabled: boolean;
  defaultReturnable: boolean;
  returnWindowDays: number;
  returnReasons: string[];
  returnPolicyNote: string;
  /** The money rules, read from the same row in the same query. */
  refund: RefundSettings;
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
        refundFeePercent: true,
        refundFeeFlat: true,
        partialAdvanceRefundable: true,
        waiveRefundFeeOnOurFault: true,
        refundPolicyNote: true,
      },
    });
    return {
      returnsEnabled: row?.returnsEnabled ?? DEFAULT_SETTINGS.returnsEnabled,
      defaultReturnable: row?.defaultReturnable ?? DEFAULT_SETTINGS.defaultReturnable,
      returnWindowDays: row?.returnWindowDays ?? DEFAULT_SETTINGS.returnWindowDays,
      returnReasons: normaliseReturnReasons(row?.returnReasons),
      returnPolicyNote: (row?.returnPolicyNote ?? "").trim(),
      // A missing row means a fresh database, so the schema defaults apply —
      // which for the fee means zero. Never invent a deduction.
      refund: {
        refundFeePercent:
          row?.refundFeePercent ?? DEFAULT_REFUND_SETTINGS.refundFeePercent,
        refundFeeFlat: row?.refundFeeFlat ?? DEFAULT_REFUND_SETTINGS.refundFeeFlat,
        partialAdvanceRefundable:
          row?.partialAdvanceRefundable ??
          DEFAULT_REFUND_SETTINGS.partialAdvanceRefundable,
        waiveRefundFeeOnOurFault:
          row?.waiveRefundFeeOnOurFault ??
          DEFAULT_REFUND_SETTINGS.waiveRefundFeeOnOurFault,
      },
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
  discountTotal: true,
  status: true,
  paymentStatus: true,
} as const;

function revalidateReturns(orderNumber?: string | null) {
  revalidatePath("/admin/returns");
  revalidatePath("/admin");
  if (orderNumber) revalidatePath(`/order/${orderNumber}`);
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
        statusHistory: [
          {
            status: "pending",
            note: "Requested by customer",
            at: new Date().toISOString(),
          },
        ] as unknown as object[],
      },
      select: { requestNumber: true },
    });
    revalidateReturns(order.orderNumber);
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
   * preview update live as they change the reason (the our-fault waiver), with
   * no extra round trip and no second implementation of the maths.
   *
   * Null only when the order could not be read.
   */
  refund: {
    order: RefundOrder;
    settings: RefundSettings;
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
    refund: {
      order: refundOrderFrom(order, order.returnRequests),
      settings: settings.refund,
      note: settings.refundPolicyNote,
    },
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
 * recomputed**. Raise the store's fee next month and this row still says what
 * was decided today, which is the only way a refund history can be audited.
 *
 * On approval the reverse pickup is drafted with NimbusPost. That call is
 * allowed to fail without failing the approval — the decision is ours, the
 * courier booking is a third party. When it fails, `nimbusError` is stored and
 * returned so the admin sees "approved, pickup NOT booked" rather than a green
 * tick hiding a broken pickup.
 */
export async function decideReturn(input: DecideReturnInput) {
  await requireAdmin();
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
    return {
      ok: true as const,
      status: "rejected",
      refund: null,
      pickupBooked: false,
      pickupIssue: null,
    };
  }

  /* ------------------------------------------------------------ approval */
  const settings = await readReturnSettings();
  if (!settings) {
    return {
      ok: false as const,
      error: "Couldn't read the refund policy just now — try again in a moment.",
    };
  }

  const refundOrder = refundOrderFrom(
    existing.order,
    existing.order.returnRequests,
    existing.id
  );
  const computed = computeRefund({
    order: refundOrder,
    lines: [{ unitPrice: existing.unitPrice, quantity: existing.quantity }],
    settings: settings.refund,
    reason: existing.reason,
  });

  // The hard ceiling, independent of the line maths: what is left of the money
  // this customer actually parted with, once the non-refundable advance and
  // earlier refunds are subtracted. An override may go above the computed net
  // (goodwill, return postage) but never above this.
  const ceiling = computed.payable;

  let net = computed.net;
  let gross = computed.gross;
  let fee = computed.fee;
  let overrideNote: string | null = null;

  const wants = data.refundOverride;
  if (typeof wants === "number" && wants !== computed.net) {
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
    // Keep the gross honest: the store can't "keep" a negative fee, and an
    // above-computed payout simply means no fee was taken.
    gross = Math.max(computed.gross, net);
    fee = Math.max(0, gross - net);
    overrideNote = `Refund set to ${net} by hand (computed ${computed.net}): ${data.overrideReason.trim()}`;
  }

  const upi = data.refundUpi?.trim() ? normaliseUpiId(data.refundUpi) : null;
  if (data.refundUpi?.trim() && !upi) {
    return { ok: false as const, error: "That doesn't look like a UPI ID (name@bank)." };
  }

  const method: RefundMethod = data.refundMethod ?? computed.method;

  const history = readHistory(existing.statusHistory);
  history.push({
    status: "approved",
    note:
      [data.adminNote?.trim(), overrideNote].filter(Boolean).join(" · ") || undefined,
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

  return {
    ok: true as const,
    status: "approved",
    refund: { gross, fee, net, method },
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
 */
export async function markRefundPaid(input: MarkRefundPaidInput) {
  await requireAdmin();
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

  // Backfill for a request approved before this screen existed.
  let gross = existing.refundGross;
  let fee = existing.refundFee;
  let net = existing.refundAmount;
  if (net == null) {
    const settings = await readReturnSettings();
    if (!settings) {
      return {
        ok: false as const,
        error: "Couldn't read the refund policy just now — try again in a moment.",
      };
    }
    const computed = computeRefund({
      order: refundOrderFrom(
        existing.order,
        existing.order.returnRequests,
        existing.id
      ),
      lines: [{ unitPrice: existing.unitPrice, quantity: existing.quantity }],
      settings: settings.refund,
      reason: existing.reason,
    });
    gross = computed.gross;
    fee = computed.fee;
    net = computed.net;
  }

  const method: RefundMethod =
    data.method ?? (existing.refundMethod as RefundMethod | null) ?? "original";

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
  // A replacement moves goods, not money, and a ₹0 payout has nothing to look
  // up — everything else must leave a trail.
  if (!reference && net > 0 && method !== "replacement" && method !== "none") {
    return {
      ok: false as const,
      error: "Add the payment reference (UTR) so the customer can trace it.",
    };
  }

  const now = new Date();
  const history = readHistory(existing.statusHistory);
  history.push({
    status: "refunded",
    note:
      [
        net > 0 ? `Refund of ${net} paid by ${method}` : "Closed with no payout",
        reference ? `ref ${reference}` : null,
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
  await requireAdmin();
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
  return { ok: true as const };
}

/** Retry a reverse pickup that failed (bad pincode, wallet, Nimbus outage). */
export async function retryReturnPickup(id: string) {
  await requireAdmin();
  // Clear the stale draft id so `draftReturnPickup` doesn't short-circuit on
  // "already staged" when a previous attempt half-succeeded.
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

export async function deleteReturnRequest(id: string) {
  await requireAdmin();
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
  // 0–50%. Capped well below 100 on purpose: a fee that swallows the whole
  // refund is a mis-typed setting, not a policy, and the customer-facing
  // maths clamps it anyway.
  refundFeePercent: z.coerce.number().int().min(0).max(50).default(0),
  refundFeeFlat: z.coerce.number().int().min(0).max(10000).default(0),
  partialAdvanceRefundable: z.boolean().default(false),
  waiveRefundFeeOnOurFault: z.boolean().default(true),
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
  await requireAdmin();
  const parsed = defaultsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0].message };
  }
  const data = {
    ...parsed.data,
    returnReasons: normaliseReturnReasons(parsed.data.returnReasons),
    returnPolicyNote: parsed.data.returnPolicyNote.trim(),
    refundPolicyNote: parsed.data.refundPolicyNote.trim(),
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

/** Exposed for the admin filter tabs so the list and the UI can't drift. */
export async function returnStatusCounts() {
  await requireAdmin();
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
