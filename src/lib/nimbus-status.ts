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
 */

/** Order statuses this app recognises. */
export type OrderStatus =
  | "pending"
  | "confirmed"
  | "shipped"
  | "delivered"
  | "cancelled";

const STATUS_MAP: Record<string, OrderStatus> = {
  // ---- Pickup ----
  "pickup scheduled": "confirmed",
  // A completed pickup means the parcel has left us. The webhook used to call
  // this "confirmed", which silently moved orders *backwards* from shipped.
  "pickup done": "shipped",
  "picked up": "shipped",
  "manifest created": "confirmed",
  "pickup cancelled": "pending",

  // ---- In transit ----
  "in transit": "shipped",
  "reached destination": "shipped",
  "out for delivery": "shipped",
  "delivery failed": "shipped", // attempted, still in the courier's hands

  // ---- Delivered ----
  delivered: "delivered",

  // ---- Return to origin ----
  "rto initiated": "shipped",
  "rto in transit": "shipped",
  "rto delivered": "cancelled",

  // ---- Cancellation ----
  //
  // These were MISSING from both tables, which is why cancelling in the
  // NimbusPost dashboard never reached the store: the lookup returned
  // undefined, the handler treated it as "nothing to change", and the order
  // sat at confirmed forever. Both British and American spellings, because
  // the payloads use them interchangeably.
  cancelled: "cancelled",
  canceled: "cancelled",
  "order cancelled": "cancelled",
  "order canceled": "cancelled",
  "shipment cancelled": "cancelled",
  "shipment canceled": "cancelled",
  "cancellation requested": "cancelled",
  "cancelled by seller": "cancelled",
  "cancelled by customer": "cancelled",
  returned: "cancelled",
};

/**
 * Map a raw courier status to ours, or `null` when we don't recognise it.
 *
 * `null` means "leave the order alone" — never guess. An unknown status that
 * defaulted to something would be far worse than one that did nothing.
 */
export function mapNimbusStatus(raw: string | null | undefined): OrderStatus | null {
  const key = String(raw ?? "").trim().toLowerCase();
  if (!key) return null;
  return STATUS_MAP[key] ?? null;
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
