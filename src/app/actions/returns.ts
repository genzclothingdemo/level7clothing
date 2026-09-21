"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getAdminSession } from "@/lib/auth";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { draftReturnPickup } from "@/lib/fulfilment";
import {
  MAX_RETURN_REASONS,
  MAX_RETURN_REASON_LENGTH,
  RETURN_STATUSES,
  evaluateReturnEligibility,
  formatReturnDate,
  generateReturnNumber,
  isReturnStatus,
  matchReturnReason,
  normaliseReturnReasons,
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
      },
    });
    return {
      returnsEnabled: row?.returnsEnabled ?? DEFAULT_SETTINGS.returnsEnabled,
      defaultReturnable: row?.defaultReturnable ?? DEFAULT_SETTINGS.defaultReturnable,
      returnWindowDays: row?.returnWindowDays ?? DEFAULT_SETTINGS.returnWindowDays,
      returnReasons: normaliseReturnReasons(row?.returnReasons),
      returnPolicyNote: (row?.returnPolicyNote ?? "").trim(),
    };
  } catch (err) {
    console.error("[returns] could not read the return policy:", err);
    return null;
  }
}

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
        status: true,
        createdAt: true,
        deliveryStatusAt: true,
        items: true,
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
  };
}

/* --------------------------------------------------------------- admin side */

const decideSchema = z.object({
  id: z.string().min(1),
  approve: z.boolean(),
  /** Shown to the customer on their order page. */
  adminNote: z.string().trim().max(1000).optional(),
  refundAmount: z.coerce.number().int().min(0).nullable().optional(),
  refundMethod: z.enum(["original", "upi", "bank", "replacement"]).nullable().optional(),
  /** Book the reverse pickup with NimbusPost on approval. */
  bookPickup: z.boolean().default(true),
});

export type DecideReturnInput = z.input<typeof decideSchema>;

/**
 * Approve or reject a return.
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
    include: { order: { select: { orderNumber: true } } },
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

  const status = data.approve ? "approved" : "rejected";
  const history = readHistory(existing.statusHistory);
  history.push({
    status,
    note: data.adminNote?.trim() || undefined,
    at: new Date().toISOString(),
    by: "admin",
  });

  await prisma.returnRequest.update({
    where: { id: data.id },
    data: {
      status,
      adminNote: data.adminNote?.trim() || null,
      refundAmount: data.approve ? data.refundAmount ?? null : null,
      refundMethod: data.approve ? data.refundMethod ?? null : null,
      resolvedAt: data.approve ? null : new Date(),
      statusHistory: history as unknown as object[],
    },
  });

  let pickup: { ok: boolean; error?: string; skipped?: string } | null = null;
  if (data.approve && data.bookPickup) {
    pickup = await draftReturnPickup(data.id);
  }

  revalidateReturns(existing.order.orderNumber);

  return {
    ok: true as const,
    status,
    pickupBooked: pickup?.ok ?? false,
    pickupIssue: pickup && !pickup.ok ? pickup.error ?? pickup.skipped ?? null : null,
  };
}

/** Move an approved return along its lifecycle (picked up → received → refunded). */
export async function setReturnStatus(id: string, status: string, note?: string) {
  await requireAdmin();
  if (!isReturnStatus(status)) {
    return { ok: false as const, error: "Unknown status" };
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
