/**
 * NimbusPost courier status → our internal order status.
 *
 * ONE table. It previously existed twice — `NIMBUS_TO_STATUS` in the webhook
 * route and `TRACKING_TO_STATUS` in `fulfilment.ts`, the latter commented
 * "Same table the webhook uses". They had already drifted: `pickup done` meant
 * `confirmed` to the webhook and `shipped` to the poller, so the same courier
 * event produced a different order status depending on which path saw it
 * first. Import from here; never re-declare.
 *
 * No Prisma, no server-only imports, so both the route handler and the library
 * can share it.
 *
 * ## Two readings of the same row, not two tables
 *
 * Every row now carries **both** what the event means to an order (`status`)
 * and where the parcel physically is (`phase`). That second column is what the
 * admin's and the customer's wording are built from — *"AWB booked, waiting for
 * pickup"* and *"waiting for pickup"* are the same fact said twice, and both
 * have to come out of this table or they will drift from it exactly the way the
 * two copies of the status map did.
 *
 * `status` is deliberately coarse — five values, because that is what the
 * `Order.status` column stores. `phase` is deliberately finer — it is display
 * only and writes nothing, so it can distinguish "booked but not collected"
 * from "on a van" without inventing an order status for each.
 */

/** Order statuses this app recognises. */
export type OrderStatus =
  | "pending"
  | "confirmed"
  | "shipped"
  | "delivered"
  | "cancelled";

/**
 * Where the parcel actually is, as the courier describes it.
 *
 * Read only — nothing is persisted from this. It exists because `Order.status`
 * cannot tell "an AWB was generated an hour ago and nobody has collected it"
 * apart from "it is on a van two cities away": both are stored as `shipped`,
 * and telling a customer "Shipped" for the first is how a store gets asked
 * "where is it?" by someone whose parcel is still on its own shelf.
 */
export type CourierPhase =
  /** A courier is allocated / manifested. Nothing has been collected. */
  | "scheduled"
  /** Collected from us. The journey has started. */
  | "picked"
  /** Moving between hubs. */
  | "transit"
  /** With the rider, today. */
  | "out"
  /** A delivery was attempted and failed. Still the courier's parcel. */
  | "attempted"
  | "delivered"
  /** Coming back to us — delivery gave up, or the customer refused it. */
  | "rto"
  /** The shipment is dead: cancelled, or the pickup was called off. */
  | "cancelled";

type StatusRow = { status: OrderStatus; phase: CourierPhase };

const STATUS_MAP: Record<string, StatusRow> = {
  // ---- Pickup ----
  "pickup scheduled": { status: "confirmed", phase: "scheduled" },
  // A completed pickup means the parcel has left us. The webhook used to call
  // this "confirmed", which silently moved orders *backwards* from shipped.
  "pickup done": { status: "shipped", phase: "picked" },
  "picked up": { status: "shipped", phase: "picked" },
  "manifest created": { status: "confirmed", phase: "scheduled" },
  "pickup cancelled": { status: "pending", phase: "cancelled" },

  // ---- In transit ----
  "in transit": { status: "shipped", phase: "transit" },
  "reached destination": { status: "shipped", phase: "transit" },
  "out for delivery": { status: "shipped", phase: "out" },
  // Attempted, still in the courier's hands.
  "delivery failed": { status: "shipped", phase: "attempted" },

  // ---- Delivered ----
  delivered: { status: "delivered", phase: "delivered" },

  // ---- Return to origin ----
  "rto initiated": { status: "shipped", phase: "rto" },
  "rto in transit": { status: "shipped", phase: "rto" },
  "rto delivered": { status: "cancelled", phase: "rto" },

  // ---- Cancellation ----
  //
  // These were MISSING from both tables, which is why cancelling in the
  // NimbusPost dashboard never reached the store: the lookup returned
  // undefined, the handler treated it as "nothing to change", and the order
  // sat at confirmed forever. Both British and American spellings, because
  // the payloads use them interchangeably.
  cancelled: { status: "cancelled", phase: "cancelled" },
  canceled: { status: "cancelled", phase: "cancelled" },
  "order cancelled": { status: "cancelled", phase: "cancelled" },
  "order canceled": { status: "cancelled", phase: "cancelled" },
  "shipment cancelled": { status: "cancelled", phase: "cancelled" },
  "shipment canceled": { status: "cancelled", phase: "cancelled" },
  "cancellation requested": { status: "cancelled", phase: "cancelled" },
  "cancelled by seller": { status: "cancelled", phase: "cancelled" },
  "cancelled by customer": { status: "cancelled", phase: "cancelled" },
  returned: { status: "cancelled", phase: "rto" },
};

function lookup(raw: string | null | undefined): StatusRow | null {
  const key = String(raw ?? "").trim().toLowerCase();
  if (!key) return null;
  return STATUS_MAP[key] ?? null;
}

/**
 * Map a raw courier status to ours, or `null` when we don't recognise it.
 *
 * `null` means "leave the order alone" — never guess. An unknown status that
 * defaulted to something would be far worse than one that did nothing.
 */
export function mapNimbusStatus(raw: string | null | undefined): OrderStatus | null {
  return lookup(raw)?.status ?? null;
}

/**
 * Where the parcel is, off the same row `mapNimbusStatus` reads.
 *
 * `null` for an unrecognised scan, for the same reason: the wording then falls
 * back to what the order's own status can prove, rather than claiming a
 * position in the journey nobody told us about.
 */
export function courierPhase(raw: string | null | undefined): CourierPhase | null {
  return lookup(raw)?.phase ?? null;
}

/** True if the courier is telling us this shipment is dead. */
export function isCancelledStatus(raw: string | null | undefined): boolean {
  return mapNimbusStatus(raw) === "cancelled";
}

/**
 * Statuses worth emailing the customer about. Shared for the same reason as
 * the map: the webhook and the poller must not disagree about what is
 * "interesting".
 */
// Typed as a string set rather than `ReadonlySet<OrderStatus>` on purpose:
// callers test raw values that TypeScript only knows as `string`, and a
// narrower type would force a cast at every call site — which is exactly the
// kind of friction that gets a shared helper copy-pasted back into a local one.
export const NOTIFY_STATUSES: ReadonlySet<string> = new Set<string>([
  "shipped",
  "delivered",
  "cancelled",
]);
