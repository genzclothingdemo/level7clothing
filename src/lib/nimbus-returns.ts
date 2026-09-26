/**
 * Reverse-shipment I/O — the courier half of returns. Server only.
 *
 * `lib/fulfilment.ts` owns the FORWARD leg and stages the reverse draft
 * (`draftReturnPickup`). Everything after that draft exists lives here: booking
 * it, pulling a booking made in the NimbusPost dashboard, and mirroring the
 * courier's scans onto the `ReturnRequest`.
 *
 * ## Three rules this file exists to keep
 *
 * 1. **Draft-first, exactly like forward dispatch.** {@link bookReturnPickup}
 *    refuses to create anything — it books a draft that is already staged, and
 *    that is the only call in the returns flow that spends the wallet. The
 *    caller must have named the charge to a human first.
 *
 * 2. **One status vocabulary.** Courier text is read by `mapNimbusStatus` (the
 *    shared table) and reinterpreted for the reverse leg by
 *    `reverseReturnStatus` in `lib/returns.ts`. Nothing here invents a status.
 *
 * 3. **Never walk a return backwards, never overwrite a terminal one.** Every
 *    automatic write goes through `advanceReturnStatus`, so a late or repeated
 *    scan cannot un-receive a parcel or reopen a refunded request.
 *
 * ## The reverse AWB lives in its own column, deliberately
 *
 * `ReturnRequest.nimbusAwb` — never `Order.trackingNumber`. Writing a reverse
 * AWB onto the order would clobber the forward one and hand every reverse scan
 * to the order's status machine, so "picked up from the customer" would read as
 * "your order shipped". The webhook therefore has to look in both places; see
 * `app/api/webhooks/nimbuspost/route.ts`.
 */

import { prisma } from "./prisma";
import { getSettings } from "./settings";
import {
  isNimbusPostConfigured,
  getOrderState,
  getWalletBalance,
  listCourierOptions,
  shipDraft,
  trackShipment,
  type CourierOption,
} from "./nimbuspost";
import {
  advanceReturnStatus,
  isReturnStatus,
  isRtoStatus,
  isTerminalReturnStatus,
  reverseReturnStatus,
  type ReturnStatus,
} from "./returns";

type HistoryEntry = { status: string; note?: string; at: string; by?: string };

function readHistory(value: unknown): HistoryEntry[] {
  return Array.isArray(value) ? (value as HistoryEntry[]) : [];
}

function statusOf(raw: string): ReturnStatus {
  return isReturnStatus(raw) ? raw : "pending";
}

/** The columns every helper here reads. One place, so they cannot drift. */
const RETURN_SELECT = {
  id: true,
  requestNumber: true,
  status: true,
  quantity: true,
  unitPrice: true,
  productId: true,
  nimbusOrderId: true,
  nimbusAwb: true,
  nimbusCourier: true,
  nimbusError: true,
  statusHistory: true,
  order: { select: { orderNumber: true, pincode: true } },
} as const;

/**
 * Append one entry to a return's history without clobbering the rest, and
 * optionally advance its status.
 *
 * Re-reads the row inside the same call rather than trusting a value fetched
 * earlier: the admin queue and the webhook can both be writing, and a
 * read-modify-write on a JSON column is the one place a lost update is silent.
 */
async function record(
  returnId: string,
  entry: { status?: ReturnStatus; note: string; by: string },
  extra: Record<string, unknown> = {}
): Promise<ReturnStatus | null> {
  const row = await prisma.returnRequest.findUnique({
    where: { id: returnId },
    select: { status: true, statusHistory: true },
  });
  if (!row) return null;

  const current = statusOf(row.status);
  const next = entry.status ? advanceReturnStatus(current, entry.status) : null;

  const history = readHistory(row.statusHistory);
  history.push({
    status: next ?? current,
    note: entry.note,
    at: new Date().toISOString(),
    by: entry.by,
  });

  await prisma.returnRequest.update({
    where: { id: returnId },
    data: {
      ...(next ? { status: next } : {}),
      // "Received" is not the end of a return — the refund still has to go out —
      // so `resolvedAt` is left to the payout path exactly as before.
      statusHistory: history as unknown as object[],
      ...extra,
    },
  });

  return next;
}

