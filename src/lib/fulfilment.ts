import { prisma } from "./prisma";
import { getSettings } from "./settings";
import {
  isNimbusPostConfigured,
  createDraftOrder,
  createReverseDraftOrder,
  getOrderState,
  listCourierOptions,
  shipDraft,
  trackShipment,
  type CourierOption,
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

/**
 * Stage a DRAFT reverse pickup for an approved return: the courier collects from
 * the customer's address and brings the parcel back to our warehouse.
 *
 * Deliberately NOT best-effort-silent like `createDraftForOrder`. A forward draft
 * that fails is recoverable — the admin sees the order sitting unshipped. An
 * approved return whose pickup was never booked looks *done* in the admin while
 * the customer waits for a courier that will never arrive. So every outcome is
 * recorded on the request (`nimbusError` on failure, cleared on success) and the
 * message is returned for the UI to show.
 *
 * The return itself stays approved either way — the customer's decision must not
 * depend on a third-party API being up.
 */
export async function draftReturnPickup(
  returnId: string
): Promise<{ ok: boolean; skipped?: string; nimbusOrderId?: string; error?: string }> {
  const settings = await getSettings();

  const req = await prisma.returnRequest.findUnique({
    where: { id: returnId },
    include: { order: true },
  });
  if (!req) return { ok: false, error: "Return request not found" };
  if (req.nimbusOrderId || req.nimbusAwb) {
    return { ok: true, skipped: "already staged", nimbusOrderId: req.nimbusOrderId ?? undefined };
  }

  const note = async (error: string | null) => {
    await prisma.returnRequest.update({
      where: { id: returnId },
      data: { nimbusError: error },
    });
  };

  if (!settings.nimbusEnabled) {
    await note("NimbusPost shipping is switched off in settings — book the pickup manually.");
    return { ok: false, skipped: "shipping disabled" };
  }
  if (!isNimbusPostConfigured()) {
    await note("NimbusPost credentials are missing — book the pickup manually.");
    return { ok: false, skipped: "not configured" };
  }

  // Parcel size comes from the returned product when it has one on file.
  const product = req.productId
    ? await prisma.product.findUnique({
        where: { id: req.productId },
        select: { weightGrams: true, lengthCm: true, breadthCm: true, heightCm: true },
      })
    : null;

  try {
    const nimbusOrderId = await createReverseDraftOrder({
      returnNumber: req.requestNumber,
      // Declared value of what is travelling, not what was refunded.
      orderAmount: Math.max(0, req.unitPrice * req.quantity),
      pickupFrom: {
        name: req.order.customerName,
        address: req.order.address,
        city: req.order.city,
        state: req.order.state,
        pincode: req.order.pincode,
        phone: req.order.phone,
      },
      items: [
        { name: req.productName, qty: req.quantity, price: req.unitPrice },
      ],
      parcel: {
        weight: product?.weightGrams ? product.weightGrams * req.quantity : undefined,
        length: product?.lengthCm ?? undefined,
        breadth: product?.breadthCm ?? undefined,
        height: product?.heightCm ?? undefined,
      },
    });

    await prisma.returnRequest.update({
      where: { id: returnId },
      data: { nimbusOrderId, nimbusError: null },
    });
    return { ok: true, nimbusOrderId };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    // A "pincode not recognized" rejection on a REVERSE order is misleading: the
    // same pincode usually ships fine on the forward leg, so the admin starts
    // doubting the customer's address. It normally means reverse pickup isn't
    // serviceable there (or the reverse endpoint wants the pickup address under a
    // different key) — say so, and keep the raw message with its requestId.
    const message = /pincode/i.test(raw)
      ? `${raw} — note this address ships fine on the forward leg, so this is usually reverse-pickup serviceability rather than a bad address. Check reverse serviceability for this pincode with NimbusPost (quote the requestId) and arrange the pickup manually meanwhile.`
      : raw;
    await note(message);
    return { ok: false, error: message };
  }
}

/**
 * The couriers that will carry this order, cheapest first, for the admin to
 * review before booking. Quoted from the order's real pincode and parcel, so
 * the prices shown are the prices the wallet gets charged.
 */
export async function getCourierOptionsForOrder(
  orderId: string
): Promise<
  | { ok: true; options: CourierOption[]; pincode: string; paymentType: "prepaid" | "cod" }
  | { ok: false; error: string }
> {
  if (!isNimbusPostConfigured()) {
    return { ok: false, error: "NimbusPost isn't configured." };
  }
  const input = await buildShipmentInput(orderId);
  if (!input) return { ok: false, error: "Order not found" };

  const p = input.parcel ?? {};
  const options = await listCourierOptions({
    destinationPincode: input.consignee.pincode,
    weightGrams: p.weight ?? 0,
    lengthCm: p.length ?? 0,
    breadthCm: p.breadth ?? 0,
    heightCm: p.height ?? 0,
    paymentType: input.paymentType,
    orderValueRupees: input.orderAmount,
  });

  if (!options.length) {
    return {
      ok: false,
      error: `No courier services ${input.consignee.pincode} for this parcel.`,
    };
  }
  return {
    ok: true,
    options,
    pincode: input.consignee.pincode,
    paymentType: input.paymentType,
  };
}

/** Remember the courier the admin picked, so booking can use it later. */
export async function chooseCourierForOrder(
  orderId: string,
  courierId: string | null,
  courierName: string | null
) {
  await prisma.order.update({
    where: { id: orderId },
    data: { nimbusCourierId: courierId, nimbusCourierName: courierName },
  });
}

export type DispatchResult =
  | {
      ok: true;
      outcome: "booked";
      awb: string;
      courier: string | null;
      /** Set when NimbusPost allocated a courier other than the one requested. */
      courierMismatch?: string;
    }
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
    const result = await shipDraft(order.nimbusShipmentId, order.nimbusCourierId);

    // NimbusPost is the authority on who actually carries the parcel. If it
    // allocated someone else, say so rather than letting the admin believe the
    // courier they picked is the one that will collect.
    const wanted = order.nimbusCourierName?.trim();
    const got = result.courierName?.trim();
    const courierMismatch =
      wanted && got && wanted.toLowerCase() !== got.toLowerCase()
        ? `You chose ${wanted}, but NimbusPost booked ${got}.`
        : undefined;

    const history = Array.isArray(order.statusHistory)
      ? (order.statusHistory as unknown as { status: string; note?: string; at: string }[])
      : [];
    history.push({
      status: "shipped",
      note: `Dispatched via NimbusPost${got ? ` (${got})` : ""} — AWB ${result.awb}`,
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
        lastSyncedAt: new Date(),
      },
    });

    return {
      ok: true,
      outcome: "booked",
      awb: result.awb,
      courier: result.courierName,
      courierMismatch,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type SyncResult =
  | { ok: true; outcome: "synced"; awb: string; courier: string | null }
  | { ok: true; outcome: "not-booked"; orderStatus: string }
  | {
      ok: true;
      outcome: "tracked";
      awb: string;
      deliveryStatus: string | null;
      orderStatus: string;
    }
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
  if (!order.nimbusShipmentId && !order.trackingNumber) {
    return { ok: false, error: "No NimbusPost draft is staged for this order yet." };
  }

  // Already has an AWB → there is nothing left to discover about the booking,
  // so refresh where the parcel actually is instead.
  if (order.trackingNumber) {
    return refreshTracking(orderId, order.trackingNumber);
  }

  try {
    const state = await getOrderState(order.nimbusShipmentId!);
    if (!state.booked || !state.awb) {
      await prisma.order.update({
        where: { id: orderId },
        data: { lastSyncedAt: new Date() },
      });
      return { ok: true, outcome: "not-booked", orderStatus: state.orderStatus };
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
        lastSyncedAt: new Date(),
      },
    });

    return { ok: true, outcome: "synced", awb: state.awb, courier: state.courierName };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** NimbusPost tracking statuses → our order statuses. Same table the webhook uses. */
