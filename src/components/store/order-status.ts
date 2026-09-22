/**
 * One vocabulary for an order's status, shared by the account list and the
 * order page.
 *
 * Two surfaces used to describe the same order in two different ways — the
 * account card had its own colour map, the order page its own timeline labels —
 * so "Shipped" could be purple in one place and violet in the other. Everything
 * either surface needs to name a status lives here.
 *
 * **No JSX and no hooks**, so a server page and a client component can both
 * import it. The icon map holds component *references*, which is why this stays
 * a plain `.ts` file.
 *
 * ## Dates are formatted here, on the server, on purpose
 *
 * `toLocaleString()` in a client component reads the *renderer's* timezone: the
 * server says one thing, the browser another, and React reports a hydration
 * mismatch on any order placed near midnight. Every date this module produces
 * is a pre-formatted string, built with a fixed month table, and the client
 * components below only ever print it. Same rule `formatReturnDate` follows in
 * `lib/returns.ts`.
 */

import {
  AlertTriangle,
  Check,
  Clock,
  Home,
  Package,
  Truck,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { courierPhase } from "@/lib/nimbus-status";

/** A raw `Order.statusHistory` row, as the admin actions write it. */
export type StatusEntry = {
  status: string;
  note?: string;
  at: string;
  /**
   * Set when the admin typed the note into the field labelled "message with
   * this update". The rest of the history is internal — NimbusPost draft/AWB
   * chatter, courier scans, "cancelled by admin" — so only flagged notes are
   * ever shown to the customer.
   */
  forCustomer?: boolean;
};

/* -------------------------------------------------------------- the flow */

/**
 * The four steps a customer is promised: placed → confirmed → dispatched →
 * delivered. `label` is what fits under a stepper dot on a 320px screen;
 * `long` is the sentence form used in the status line and the history.
 *
 * **`shipped` reads as "Dispatched", never "Shipped".** The stored status flips
 * the moment an AWB is generated, which is typically hours before anyone
 * collects the parcel — so "Shipped" was routinely a claim that the box had
 * left the building when it was still on the shelf. "Dispatched" is true from
 * the AWB onwards (we have handed it to a courier's system), and the precise
 * state — waiting for pickup, on its way, out for delivery — is what
 * {@link customerOrderState} says underneath it.
 */
export const ORDER_FLOW = [
  { key: "pending", label: "Placed", long: "Order placed", icon: Clock },
  { key: "confirmed", label: "Confirmed", long: "Confirmed", icon: Package },
  { key: "shipped", label: "Dispatched", long: "Dispatched", icon: Truck },
  { key: "delivered", label: "Delivered", long: "Delivered", icon: Home },
] as const;

export type OrderStage = (typeof ORDER_FLOW)[number]["key"];

/**
 * Statuses that sit outside the happy path. They are not a *later* step than
 * "delivered" — they replace the flow, which is why the stepper is swapped for
 * a single explanatory line rather than being drawn with a dead dot on it.
 */
export const OFF_FLOW_STATUSES = ["cancelled", "payment_failed"] as const;

export function isOffFlow(status: string): boolean {
  return (OFF_FLOW_STATUSES as readonly string[]).includes(status);
}

/** Index into `ORDER_FLOW`, or -1 for a status that isn't on it. */
export function orderStageIndex(status: string): number {
  return ORDER_FLOW.findIndex((s) => s.key === status);
}

const EXTRA_LABEL: Record<string, string> = {
  cancelled: "Cancelled",
  payment_failed: "Payment failed",
};

/** Always returns something printable — an unknown status is prettified, not blanked. */
export function orderStatusLabel(status: string): string {
  const step = ORDER_FLOW.find((s) => s.key === status);
  if (step) return step.long;
  if (EXTRA_LABEL[status]) return EXTRA_LABEL[status];
  const words = status.replace(/_/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : "Order";
}

/**
 * Status → icon.
 *
 * A lookup table rather than a `statusIcon(status)` helper on purpose: a
 * function that *returns* a component is treated as creating one during
 * render (`react-hooks/static-components`), because a component built inside a
 * render loses its state on every pass. Reading a property off a module
 * constant creates nothing.
 *
 * Use it as `ORDER_STATUS_ICON[status] ?? FALLBACK_STATUS_ICON` — the keys are
 * the statuses this app writes, and the column is free text in the database.
 */
export const ORDER_STATUS_ICON: Record<string, LucideIcon> = {
  pending: Clock,
  confirmed: Package,
  shipped: Truck,
  delivered: Home,
  cancelled: XCircle,
  payment_failed: AlertTriangle,
};

export const FALLBACK_STATUS_ICON: LucideIcon = Check;

/**
 * Pill classes. Monochrome + electric violet, with green and red reserved for
 * the two outcomes that mean something: delivered, and gone wrong. Colour is
 * never the only signal — every pill carries its `ORDER_STATUS_ICON` beside it.
 */
export const ORDER_STATUS_PILL: Record<string, string> = {
  pending: "bg-muted text-muted-foreground",
  confirmed: "bg-accent/12 text-accent",
  shipped: "bg-accent text-accent-foreground",
  delivered: "bg-success/15 text-success",
  cancelled: "bg-danger/10 text-danger",
  payment_failed: "bg-danger/10 text-danger",
};

export function orderStatusPill(status: string): string {
  return ORDER_STATUS_PILL[status] ?? "bg-muted text-muted-foreground";
}

/* --------------------------------------------------- the customer's words */

export type CustomerStateCode =
  | "placed"
  | "confirmed"
  | "awaiting-pickup"
  | "moving"
  | "out"
  | "attempted"
  | "returning"
  | "delivered"
  | "cancelled"
  | "failed";

export type CustomerOrderState = {
  code: CustomerStateCode;
  /** The one line that answers "where is it?". */
  label: string;
  /** One short clause under it, or null when the label says everything. */
  note: string | null;
  /**
   * True when the label was derived from the courier's last scan. The raw
   * courier text is then redundant — printing both gives
   * "Out for delivery · Out For Delivery".
   */
  fromScan: boolean;
};

/**
 * **The customer's reading of an order** — the coarse half of "one stored
 * status, two vocabularies".
 *
 * The operator's version is `adminOrderState` in `lib/orders-pipeline.ts`, and
 * it names the draft, the AWB and the carrier because an operator's next press
 * depends on all three. A customer's does not. They want one fact — *where is
 * my parcel* — so nothing here mentions NimbusPost, a draft, an AWB or a
 * wallet, and "confirmed" and "dispatched" are as far into our plumbing as the
 * wording ever goes.
 *
 * Both vocabularies read the **same** row of the **same** table:
 * `courierPhase()` in `lib/nimbus-status.ts`, beside `mapNimbusStatus()`. That
 * is the rule this file must not break — a second courier-status map here is
 * exactly the drift that made `pickup done` mean two things.
 *
 * The one case worth stating: `shipped` **with no scan yet** is *"Waiting for
 * pickup"*, not "Shipped". The status flips when the AWB is generated, so for
 * the hours between booking and collection a bald "Shipped" is a parcel the
 * customer is told has left and has not.
 */
export function customerOrderState(
  status: string,
  deliveryStatus?: string | null
): CustomerOrderState {
  const phase = courierPhase(deliveryStatus);

  const say = (
    code: CustomerStateCode,
    label: string,
    note: string | null,
    fromScan = false
  ): CustomerOrderState => ({ code, label, note, fromScan });

  // A parcel turned around outranks whatever the order status still says —
  // there is no order status for "coming back", and the customer needs to know
  // before they keep waiting at the door.
  if (phase === "rto" && status !== "delivered") {
    return say(
      "returning",
      "Coming back to the store",
      "The delivery couldn't be completed, so the parcel is on its way back. We'll be in touch about your money.",
      true
    );
  }

  switch (status) {
    case "delivered":
      return say("delivered", "Delivered", "This order has arrived.");

    case "cancelled":
      return say("cancelled", "Cancelled", "This order was cancelled.");

    case "payment_failed":
      return say(
        "failed",
        "Payment failed",
        "The payment didn't go through, so nothing was dispatched."
      );

    case "pending":
      return say(
        "placed",
        "Order placed",
        "We've got it. You'll hear from us once it's confirmed."
      );

    case "confirmed":
      return say(
        "confirmed",
        "Confirmed — being packed",
        "We're getting it ready to hand to the courier."
      );

    case "shipped":
      switch (phase) {
        case "picked":
        case "transit":
          return say(
            "moving",
            "On its way",
            "The courier has your parcel and it's moving towards you.",
            true
          );
        case "out":
          return say(
            "out",
            "Out for delivery",
            "It's with the rider today — please keep your phone nearby.",
            true
          );
        case "attempted":
          return say(
            "attempted",
            "Delivery attempted",
            "The courier couldn't hand it over and will try again.",
            true
          );
        case "delivered":
          return say("delivered", "Delivered", "The courier reports it arrived.", true);
        case "cancelled":
          return say(
            "cancelled",
            "Shipment cancelled",
            "The courier cancelled this shipment. Please contact us.",
            true
          );
        // `scheduled`, and — the common one — no scan at all. The AWB exists;
        // the parcel does not yet.
        default:
          return say(
            "awaiting-pickup",
            "Waiting for pickup",
            "Packed and labelled. The courier collects it next, and tracking starts moving from there.",
            phase === "scheduled"
          );
      }

    default:
      return say("placed", orderStatusLabel(status), null);
  }
}

/* ------------------------------------------------------------- formatting */

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** `21 Sep 2026`. Fixed table, so it reads identically wherever it is built. */
export function formatOrderDate(date: Date): string {
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** `21 Sep 2026, 6:18 pm` — the history needs the time, the card does not. */
export function formatOrderMoment(date: Date): string {
  if (Number.isNaN(date.getTime())) return "";
  const h = date.getHours();
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${formatOrderDate(date)}, ${hour12}:${minutes} ${h < 12 ? "am" : "pm"}`;
}

/* ------------------------------------------------------- history → trail */

/** One row of the "View updates" disclosure. Already formatted, already safe. */
export type TrailEntry = {
  status: string;
  label: string;
  /** Pre-formatted moment. Empty when the stored timestamp was unusable. */
  at: string;
};

function readHistory(raw: unknown): StatusEntry[] {
  return Array.isArray(raw) ? (raw as StatusEntry[]) : [];
}

/**
 * The customer-facing journey: one row per status the order actually reached,
 * in order, with the time it happened.
 *
 * **Notes are dropped here, deliberately.** `statusHistory` carries internal
 * text ("Draft shipment created in NimbusPost", "cancelled by admin") and the
 * flag that separates the two only exists on notes the admin wrote *for* the
 * customer — those are surfaced by `buildStoreMessages` instead, in one place,
 * rather than being scattered through a list of timestamps.
 *
 * Repeats are collapsed: staging a NimbusPost draft appends a second
 * `confirmed` row, and a customer reading "Confirmed" twice with two times
 * beside it has been told about our plumbing, not about their parcel.
 */
export function buildOrderTimeline(raw: unknown): TrailEntry[] {
  const seen = new Set<string>();
  const out: TrailEntry[] = [];
  for (const entry of readHistory(raw)) {
    const status = typeof entry?.status === "string" ? entry.status : "";
    if (!status || seen.has(status)) continue;
    seen.add(status);
    const at = typeof entry.at === "string" ? new Date(entry.at) : null;
    out.push({
      status,
      label: orderStatusLabel(status),
      at: at ? formatOrderMoment(at) : "",
    });
  }
  return out;
}

/** The timestamp a given status was reached, pre-formatted. Null if never. */
export function stampFor(trail: TrailEntry[], status: string): string | null {
  return trail.find((t) => t.status === status)?.at || null;
}

/* ------------------------------------------------------- store → customer */

export type StoreMessage = {
  text: string;
  /** `Shipped · 21 Sep 2026`, or null for the standing note on the order. */
  meta: string | null;
};

/**
 * Everything the store has deliberately said to this customer about this
 * order, newest first.
 *
 * Two sources, both written for them: `Order.customerNote`, the standing
 * message, and the notes attached to a status update and flagged `forCustomer`.
 *
 * **`Order.note` is never read.** It is the admin's private note — it starts
 * life as the shopper's own checkout text and is then overwritten with internal
 * text, so it cannot be treated as safe. What the shopper typed at checkout is
 * `buyerNote`, a third column.
 */
export function buildStoreMessages(
  customerNote: string | null | undefined,
  raw: unknown
): StoreMessage[] {
  const out: StoreMessage[] = [];
  const standing = customerNote?.trim();
  if (standing) out.push({ text: standing, meta: null });

  const flagged = readHistory(raw)
    .filter((h) => h.forCustomer && typeof h.note === "string" && h.note.trim())
    .reverse();

  for (const h of flagged) {
    const at = typeof h.at === "string" ? new Date(h.at) : null;
    const when = at ? formatOrderDate(at) : "";
    out.push({
      text: (h.note as string).trim(),
      meta: [orderStatusLabel(h.status), when].filter(Boolean).join(" · "),
    });
  }
  return out;
}