/* ------------------------------------------------------------ the estimate */

export type ReverseQuote = {
  /** Couriers that will carry this lane, cheapest first. Empty is not an error. */
  options: CourierOption[];
  /** NimbusPost wallet, in rupees. `null` when it couldn't be read. */
  walletBalance: number | null;
  /** The customer's pincode — the collection end of the reverse leg. */
  pincode: string;
  /**
   * True when the quote is for the same lane flown the other way.
   *
   * NimbusPost's serviceability endpoint always prices *from* the configured
   * warehouse, so there is no way to ask it for a genuine customer→warehouse
   * rate. These numbers are the right lane and the right parcel, and reverse
   * pricing tracks forward pricing closely, but they are an estimate and the UI
   * must say so rather than presenting them as the charge.
   */
  estimated: true;
};

/**
 * What booking this pickup is likely to cost, and what is in the wallet.
 *
 * Exists so the confirmation can **name the charge** before the only call in
 * this flow that spends money. Never throws: a quote failing must not stop an
 * owner booking a pickup, it must only stop them booking one blind.
 */
export async function quoteReturnPickup(
  returnId: string
): Promise<{ ok: true; quote: ReverseQuote } | { ok: false; error: string }> {
  if (!isNimbusPostConfigured()) {
    return { ok: false, error: "NimbusPost isn't configured." };
  }

  const req = await prisma.returnRequest
    .findUnique({ where: { id: returnId }, select: RETURN_SELECT })
    .catch(() => null);
  if (!req) return { ok: false, error: "Return request not found" };

  const product = req.productId
    ? await prisma.product
        .findUnique({
          where: { id: req.productId },
          select: { weightGrams: true, lengthCm: true, breadthCm: true, heightCm: true },
        })
        .catch(() => null)
    : null;

  const [options, walletBalance] = await Promise.all([
    listCourierOptions({
      destinationPincode: req.order.pincode,
      weightGrams: (product?.weightGrams ?? 0) * req.quantity,
      lengthCm: product?.lengthCm ?? 0,
      breadthCm: product?.breadthCm ?? 0,
      heightCm: product?.heightCm ?? 0,
      // A reverse pickup collects nothing at the door.
      paymentType: "prepaid",
      orderValueRupees: Math.max(0, req.unitPrice * req.quantity),
    }).catch(() => [] as CourierOption[]),
    getWalletBalance().catch(() => null),
  ]);

  return {
    ok: true,
    quote: {
      options,
      walletBalance,
      pincode: req.order.pincode,
      estimated: true,
    },
  };
}

/* --------------------------------------------------------------- booking */

export type BookPickupResult =
  | { ok: true; awb: string; courier: string | null }
  | { ok: false; error: string };

/**
 * Book a staged reverse draft → allocates a courier, generates the AWB and
 * **charges the NimbusPost wallet**.
 *
 * Deliberately cannot create-and-book. If no draft is staged this refuses and
 * says so, because the draft is the review gate: the same rule `dispatchOrder`
 * keeps on the forward leg, for the same reason. Staging is
 * `draftReturnPickup` in `lib/fulfilment.ts`, and it is free.
 *
 * A failed booking leaves the draft intact and records the reason on the row,
 * so the queue shows "approved, pickup not booked" rather than a silent nothing.
 */
