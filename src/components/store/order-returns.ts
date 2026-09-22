/**
 * Props for `<ReturnRequest>`, built from an order row.
 *
 * The order page worked this out inline. The account list now offers returns
 * too, and a *second* copy of "which lines can be returned, and until when"
 * is exactly how two screens end up disagreeing with each other — and with
 * `requestReturn`, which re-decides all of it server-side anyway.
 *
 * **No new policy is implemented here.** Every verdict comes from
 * `resolveReturnPolicy` / `returnWindow` in `lib/returns.ts`, the same
 * functions `evaluateReturnEligibility` and the server action run. This module
 * only reshapes a Prisma row into the component's props. It is pure — no
 * Prisma, no clock of its own — so the caller can batch one product query
 * across a whole page of orders.
 *
 * It lives beside the components that consume it rather than in `lib/` because
 * its output type is `ReturnRequest`'s prop type; the import below is
 * `import type`, so nothing from that client module survives to runtime.
 */

import {
  formatReturnDate,
  isReturnStatus,
  resolveReturnPolicy,
  returnWindow,
} from "@/lib/returns";
import type {
  ExistingRequest,
  ReturnableLine,
} from "./return-request";

/** The three product columns the policy depends on. */
export type ReturnProductFlags = {
  returnable?: boolean | null;
  returnsInfo?: string | null;
  /**
   * Required, not optional-in-practice: `resolveReturnPolicy` treats a
   * made-to-order piece with no explicit `returnable` as non-returnable, but
   * the field is optional on its input type — so a Prisma `select` that omits
   * it still typechecks and quietly offers returns on personalised work.
   */
  isCustomisable?: boolean | null;
};

export type ReturnRequestRow = {
  requestNumber: string;
  productName: string;
  status: string;
  reason: string;
  adminNote: string | null;
  createdAt: Date;
  refundAmount: number | null;
  refundGross: number | null;
  refundFee: number | null;
  refundMethod: string | null;
  refundUpi: string | null;
  refundReference: string | null;
  refundedAt: Date | null;
};

export type OrderReturnsView = {
  lines: ReturnableLine[];
  existing: ExistingRequest[];
  windowOpen: boolean;
  daysLeft: number;
  windowDays: number;
  closedReason: "not_delivered" | "window_closed" | "store_disabled" | null;
  /** Pre-formatted closing date — `null` until the order is delivered. */
  closesOn: string | null;
  /** Right-hand side of the collapsed Returns row. Always says something. */
  summary: string;
  /**
   * False only when there is nothing to show and nothing to do: returns are
   * off store-wide (or the order isn't delivered) and no request was ever
   * raised. `ReturnRequest` makes the same call itself; this lets a surface
   * skip rendering the row at all rather than rendering an empty one.
   */
  show: boolean;
};

type ReturnSettings = {
  returnsEnabled: boolean;
  defaultReturnable: boolean;
  returnWindowDays: number;
  defaultReturnsInfo?: string;
};

export function buildOrderReturns(input: {
  order: { status: string; deliveryStatusAt?: Date | null; createdAt: Date };
  items: {
    name: string;
    quantity: number;
    price: number;
    productId?: string;
    options?: { name: string; value: string }[];
  }[];
  /** `Product.id` → its three policy columns. Missing id = product is gone. */
  products: Map<string, ReturnProductFlags>;
  returnRequests: ReturnRequestRow[];
  settings: ReturnSettings;
  now: Date;
}): OrderReturnsView {
  const { order, items, products, returnRequests, settings, now } = input;

  const win = returnWindow(order, settings.returnWindowDays, now);
  const closedReason = !settings.returnsEnabled
    ? ("store_disabled" as const)
    : !win.deliveredAt
      ? ("not_delivered" as const)
      : !win.open
        ? ("window_closed" as const)
        : null;

  const lines: ReturnableLine[] = items.map((item, index) => {
    const policy = resolveReturnPolicy(
      (item.productId ? products.get(item.productId) : undefined) ?? {},
      settings
    );
    return {
      index,
      name: item.name,
      quantity: item.quantity,
      price: item.price,
      variantLabel:
        (item.options ?? []).map((o) => `${o.name}: ${o.value}`).join(" · ") ||
        null,
      eligible: policy.returnable,
    };
  });

  const existing: ExistingRequest[] = returnRequests.map((r) => ({
    requestNumber: r.requestNumber,
    productName: r.productName,
    status: isReturnStatus(r.status) ? r.status : "pending",
    reason: r.reason,
    adminNote: r.adminNote,
    createdAt: r.createdAt.toISOString(),
    // The figures fixed at the decision, never recomputed: the customer is
    // shown what was agreed, not what today's fee settings would produce.
    refund:
      r.refundAmount == null
        ? null
        : {
            net: r.refundAmount,
            gross: r.refundGross,
            fee: r.refundFee,
            method: r.refundMethod,
            upi: r.refundUpi,
            reference: r.refundReference,
            paidOn: r.refundedAt ? formatReturnDate(r.refundedAt) : null,
          },
  }));

  const open = closedReason === null;
  const anyEligible = lines.some((l) => l.eligible);

  const summary = existing.length
    ? `${existing.length} request${existing.length === 1 ? "" : "s"}`
    : closedReason === "store_disabled"
      ? "Paused"
      : closedReason === "not_delivered"
        ? "After delivery"
        : closedReason === "window_closed"
          ? win.closesAt
            ? `Closed ${formatReturnDate(win.closesAt)}`
            : "Window closed"
          : !anyEligible
            ? "Not returnable"
            : `${win.daysLeft} day${win.daysLeft === 1 ? "" : "s"} left`;

  return {
    lines,
    existing,
    windowOpen: open,
    daysLeft: win.daysLeft,
    windowDays: settings.returnWindowDays,
    closedReason,
    closesOn: win.closesAt ? formatReturnDate(win.closesAt) : null,
    summary,
    // Matches `ReturnRequest`'s own "stay out of the way entirely" rule, so a
    // surface never draws a heading over a component that renders null.
    show:
      existing.length > 0 ||
      (closedReason !== "not_delivered" && closedReason !== "store_disabled"),
  };
}
