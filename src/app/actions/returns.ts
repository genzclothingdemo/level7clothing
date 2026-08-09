"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getAdminSession } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { draftReturnPickup } from "@/lib/fulfilment";
import {
  RETURN_STATUSES,
  generateReturnNumber,
  isReturnReason,
  isReturnStatus,
  resolveReturnPolicy,
  returnWindow,
} from "@/lib/returns";

async function requireAdmin() {
  const session = await getAdminSession();
  if (!session) throw new Error("Unauthorized");
  return session;
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
  reason: z.string().refine(isReturnReason, "Pick a reason"),
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
 * Every eligibility rule is re-checked here rather than trusted from the form:
 * the page that renders the button can be stale, and the item index, quantity
 * and window all come from the client.
 */
export async function requestReturn(input: RequestReturnInput) {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0].message };
  }
  const data = parsed.data;

  const [order, settings] = await Promise.all([
    prisma.order
      .findUnique({
        where: { orderNumber: data.orderNumber },
        include: { returnRequests: true },
      })
      .catch(() => null),
    getSettings(),
  ]);
  if (!order) return { ok: false as const, error: "Order not found" };

  const items = (Array.isArray(order.items) ? order.items : []) as unknown as OrderItem[];
  const item = items[data.itemIndex];
  if (!item) return { ok: false as const, error: "That item isn't on this order" };

  const product = item.productId
    ? await prisma.product
        .findUnique({
          where: { id: item.productId },
          select: { returnable: true, returnsInfo: true },
        })
        .catch(() => null)
    : null;

  const policy = resolveReturnPolicy(product ?? {}, settings);
  if (!policy.returnable) {
    return {
      ok: false as const,
      error:
        policy.reason === "store_disabled"
          ? "Returns are currently closed. Please contact us directly."
          : "This piece is made to order and can't be returned.",
    };
  }

  const win = returnWindow(order, policy.windowDays, new Date());
  if (!win.open) {
    return {
      ok: false as const,
      error: win.deliveredAt
        ? `The ${policy.windowDays}-day return window for this order has closed.`
        : "Returns can be raised once the order has been delivered.",
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
        reason: data.reason,
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
  returnWindowDays: z.coerce.number().int().min(1).max(90),
  defaultReturnsInfo: z.string().default(""),
});

export type ReturnDefaultsInput = z.input<typeof defaultsSchema>;

/**
 * The store-wide return policy. Lives here rather than in Branding & settings so
 * there is exactly one screen that owns returns — the same "one editor per
 * field" rule the product images follow.
 */
export async function updateReturnDefaults(input: ReturnDefaultsInput) {
  await requireAdmin();
  const parsed = defaultsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0].message };
  }
  const data = parsed.data;
  await prisma.siteSettings.upsert({
    where: { id: "main" },
    update: data,
    create: { id: "main", ...data },
  });
  revalidatePath("/", "layout");
  revalidatePath("/admin/returns");
  return { ok: true as const };
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