export async function bookReturnPickup(
  returnId: string,
  courierId?: string | null
): Promise<BookPickupResult> {
  const settings = await getSettings();
  if (!settings.nimbusEnabled) {
    return {
      ok: false,
      error: "NimbusPost shipping is turned off. Enable it in Admin → Settings.",
    };
  }
  if (!isNimbusPostConfigured()) {
    return { ok: false, error: "NimbusPost isn't configured." };
  }

  const req = await prisma.returnRequest
    .findUnique({ where: { id: returnId }, select: RETURN_SELECT })
    .catch(() => null);
  if (!req) return { ok: false, error: "Return request not found" };

  if (req.nimbusAwb) {
    return {
      ok: false,
      error: `This pickup is already booked — AWB ${req.nimbusAwb}. Booking again would charge the wallet twice.`,
    };
  }
  if (!req.nimbusOrderId) {
    return {
      ok: false,
      error:
        "No reverse draft is staged yet. Draft the pickup first — booking never creates one, so nothing is charged by accident.",
    };
  }
  if (isTerminalReturnStatus(statusOf(req.status))) {
    return {
      ok: false,
      error: `This return is ${req.status} — there is nothing left to collect.`,
    };
  }

  try {
    const result = await shipDraft(req.nimbusOrderId, courierId ?? null);

    await record(
      returnId,
      {
        note: `Reverse pickup booked${result.courierName ? ` (${result.courierName})` : ""} — AWB ${result.awb}`,
        by: "admin",
      },
      {
        nimbusAwb: result.awb,
        nimbusCourier: result.courierName,
        nimbusError: null,
      }
    );

    return { ok: true, awb: result.awb, courier: result.courierName };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Written to the row, not just returned: a toast is gone in four seconds and
    // an unbooked pickup is invisible for days.
    await prisma.returnRequest
      .update({ where: { id: returnId }, data: { nimbusError: message } })
      .catch(() => {});
    return { ok: false, error: message };
  }
}

/* ------------------------------------------------------------------ sync */

export type ReturnSyncResult =
  | { ok: true; outcome: "not-staged" }
  /** A draft exists but nobody has booked it — no AWB anywhere yet. */
  | { ok: true; outcome: "not-booked" }
  /** Someone booked it in the NimbusPost dashboard; the AWB is now ours. */
  | { ok: true; outcome: "booked"; awb: string; courier: string | null }
  /** Already booked — this is a scan refresh. */
  | { ok: true; outcome: "tracked"; awb: string; raw: string | null; status: ReturnStatus }
  | { ok: false; error: string };