const TRACKING_TO_STATUS: Record<string, string> = {
  "pickup scheduled": "confirmed",
  "pickup done": "shipped",
  "picked up": "shipped",
  "manifest created": "confirmed",
  "in transit": "shipped",
  "reached destination": "shipped",
  "out for delivery": "shipped",
  delivered: "delivered",
  "delivery failed": "shipped",
  "rto initiated": "shipped",
  "rto in transit": "shipped",
  "rto delivered": "cancelled",
};

type TrackingPayload = {
  status?: string;
  current_status?: string;
  courier_name?: string;
  edd?: string;
  expected_delivery_date?: string;
  history?: {
    status?: string;
    message?: string;
    location?: string;
    timestamp?: string;
    event_time?: string;
  }[];
  scans?: TrackingPayload["history"];
};

/**
 * Pull the courier's latest scan for a booked AWB and mirror it onto the order.
 *
 * This is the polling half of status tracking: the webhook is push and is the
 * fast path, but it only fires if NimbusPost is configured to call us and the
 * call actually lands. Polling closes that gap, and is what makes the status
 * shown in the admin trustworthy rather than "last thing we happened to hear".
 */
export async function refreshTracking(
  orderId: string,
  awb: string
): Promise<SyncResult> {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return { ok: false, error: "Order not found" };

  try {
    const data = (await trackShipment(awb)) as TrackingPayload;
    const scans = data.history ?? data.scans ?? [];
    const latest = scans[scans.length - 1];

    const rawStatus = (
      data.current_status ??
      data.status ??
      latest?.status ??
      ""
    ).trim();
    if (!rawStatus) {
      await prisma.order.update({
        where: { id: orderId },
        data: { lastSyncedAt: new Date() },
      });
      return {
        ok: true,
        outcome: "tracked",
        awb,
        deliveryStatus: order.deliveryStatus,
        orderStatus: order.status,
      };
    }

    const mapped = TRACKING_TO_STATUS[rawStatus.toLowerCase()] ?? null;
    // Never walk a delivered order backwards on a late or duplicate scan.
    const nextStatus =
      order.status === "delivered" ? "delivered" : (mapped ?? order.status);

    const location = latest?.location?.trim() || null;
    const at = latest?.timestamp ?? latest?.event_time;
    const scannedAt = at && !Number.isNaN(Date.parse(at)) ? new Date(at) : new Date();

    const changed =
      rawStatus !== (order.deliveryStatus ?? "") || nextStatus !== order.status;

    const history = Array.isArray(order.statusHistory)
      ? (order.statusHistory as unknown as { status: string; note?: string; at: string }[])
      : [];
    if (changed) {
      history.push({
        status: nextStatus,
        note: `NimbusPost: ${rawStatus}${location ? ` — ${location}` : ""}`,
        at: scannedAt.toISOString(),
      });
    }

    await prisma.order.update({
      where: { id: orderId },
      data: {
        status: nextStatus,
        deliveryStatus: rawStatus,
        deliveryLocation: location,
        deliveryStatusAt: scannedAt,
        lastSyncedAt: new Date(),
        ...(data.courier_name && !order.courier ? { courier: data.courier_name } : {}),
        ...(changed ? { statusHistory: history as unknown as object[] } : {}),
      },
    });

    // Tell the customer only when the order itself moved to a milestone.
    if (changed && nextStatus !== order.status) {
      await notifyStatus(orderId, nextStatus).catch((err) =>
        console.error("[fulfilment] tracking email failed:", err)
      );
    }

    return {
      ok: true,
      outcome: "tracked",
      awb,
      deliveryStatus: rawStatus,
      orderStatus: nextStatus,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const NOTIFY_STATUSES = new Set(["shipped", "delivered", "cancelled"]);

async function notifyStatus(orderId: string, status: string) {
  if (!NOTIFY_STATUSES.has(status)) return;
  const [{ sendOrderStatusEmail }, order, settings] = await Promise.all([
    import("./email"),
    prisma.order.findUnique({ where: { id: orderId } }),
    getSettings(),
  ]);
  if (!order) return;
  await sendOrderStatusEmail(settings, {
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    email: order.email,
    status,
    courier: order.courier,
    trackingNumber: order.trackingNumber,
    trackingUrl: order.trackingUrl,
  });
}

/**
 * One pass of the auto-sync: every order that could still change.
 *
 * Two populations, and they need different calls — a staged draft has no AWB
 * yet so we ask the ORDER endpoint whether someone booked it in the dashboard;
 * a booked shipment has an AWB so we ask the TRACKING endpoint where it is.
 */
export async function syncAllOpenOrders(limit = 40) {
  if (!isNimbusPostConfigured()) {
    return { ok: false as const, error: "NimbusPost isn't configured." };
  }
  const settings = await getSettings();
  if (!settings.nimbusEnabled) {
    return { ok: false as const, error: "NimbusPost shipping is turned off." };
  }

  const orders = await prisma.order.findMany({
    where: {
      status: { notIn: ["delivered", "cancelled"] },
      OR: [
        { trackingNumber: { not: null } },
        { nimbusShipmentId: { not: null } },
      ],
    },
    orderBy: { updatedAt: "asc" },
    take: limit,
    select: { id: true, orderNumber: true, trackingNumber: true },
  });

  let booked = 0;
  let tracked = 0;
  let waiting = 0;
  let failed = 0;

  for (const o of orders) {
    const res = o.trackingNumber
      ? await refreshTracking(o.id, o.trackingNumber)
      : await syncOrderFromNimbus(o.id);
    if (!res.ok) {
      failed += 1;
      console.error(`[nimbus-sync] ${o.orderNumber}: ${res.error}`);
      continue;
    }
    if (res.outcome === "synced") booked += 1;
    else if (res.outcome === "tracked") tracked += 1;
    else waiting += 1;
  }

  return { ok: true as const, checked: orders.length, booked, tracked, waiting, failed };
}
