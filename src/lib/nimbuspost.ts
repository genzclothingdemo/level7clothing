/**
 * NimbusPost (delivery) helper — server only.
 *
 * Uses the NimbusPost Partner API v2 (https://api-v2.nimbuspost.com), which
 * authenticates with an API-key PAIR sent as two headers — `x-api-key` and
 * `x-api-secret` — not a Bearer token and not the dashboard email/password.
 * Mint the pair in the dashboard → Settings → API Keys.
 *
 * Wire conventions that bite:
 *  - Order/shipment bodies are snake_case; serviceability/tracking are camelCase.
 *  - Package weight units DIFFER per surface (verified live, docs are wrong):
 *      • POST /v2/orders + /v2/shipments → KILOGRAMS (cap: 32 kg for b2c)
 *      • POST /v2/serviceability        → GRAMS
 *    Dimensions are centimetres everywhere.
 *  - `shipping_address.phone` and `pincode` are numbers, not strings.
 *  - Serviceability money is in PAISE; order money is in rupees.
 */

const BASE = "https://api-v2.nimbuspost.com";

function num(envVar: string | undefined, fallback: number): number {
  const n = Number(envVar);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function isNimbusPostConfigured(): boolean {
  return Boolean(
    process.env.NIMBUSPOST_API_KEY?.trim() && process.env.NIMBUSPOST_API_SECRET?.trim()
  );
}

function authHeaders(): Record<string, string> {
  const key = process.env.NIMBUSPOST_API_KEY?.trim();
  const secret = process.env.NIMBUSPOST_API_SECRET?.trim();
  if (!key || !secret) {
    throw new Error(
      "NimbusPost credentials missing. Set NIMBUSPOST_API_KEY and NIMBUSPOST_API_SECRET (dashboard → Settings → API Keys)."
    );
  }
  return {
    "x-api-key": key,
    "x-api-secret": secret,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

type Envelope<T> = {
  success?: boolean;
  data?: T;
  error?: { code?: string; detail?: string; title?: string };
  meta?: { requestId?: string };
};

/**
 * Call a v2 endpoint and unwrap the `{ success, data, meta }` envelope.
 * Throws with the stable `error.code` plus the requestId (quote it to support).
 */
async function np<T = Record<string, unknown>>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers ?? {}) },
    cache: "no-store",
  });

  const body = (await res.json().catch(() => ({}))) as Envelope<T>;

  if (!res.ok || body.success === false) {
    const code = body.error?.code ?? `HTTP_${res.status}`;
    const detail = body.error?.detail ?? body.error?.title ?? res.statusText;
    const rid = body.meta?.requestId ? ` [requestId ${body.meta.requestId}]` : "";
    throw new Error(`NimbusPost ${code}: ${detail}${rid}`);
  }

  return (body.data ?? ({} as T)) as T;
}

/* ---------------------------------------------------------------- warehouse */

type Warehouse = {
  warehouse_id: string;
  warehouse_code?: string;
  name?: string;
  display_name?: string;
  is_primary?: boolean;
  address?: { pincode?: number | string };
};

let cachedWarehouse: { wh: Warehouse; at: number } | null = null;
const WAREHOUSE_TTL_MS = 30 * 60 * 1000;

/**
 * Resolve the pickup warehouse. Matches NIMBUSPOST_WAREHOUSE_NAME against the
 * warehouse name / display name / code, falling back to the primary warehouse.
 */
async function resolveWarehouse(): Promise<Warehouse> {
  if (cachedWarehouse && Date.now() - cachedWarehouse.at < WAREHOUSE_TTL_MS) {
    return cachedWarehouse.wh;
  }

  const data = await np<Warehouse[] | { items?: Warehouse[] }>("/v2/warehouses", {
    method: "GET",
  });
  const list = Array.isArray(data) ? data : (data.items ?? []);
  if (!list.length) {
    throw new Error(
      "No pickup warehouse found in NimbusPost. Add one in the dashboard (Settings → Warehouse)."
    );
  }

  const wanted = process.env.NIMBUSPOST_WAREHOUSE_NAME?.trim().toLowerCase();
  const match = wanted
    ? list.find((w) =>
        [w.name, w.display_name, w.warehouse_code].some(
          (v) => v && String(v).trim().toLowerCase() === wanted
        )
      )
    : undefined;

  const wh = match ?? list.find((w) => w.is_primary) ?? list[0];
  if (!match && wanted) {
    console.warn(
      `NimbusPost: no warehouse named "${process.env.NIMBUSPOST_WAREHOUSE_NAME}" — falling back to "${wh.name ?? wh.warehouse_code}".`
    );
  }

  cachedWarehouse = { wh, at: Date.now() };
  return wh;
}

/* ------------------------------------------------------------------ payload */

