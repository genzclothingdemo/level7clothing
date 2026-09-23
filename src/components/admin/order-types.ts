/**
 * Shapes shared by the Admin → Orders screen.
 *
 * They live here rather than in `orders-table.tsx` so the table and the
 * tracking panel can both import them without importing each other.
 * `orders-table.tsx` re-exports `AdminOrder`, which is what the page imports.
 */

import type { BulkVerb } from "@/lib/orders-pipeline";

/** One entry of `Order.statusHistory`. */
export type StatusEntry = {
  status: string;
  note?: string;
  at: string;
  /**
   * True only for notes the admin deliberately wrote **for the customer**.
   * Everything else in the history is internal — NimbusPost draft/AWB chatter,
   * courier scans, "cancelled by admin" — and must never reach the storefront.
   */
  forCustomer?: boolean;
};

export type AdminOrderItem = {
  /** Present on orders placed after line items started recording it. */
  productId?: string;
  /** Resolved server-side; null when the product has since been deleted. */
  slug?: string | null;
  /**
   * The line's photo — the catalogue's current first image, falling back to
   * the one frozen onto the order at checkout.
   *
   * It was flowing through this shape at runtime the whole time (`placeOrder`
   * writes `image` onto every line) and was simply never declared, so nothing
   * could render it without a cast. Declared now because the orders row leads
   * with the product rather than with the order number.
   */
  image?: string | null;
  name: string;
  quantity: number;
  price: number;
  options?: { name: string; value: string }[];
  /** From the live catalogue: this piece is made to order. */
  isCustomisable?: boolean;
  /** What the customer has to supply for it (name, number, measurements…). */
  customisationNote?: string | null;
  /** Anything the customer typed against this line at checkout. */
  note?: string;
};

export type AdminOrder = {
  id: string;
  orderNumber: string;
  customerName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  items: AdminOrderItem[];
  subtotal: number;
  shipping: number;
  discountTotal?: number;
  couponCode?: string | null;
  total: number;
  amountPaid: number;
  balanceDue: number;
  paymentMethod: string;
  paymentStatus: string;
  status: string;
  courier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  nimbusShipmentId: string | null;
  nimbusCourierId: string | null;
  nimbusCourierName: string | null;
  deliveryStatus: string | null;
  deliveryLocation: string | null;
  deliveryStatusAt: string | null;
  lastSyncedAt: string | null;
  /** Internal note. Never shown to the customer. */
  note: string | null;
  /** The message the customer sees on their order page. */
  customerNote: string | null;
  /** Set at checkout when any line item is a made-to-order product. */
  needsCustomisation: boolean;
  statusHistory: StatusEntry[];
  createdAt: string;
  /** How many return requests this order has. */
  returnCount: number;
};

export type CourierOption = {
  courierId: string;
  name: string;
  type: string | null;
  tatDays: number | null;
  chargeableGrams: number | null;
  total: number;
  forward: number;
  rto: number;
  cod: number;
  surcharges: number;
};

/* ------------------------------------------------------------------ */
/*  Bulk actions                                                       */
/* ------------------------------------------------------------------ */

/**
 * The bulk verbs, declared HERE rather than in `app/actions/admin.ts`.
 *
 * That file carries `"use server"`, and a `"use server"` module may only
 * export async functions — a plain `const` array exported from it fails the
 * build with no type error to warn you first. This module has no directive,
 * so the server action and the table can share one list.
 *
 * The *type* is `BulkVerb` from `lib/orders-pipeline`, where the rule for what
 * each verb may run on lives. Aliasing rather than redeclaring is what stops a
 * verb existing in the bar with no eligibility rule behind it.
 */
export const BULK_ORDER_ACTIONS = [
  "confirm",
  "cancel",
  "draft",
  "book",
  "sync",
] as const satisfies readonly BulkVerb[];

export type BulkOrderAction = BulkVerb;

/** One row's outcome from a bulk run. Every selected order gets exactly one. */
export type BulkRowResult = {
  id: string;
  orderNumber: string;
  ok: boolean;
  /** Shown verbatim — it says what happened, not just "error". */
  message: string;
};

export type BulkRunResult = {
  action: BulkOrderAction;
  results: BulkRowResult[];
  succeeded: number;
  failed: number;
};

/**
 * What each verb does and how loudly to warn about it. `danger` marks the two
 * that cannot be undone from this screen; `accent` marks the one that spends
 * money.
 */
export const BULK_ACTION_META: Record<
  BulkOrderAction,
  { label: string; verb: string; tone: "solid" | "accent" | "danger"; confirm: string | null }
> = {
  confirm: {
    label: "Confirm",
    verb: "Confirming",
    tone: "solid",
    // Deliberately does not promise a draft: what confirming does with the
    // courier is Q1 (`dispatchOnConfirm`), which can be off, draft or book.
    confirm:
      "Confirm the selected orders? Each customer is emailed, and what then reaches the courier is whatever Settings → Orders is set to.",
  },
  cancel: {
    label: "Cancel",
    verb: "Cancelling",
    tone: "danger",
    confirm: "Cancel the selected orders and restore their stock? This cannot be undone.",
  },
  draft: {
    label: "Send draft",
    verb: "Staging drafts for",
    tone: "solid",
    // Free and reversible in the NimbusPost dashboard — no prompt.
    confirm: null,
  },
  book: {
    label: "Book AWB",
    verb: "Booking",
    tone: "accent",
    confirm:
      "Book the selected orders with NimbusPost? This allocates couriers, generates AWBs and charges your NimbusPost wallet.",
  },
  sync: {
    label: "Sync",
    verb: "Syncing",
    tone: "solid",
    confirm: null,
  },
};
