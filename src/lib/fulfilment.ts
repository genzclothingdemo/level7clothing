import { prisma } from "./prisma";
import { getSettings } from "./settings";
import {
  isNimbusPostConfigured,
  createDraftOrder,
  getOrderState,
  shipDraft,
  type ShipmentInput,
} from "./nimbuspost";

/**
 * Order fulfilment glue between the order/admin actions and the NimbusPost
 * client. Kept out of the "use server" action files so it can export plain
 * (non-action) helpers used by both.
 */

type OrderItem = {
  productId?: string;
  name: string;
  quantity: number;
  price: number;
};

/** Build the parcel + consignee payload for an order, incl. per-product size. */
async function buildShipmentInput(orderId: string): Promise<ShipmentInput | null> {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return null;

  const items = (Array.isArray(order.items) ? order.items : []) as unknown as OrderItem[];

  // Sum per-unit weights and take the largest dimensions across the products
  // that specify them; anything unset falls back to the env defaults.
  const ids = items.map((i) => i.productId).filter(Boolean) as string[];
  const products = ids.length
    ? await prisma.product.findMany({
        where: { id: { in: ids } },
        select: { id: true, weightGrams: true, lengthCm: true, breadthCm: true, heightCm: true },
      })
    : [];
  const byId = new Map(products.map((p) => [p.id, p]));

  let weight = 0;
  let length = 0;
  let breadth = 0;
  let height = 0;
  for (const it of items) {
    const p = it.productId ? byId.get(it.productId) : undefined;
    if (p?.weightGrams) weight += p.weightGrams * it.quantity;
    if (p?.lengthCm) length = Math.max(length, p.lengthCm);
    if (p?.breadthCm) breadth = Math.max(breadth, p.breadthCm);
    if (p?.heightCm) height = Math.max(height, p.heightCm);
  }

  // Remaining COD to collect (balanceDue); zero → prepaid shipment.
  const cod = order.balanceDue > 0;

  return {
    orderNumber: order.orderNumber,
    paymentType: cod ? "cod" : "prepaid",
    orderAmount: cod ? order.balanceDue : order.total,
    consignee: {
      name: order.customerName,
      address: order.address,
      city: order.city,
      state: order.state,
      pincode: order.pincode,
      phone: order.phone,
    },
    items: items.map((i) => ({ name: i.name, qty: i.quantity, price: i.price })),
    parcel: {
      weight: weight || undefined,
      length: length || undefined,
      breadth: breadth || undefined,
      height: height || undefined,
    },
  };
}

/**
 * Stage a NimbusPost DRAFT order for an order (called when an order is
 * confirmed). Best-effort: silently skips when shipping is off/unconfigured or
 * a draft/AWB already exists. Never throws to the caller's happy path.
 */