type TrackingPayload = {
  status?: string;
  current_status?: string;
  courier_name?: string;
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
 * Pull the reverse leg's state back from NimbusPost.
 *
 * The mirror of `syncOrderFromNimbus`, and needed for the same reason: a draft
 * reviewed and booked in the NimbusPost dashboard has an AWB there and none
 * here, and until it is pulled across the status webhook — which matches on
 * AWB — can never find the return. Without this, booking outside the admin is
 * a dead end.
 *
 * Two populations, two endpoints: no AWB yet → ask the ORDER endpoint whether
 * someone booked it; AWB in hand → ask the TRACKING endpoint where it is.
 */
export async function syncReturnFromNimbus(
  returnId: string
): Promise<ReturnSyncResult> {
  if (!isNimbusPostConfigured()) {
    return { ok: false, error: "NimbusPost isn't configured." };
  }

  const req = await prisma.returnRequest
    .findUnique({ where: { id: returnId }, select: RETURN_SELECT })
    .catch(() => null);
  if (!req) return { ok: false, error: "Return request not found" };
  if (!req.nimbusOrderId && !req.nimbusAwb) {
    return { ok: true, outcome: "not-staged" };
  }

  /* ---- already booked → refresh the scan ---- */
  if (req.nimbusAwb) {
    try {
      const data = (await trackShipment(req.nimbusAwb)) as TrackingPayload;
      const scans = data.history ?? data.scans ?? [];
      const latest = scans[scans.length - 1];
      const raw = (data.current_status ?? data.status ?? latest?.status ?? "").trim();

      if (!raw) {
        return {
          ok: true,
          outcome: "tracked",
          awb: req.nimbusAwb,
          raw: null,
          status: statusOf(req.status),
        };
      }

      const next = await applyReverseScan(returnId, {
        raw,
        location: latest?.location?.trim() || null,
        courier: data.courier_name?.trim() || null,
        by: "nimbus-sync",
      });

      return {
        ok: true,
        outcome: "tracked",
        awb: req.nimbusAwb,
        raw,
        status: next ?? statusOf(req.status),
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /* ---- draft only → did someone book it in the dashboard? ---- */
  try {
    const state = await getOrderState(req.nimbusOrderId!);
    if (!state.booked || !state.awb) {
      return { ok: true, outcome: "not-booked" };
    }

    await record(
      returnId,
      {
        note: `Reverse pickup booked in the NimbusPost dashboard${state.courierName ? ` (${state.courierName})` : ""} — AWB ${state.awb}`,
        by: "nimbus-sync",
      },
      { nimbusAwb: state.awb, nimbusCourier: state.courierName, nimbusError: null }
    );

    return {
      ok: true,
      outcome: "booked",
      awb: state.awb,
      courier: state.courierName,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Apply one courier scan from the reverse leg to a return.
 *
 * The single write path for courier-driven return movement, shared by the
 * webhook (push) and the sync (poll) so the two can never disagree about what
 * an event meant — the exact failure `lib/nimbus-status.ts` was created to end.
 *
 * Returns the new status, or `null` when the scan was recorded but changed
 * nothing (which is the common case, and is not a failure).
 */
export async function applyReverseScan(
  returnId: string,
  scan: {
    raw: string;
    location?: string | null;
    courier?: string | null;
    /** Who saw it — "nimbus-webhook" or "nimbus-sync". Shows in the timeline. */
    by: string;
  }
): Promise<ReturnStatus | null> {
  const proposed = reverseReturnStatus(scan.raw);

  const note = [
    `NimbusPost (return leg): ${scan.raw}`,
    scan.location ? `at ${scan.location}` : null,
  ]
    .filter(Boolean)
    .join(" — ");

  // A dead courier job on the reverse leg does NOT cancel the return. The
  // customer's request stands; only the pickup needs rebooking. Flagging it
  // through `nimbusError` puts the row back in the "Pickup failed" filter,
  // which is where someone will actually see it.
  const cancelled = proposed === null && isCancelledReverseScan(scan.raw);

  const moved = await record(
    returnId,
    { status: proposed ?? undefined, note, by: scan.by },
    {
      ...(scan.courier ? { nimbusCourier: scan.courier } : {}),
      ...(cancelled
        ? {
            nimbusError: `The courier reported "${scan.raw}" on the reverse leg — the pickup is dead and needs rebooking. The return itself is still open.`,
          }
        : // Real progress clears a stale failure. Without this, a return that
          // failed once and was then rebooked would keep its old error, sit in
          // the "Pickup failed" filter forever and read as broken while the
          // parcel was already on its way back.
          proposed
          ? { nimbusError: null }
          : {}),
    }
  );

  /**
   * Tell the customer their parcel moved — **now, not on the next cron pass.**
   *
   * `record` returns a status only when one genuinely advanced
   * (`advanceReturnStatus` answers `null` for a repeat, a late scan or a
   * terminal row), so this fires on real movement and on nothing else.
   *
   * Until this line the reverse leg had no call site at all: courier-driven
   * pickups reached the engine only through `sweepReturnStatuses`, which runs
   * inside the automation pass every 15–60 minutes. That worked, and "your
   * return was collected" arriving up to an hour after the courier left is
   * still the wrong message at the wrong time — the customer has watched
   * somebody take their parcel and heard nothing.
   *
   * **The sweep stays**, and the two are not a duplicate. Both land on the
   * same `<returnId>:<status>` dedupe key, so whichever gets there first wins
   * at the unique index and the other is skipped — the engine's header names
   * exactly this case ("two firing sites for one event") as the reason that
   * key has the status in it. The sweep is now the net for a scan this process
   * never saw, rather than the only way one is ever noticed.
   *
   * Imported dynamically, the way `lib/fulfilment.ts` does it: the engine
   * pulls in Prisma, Resend and the push stack, and this module is reached
   * from a webhook that must not pay for any of that on a scan that changes
   * nothing.
   */
  if (moved) {
    const { runAutomationTrigger } = await import("./automation");
    await runAutomationTrigger("return.status_changed", { id: returnId }).catch(
      (err) => console.error("[nimbus-returns] reverse-leg automation failed:", err)
    );
  }

  return moved;
}

/**
 * A reverse scan that means the pickup will not happen.
 *
 * Read off the raw text rather than `mapNimbusStatus`, which maps these to the
 * order status `cancelled` — correct for a forward parcel, meaningless for a
 * return whose own status must not become "cancelled" because a courier
 * cancelled a job.
 */
function isCancelledReverseScan(raw: string): boolean {
  const v = raw.trim().toLowerCase();
  return (
    v.includes("cancel") ||
    v.includes("pickup failed") ||
    v.includes("pickup cancelled") ||
    isRtoStatus(v)
  );
}

/**
 * One pass of the reverse auto-sync: every return whose courier leg could still
 * move.
 *
 * The counterpart of `syncAllOpenOrders`, which only ever looks at `Order` and
 * so leaves every reverse shipment permanently unsynced. Terminal returns are
 * skipped — there is nothing left to learn about a refunded or rejected one.
 */
export async function syncAllOpenReturns(limit = 40) {
  if (!isNimbusPostConfigured()) {
    return { ok: false as const, error: "NimbusPost isn't configured." };
  }
  const settings = await getSettings();
  if (!settings.nimbusEnabled) {
    return { ok: false as const, error: "NimbusPost shipping is turned off." };
  }

  const rows = await prisma.returnRequest
    .findMany({
      where: {
        status: { notIn: ["refunded", "rejected", "cancelled"] },
        OR: [{ nimbusAwb: { not: null } }, { nimbusOrderId: { not: null } }],
      },
      orderBy: { updatedAt: "asc" },
      take: limit,
      select: { id: true, requestNumber: true },
    })
    .catch(() => []);

  let booked = 0;
  let tracked = 0;
  let waiting = 0;
  let failed = 0;

  for (const r of rows) {
    const res = await syncReturnFromNimbus(r.id);
    if (!res.ok) {
      failed += 1;
      console.error(`[nimbus-returns] ${r.requestNumber}: ${res.error}`);
      continue;
    }
    if (res.outcome === "booked") booked += 1;
    else if (res.outcome === "tracked") tracked += 1;
    else waiting += 1;
  }

  return { ok: true as const, checked: rows.length, booked, tracked, waiting, failed };
}

/* -------------------------------------------------------------------- RTO */

/**
 * A forward shipment the courier is carrying back to us because delivery
 * failed.
 *
 * RTO is not a customer-raised return and has no `ReturnRequest` behind it, but
 * it ends the same way — stock on our shelf, and money the customer may be owed
 * on a prepaid order. Nothing in the pipeline says so today: `mapNimbusStatus`
 * turns `rto delivered` into the order status `cancelled`, which silently emails
 * the customer that their order was cancelled and leaves no trace that goods are
 * in the building.
 *
 * Detected by reading `Order.deliveryStatus` — the raw courier text the webhook
 * and the poller both already write — so this needs no new column. The same
 * signal `lib/analytics.ts` counts, surfaced where it can be acted on.
 */
export type RtoOrder = {
  id: string;
  orderNumber: string;
  customerName: string;
  status: string;
  deliveryStatus: string | null;
  deliveryStatusAt: Date | null;
  trackingNumber: string | null;
  courier: string | null;
  total: number;
  amountPaid: number;
  /** True when the customer paid online and is therefore owed money back. */
  owesRefund: boolean;
  /** A return already covers this order, so it is not an orphan. */
  hasReturn: boolean;
};

/**
 * Orders whose latest courier scan mentions RTO, newest first.
 *
 * Deliberately a `contains` filter on the raw status rather than a status
 * lookup: there is no RTO order status to query, which is precisely why these
 * were invisible.
 */
export async function listRtoOrders(limit = 25): Promise<RtoOrder[]> {
  const rows = await prisma.order
    .findMany({
      where: {
        OR: [
          { deliveryStatus: { contains: "rto", mode: "insensitive" } },
          { deliveryStatus: { contains: "return to origin", mode: "insensitive" } },
        ],
      },
      orderBy: { deliveryStatusAt: "desc" },
      take: limit,
      select: {
        id: true,
        orderNumber: true,
        customerName: true,
        status: true,
        deliveryStatus: true,
        deliveryStatusAt: true,
        trackingNumber: true,
        courier: true,
        total: true,
        amountPaid: true,
        returnRequests: { select: { id: true }, take: 1 },
      },
    })
    .catch(() => []);

  return rows.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    customerName: o.customerName,
    status: o.status,
    deliveryStatus: o.deliveryStatus,
    deliveryStatusAt: o.deliveryStatusAt,
    trackingNumber: o.trackingNumber,
    courier: o.courier,
    total: o.total,
    amountPaid: o.amountPaid,
    // COD collects nothing until delivery, so a failed COD delivery owes the
    // customer nothing. A prepaid or part-paid one has their money.
    owesRefund: o.amountPaid > 0,
    hasReturn: o.returnRequests.length > 0,
  }));
}