export type ShipmentInput = {
  orderNumber: string;
  paymentType: "prepaid" | "cod";
  orderAmount: number; // rupees
  consignee: {
    name: string;
    address: string;
    city: string;
    state: string;
    pincode: string;
    phone: string;
  };
  items: { name: string; qty: number; price: number }[];
  parcel?: { weight?: number; length?: number; breadth?: number; height?: number };
};

/** Build the v2 order payload (snake_case, grams, numeric phone/pincode). */
async function buildOrderPayload(input: ShipmentInput) {
  const p = input.parcel ?? {};
  const wh = await resolveWarehouse();

  const pincode = Number(input.consignee.pincode.replace(/\D/g, "")) || 0;
  if (String(pincode).length !== 6) {
    throw new Error(`Invalid delivery pincode "${input.consignee.pincode}" — must be 6 digits.`);
  }

  const digits = input.consignee.phone.replace(/\D/g, "");
  const phone = Number(digits.slice(-10));
  if (String(phone).length !== 10) {
    throw new Error(`Invalid phone "${input.consignee.phone}" — must be 10 digits.`);
  }

  const isCod = input.paymentType === "cod";
  const grams = Math.round(
    p.weight && p.weight > 0 ? p.weight : num(process.env.NIMBUSPOST_DEFAULT_WEIGHT, 500)
  );

  return {
    order_number: input.orderNumber,
    order_type: "b2c",
    payment_mode: isCod ? "cod" : "prepaid",
    // Only COD collects on delivery; sending a non-zero amount on a prepaid
    // order would make the courier ask the customer to pay again.
    ...(isCod ? { order_collectable_amount: input.orderAmount } : {}),
    warehouse_id: wh.warehouse_id,
    shipping_address: {
      name: input.consignee.name,
      address: input.consignee.address,
      city: input.consignee.city,
      state: input.consignee.state,
      country: "India",
      pincode,
      phone,
    },
    items: input.items.map((i) => ({
      name: i.name,
      qty: Number(i.qty) || 1,
      price: Number(i.price) || 0,
    })),
    package: {
      // KILOGRAMS here — verified against the live API: 33 is rejected as
      // ">32 kg chargeable weight", 31 is accepted. The published v2 docs say
      // grams, but they are wrong for this endpoint. Serviceability really
      // does take grams, so the two surfaces disagree. Do not "fix" this.
      weight: grams / 1000,
      length: p.length && p.length > 0 ? p.length : num(process.env.NIMBUSPOST_DEFAULT_LENGTH, 15),
      width: p.breadth && p.breadth > 0 ? p.breadth : num(process.env.NIMBUSPOST_DEFAULT_BREADTH, 15),
      height: p.height && p.height > 0 ? p.height : num(process.env.NIMBUSPOST_DEFAULT_HEIGHT, 10),
    },
  };
}

/* ------------------------------------------------------------------ results */

export type ShipmentResult = {
  awb: string;
  courierName: string | null;
  shipmentId: string | null;
  trackingUrl: string | null;
};

type Booking = {
  order_id?: string;
  awb?: string;
  courier_name?: string;
  tracking_url?: string;
  tracking_short_url?: string;
};

function readBooking(b: Booking): ShipmentResult {
  const awb = String(b.awb ?? "");
  if (!awb) throw new Error("NimbusPost booked the shipment but returned no AWB.");
  return {
    awb,
    courierName: b.courier_name ?? null,
    shipmentId: b.order_id != null ? String(b.order_id) : null,
    trackingUrl:
      b.tracking_url ?? b.tracking_short_url ?? `https://track.nimbuspost.com/track/${awb}`,
  };
}

/* ---------------------------------------------------------------- endpoints */

/** Create a DRAFT order in NimbusPost — no courier, no AWB, no wallet charge. */
export async function createDraftOrder(input: ShipmentInput): Promise<string> {
  const payload = await buildOrderPayload(input);
  const data = await np<{ order_id?: string }>("/v2/orders", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!data.order_id) throw new Error("NimbusPost did not return an order id.");
  return String(data.order_id);
}

/** Book an existing draft → allocates the courier and generates the AWB. */
export async function shipDraft(nimbusOrderId: string): Promise<ShipmentResult> {
  const data = await np<Booking>("/v2/shipments/book", {
    method: "POST",
    body: JSON.stringify({ order_id: nimbusOrderId }),
  });
  return readBooking(data);
}

/**
 * Create the order AND book it in one call.
 *
 * ⚠️ INTENTIONALLY UNUSED by the fulfilment flow. This skips the draft stage,
 * so the order never appears in NimbusPost for a human to review and the wallet
 * is charged immediately. The store requires draft-first approval — use
 * `createDraftOrder()` then `shipDraft()`. Kept only for API completeness.
 */