export async function createDraftForOrder(
  orderId: string
): Promise<{ ok: boolean; skipped?: string; nimbusOrderId?: string; error?: string }> {
  const settings = await getSettings();
  if (!settings.nimbusEnabled) return { ok: false, skipped: "shipping disabled" };
  if (!isNimbusPostConfigured()) return { ok: false, skipped: "not configured" };

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return { ok: false, error: "Order not found" };
  if (order.nimbusShipmentId || order.trackingNumber) {
    return { ok: true, skipped: "already staged", nimbusOrderId: order.nimbusShipmentId ?? undefined };
  }

  const input = await buildShipmentInput(orderId);
  if (!input) return { ok: false, error: "Order not found" };

  try {
    const nimbusOrderId = await createDraftOrder(input);
    const history = Array.isArray(order.statusHistory)
      ? (order.statusHistory as unknown as { status: string; note?: string; at: string }[])
      : [];
    history.push({
      status: order.status,
      note: "Draft shipment created in NimbusPost — ready to dispatch",
      at: new Date().toISOString(),
    });
    await prisma.order.update({
      where: { id: orderId },
      data: { nimbusShipmentId: nimbusOrderId, statusHistory: history as unknown as object[] },
    });
    return { ok: true, nimbusOrderId };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type DispatchResult =
  | { ok: true; outcome: "booked"; awb: string; courier: string | null }
  | { ok: true; outcome: "drafted"; nimbusOrderId: string }
  | { ok: false; error: string };

/**
 * Book a staged draft → allocates the courier, generates the AWB and charges
 * the NimbusPost wallet.
 *
 * Deliberately CANNOT create-and-book in one call. Every order must exist in
 * NimbusPost as an unbooked draft first so a human can review it there (or
 * here) before any money moves. If no draft is staged yet this stages one and
 * stops, returning `outcome: "drafted"` — booking then needs a second,
 * separate action.
 */
export async function dispatchOrder(orderId: string): Promise<DispatchResult> {
  const settings = await getSettings();
  if (!settings.nimbusEnabled) {
    return { ok: false, error: "NimbusPost shipping is turned off. Enable it in Admin → Settings." };
  }
  if (!isNimbusPostConfigured()) {
    return {
      ok: false,
      error:
        "NimbusPost isn't set up. Add NIMBUSPOST_API_KEY, NIMBUSPOST_API_SECRET and NIMBUSPOST_WAREHOUSE_NAME.",
    };
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return { ok: false, error: "Order not found" };
  if (order.trackingNumber) {
    return { ok: false, error: `This order already has an AWB (${order.trackingNumber}).` };
  }

  // No draft yet → stage one and stop. Booking is a separate, deliberate act.
  if (!order.nimbusShipmentId) {
    const staged = await createDraftForOrder(orderId);
    if (!staged.ok || !staged.nimbusOrderId) {
      return {
        ok: false,
        error:
          staged.error ??
          `Could not stage a draft in NimbusPost (${staged.skipped ?? "unknown reason"}).`,
      };
    }
    return { ok: true, outcome: "drafted", nimbusOrderId: staged.nimbusOrderId };
  }

  try {
    const result = await shipDraft(order.nimbusShipmentId);

    const history = Array.isArray(order.statusHistory)
      ? (order.statusHistory as unknown as { status: string; note?: string; at: string }[])
      : [];
    history.push({
      status: "shipped",
      note: `Dispatched via NimbusPost${result.courierName ? ` (${result.courierName})` : ""} — AWB ${result.awb}`,
      at: new Date().toISOString(),
    });

    await prisma.order.update({
      where: { id: orderId },
      data: {
        status: "shipped",
        courier: result.courierName,
        trackingNumber: result.awb,
        trackingUrl: result.trackingUrl,
        nimbusShipmentId: result.shipmentId ?? order.nimbusShipmentId,
        statusHistory: history as unknown as object[],
      },
    });

    return {
      ok: true,
      outcome: "booked",
      awb: result.awb,
      courier: result.courierName,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type SyncResult =
  | { ok: true; outcome: "synced"; awb: string; courier: string | null }
  | { ok: true; outcome: "not-booked"; orderStatus: string }
  | { ok: false; error: string };

/**
 * Pull a booking made outside this admin — i.e. someone reviewed the draft in
 * the NimbusPost dashboard and booked it there. Without this the AWB never
 * reaches our database, so the customer gets no tracking and the status webhook
 * (which matches on AWB) can never find the order.
 */
export async function syncOrderFromNimbus(orderId: string): Promise<SyncResult> {
  if (!isNimbusPostConfigured()) {
    return { ok: false, error: "NimbusPost isn't configured." };
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return { ok: false, error: "Order not found" };
  if (!order.nimbusShipmentId) {
    return { ok: false, error: "No NimbusPost draft is staged for this order yet." };
  }

  try {
    const state = await getOrderState(order.nimbusShipmentId);
    if (!state.booked || !state.awb) {
      return { ok: true, outcome: "not-booked", orderStatus: state.orderStatus };
    }

    // Already recorded — nothing to do, and don't re-append history.
    if (order.trackingNumber === state.awb) {
      return { ok: true, outcome: "synced", awb: state.awb, courier: state.courierName };
    }

    const history = Array.isArray(order.statusHistory)
      ? (order.statusHistory as unknown as { status: string; note?: string; at: string }[])
      : [];
    history.push({
      status: "shipped",
      note: `Booked in the NimbusPost dashboard${state.courierName ? ` (${state.courierName})` : ""} — AWB ${state.awb}`,
      at: new Date().toISOString(),
    });

    await prisma.order.update({
      where: { id: orderId },
      data: {
        status: "shipped",
        courier: state.courierName,
        trackingNumber: state.awb,
        trackingUrl: state.trackingUrl,
        statusHistory: history as unknown as object[],
      },
    });

    return { ok: true, outcome: "synced", awb: state.awb, courier: state.courierName };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