export async function createShipment(input: ShipmentInput): Promise<ShipmentResult> {
  const payload = await buildOrderPayload(input);
  const data = await np<{ booking?: Booking }>("/v2/shipments", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return readBooking(data.booking ?? (data as Booking));
}

/** Cancel an order that has not been booked yet (no AWB). */
export async function cancelOrder(orderId: string, reason = "cancelled by seller") {
  return np(`/v2/orders/${encodeURIComponent(orderId)}/cancel`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

/** Cancel a booked shipment by AWB. */
export async function cancelShipment(awb: string, reason = "cancelled by seller") {
  return np("/v2/shipments/cancel", {
    method: "POST",
    body: JSON.stringify({ awb, reason }),
  });
}

export type NimbusOrderState = {
  orderStatus: string;
  booked: boolean;
  awb: string | null;
  courierName: string | null;
  labelUrl: string | null;
  trackingUrl: string | null;
};

/**
 * Read a NimbusPost order's current state.
 *
 * Used to pick up a booking made by a human in the NimbusPost dashboard: an
 * unbooked order carries `shipment.awb === ""`, and it fills in once a courier
 * is allocated. That is the only signal that someone booked it outside our
 * admin, so this is how the AWB gets back into our database.
 */
export async function getOrderState(orderId: string): Promise<NimbusOrderState> {
  const data = await np<{
    order_status?: string;
    shipment?: {
      awb?: string;
      courier_name?: string;
      label_url?: string;
      tracking_url?: string;
    };
  }>(`/v2/orders/${encodeURIComponent(orderId)}`, { method: "GET" });

  const s = data.shipment ?? {};
  const awb = (s.awb ?? "").trim();

  return {
    orderStatus: data.order_status ?? "unknown",
    booked: awb.length > 0,
    awb: awb || null,
    courierName: s.courier_name?.trim() || null,
    labelUrl: s.label_url?.trim() || null,
    trackingUrl:
      s.tracking_url?.trim() ||
      (awb ? `https://track.nimbuspost.com/track/${awb}` : null),
  };
}

export async function trackShipment(awb: string) {
  return np(`/v2/tracking/${encodeURIComponent(awb)}`, { method: "GET" });
}

/** Current wallet balance in rupees — handy for a health check. */
export async function getWalletBalance(): Promise<number | null> {
  if (!isNimbusPostConfigured()) return null;
  const data = await np<{ balance?: string }>("/v2/wallet/balance", { method: "GET" });
  const n = Number(data.balance);
  return Number.isFinite(n) ? n : null;
}

/* ------------------------------------------------------------------- rating */

export type RateInput = {
  destinationPincode: string;
  weightGrams: number;
  lengthCm: number;
  breadthCm: number;
  heightCm: number;
  paymentType: "prepaid" | "cod";
  /** Order value in rupees — COD charges are often a % of it. */
  orderValueRupees?: number;
};

type ServiceabilityCourier = {
  courierName?: string;
  result?: { totalPaise?: number };
};

/**
 * Cheapest serviceable courier rate in RUPEES, or null when nothing services
 * the pincode. Never throws — the checkout must not break on a rating hiccup.
 */
export async function calculateShippingRate(input: RateInput): Promise<number | null> {
  if (!isNimbusPostConfigured()) return null;

  try {
    const wh = await resolveWarehouse();
    const pickupPincode = String(wh.address?.pincode ?? "").replace(/\D/g, "");
    if (pickupPincode.length !== 6) {
      console.error("NimbusPost: pickup warehouse has no valid pincode.");
      return null;
    }

    const data = await np<{ available?: ServiceabilityCourier[] }>("/v2/serviceability", {
      method: "POST",
      body: JSON.stringify({
        pickupPincode,
        deliveryPincode: input.destinationPincode.replace(/\D/g, ""),
        paymentMode: input.paymentType,
        packages: [
          {
            weight: Math.max(
              Math.round(input.weightGrams || 0),
              num(process.env.NIMBUSPOST_DEFAULT_WEIGHT, 500)
            ),
            length: Math.max(input.lengthCm || 0, 1),
            width: Math.max(input.breadthCm || 0, 1),
            height: Math.max(input.heightCm || 0, 1),
          },
        ],
        orderValuePaise: Math.round((input.orderValueRupees ?? 0) * 100),
      }),
    });

    const rates = (data.available ?? [])
      .map((c) => Number(c.result?.totalPaise))
      .filter((n) => Number.isFinite(n) && n > 0);

    if (!rates.length) return null;
    // Paise → rupees, rounded up so we never under-charge ourselves.
    return Math.ceil(Math.min(...rates) / 100);
  } catch (error) {
    console.error("NimbusPost rate calculation error:", error);
    return null;
  }
}
