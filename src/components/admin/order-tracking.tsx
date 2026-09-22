"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  ExternalLink,
  FileText,
  Loader2,
  Lock,
  MapPin,
  PackageCheck,
  RefreshCw,
  Truck,
  X,
} from "lucide-react";
import { cn, formatINR } from "@/lib/utils";
import { InfoTip } from "@/components/store/info-tip";
import { CopyableId } from "@/components/admin/copy-id";
import { Badge, Btn, BtnLink, LabelledField } from "@/components/admin/order-ui";
import type { AdminOrder, CourierOption } from "@/components/admin/order-types";
import { shipmentGateFor } from "@/lib/orders-pipeline";
import type { Collection } from "@/lib/orders-pipeline";
import {
  chooseCourierAction,
  draftOrderInNimbusAction,
  getCourierOptionsAction,
  shipOrderNowAction,
  syncOrderFromNimbusAction,
  updateOrderTracking,
} from "@/app/actions/admin";

/**
 * The shipment half of an order.
 *
 * ## The state machine
 *
 * `shipmentGateFor()` (pure, in `lib/orders-pipeline.ts`, and the same function
 * the server actions enforce) answers one question — may this order reach the
 * courier right now — and this panel draws one of four things from its answer:
 *
 * | gate            | what is on screen                                  |
 * |-----------------|----------------------------------------------------|
 * | `booked`        | tracking only: courier, AWB, link, last scan, Sync |
 * | `pending`       | one sentence saying to confirm it first            |
 * | `closed`        | one sentence: cancelled / payment failed           |
 * | allowed         | **Ship now** and **Draft in NimbusPost**           |
 *
 * Three things this fixes, all of which were live:
 *
 * 1. **A booked parcel was still offered booking controls.** They were hidden
 *    on `trackingNumber`, but the panel beneath them then showed the AWB and
 *    the courier in *editable* inputs and nothing read-only — so the one fact
 *    you open a shipped order to read was a text box you could quietly break.
 *    Now a booked order gets a tracking view, and the hand-editing lives behind
 *    a fold that says what it is for.
 * 2. **A pending order was offered "Send draft".** Nobody has accepted that
 *    order yet. It now says why, in one line, instead of showing a control that
 *    the server would refuse.
 * 3. **One button meant two things.** Its label flipped between "Send draft"
 *    (free) and "Book & generate AWB" (spends the wallet) on hidden state, same
 *    colour, no confirmation. They are two buttons now, and the one that costs
 *    money names the courier, the charge and what the courier will collect
 *    before it runs.
 */
export function OrderTracking({ order }: { order: AdminOrder }) {
  const gate = shipmentGateFor(order);

  if (gate.allowed) return <ShipmentActions order={order} />;
  if (gate.code === "booked") return <BookedShipment order={order} />;
  return <ShipmentBlocked order={order} code={gate.code} reason={gate.reason} />;
}

/* ------------------------------------------------------------------ */
/*  1. Blocked — pending, cancelled, payment failed                     */
/* ------------------------------------------------------------------ */

/**
 * One sentence, no controls.
 *
 * A disabled button is a worse answer than a sentence: it still reads as
 * "ship this", it gives no reason, and on a phone it is a 44px target that
 * does nothing. So the whole shipment UI is simply absent here.
 */
function ShipmentBlocked({
  order,
  code,
  reason,
}: {
  order: AdminOrder;
  code: "pending" | "closed";
  reason: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start gap-2 rounded-lg border p-2.5",
        code === "pending"
          ? "border-border bg-muted/30"
          : "border-border bg-muted/20"
      )}
    >
      <Lock
        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
        {reason}
        <InfoTip term="Why there is nothing to press">
          {code === "pending" ? (
            <>
              Confirming is the point an order stops being a request and becomes
              work: the customer is emailed and a free, unbooked draft is staged
              with NimbusPost. Use <b>Confirm order</b> above. Shipping controls
              appear here the moment it is confirmed.
            </>
          ) : (
            <>
              Nothing can be sent to the courier for an order that was cancelled
              or whose payment failed. If this one really is going out, move it
              back to <b>Confirmed</b> with the status control above first.
            </>
          )}
        </InfoTip>
      </p>
      {order.nimbusShipmentId && (
        <Badge tone="info" title="A draft was staged before this order reached its current state.">
          Draft still in NimbusPost
        </Badge>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  2. Booked — tracking only                                          */
/* ------------------------------------------------------------------ */

/**
 * What an already-shipped parcel shows: courier, AWB, tracking link, the latest
 * scan, and Sync. **No booking controls at all** — this is the requirement the
 * old panel broke, and the reason is money: a second booking is a second AWB,
 * a second parcel and a second charge against one order.
 */
function BookedShipment({ order }: { order: AdminOrder }) {
  const router = useRouter();
  const [syncing, startSync] = useTransition();
  const [editing, setEditing] = useState(false);

  // Only a parcel this app staged can be looked up in NimbusPost; a hand-typed
  // AWB has nothing there to sync against.
  const viaNimbus = Boolean(order.nimbusShipmentId);
  const awb = order.trackingNumber ?? "";

  function sync() {
    startSync(async () => {
      const res = await syncOrderFromNimbusAction(order.id);
      if (!res.ok) {
        toast.error(res.error || "Could not sync", { duration: 8000 });
        return;
      }
      if (res.outcome === "tracked") {
        toast.success(
          res.deliveryStatus
            ? `Courier says: ${res.deliveryStatus}`
            : "No new scan from the courier yet."
        );
      } else if (res.outcome === "not-booked") {
        toast.info(`NimbusPost still reports this as ${res.orderStatus}.`);
      } else {
        toast.success(`Synced — AWB ${res.awb}`);
      }
      router.refresh();
    });
  }

  return (
    <div className="space-y-2.5">
      {/* ---- The shipment, read-only ---- */}
      <div className="rounded-lg border border-accent/40 bg-accent/5 p-2.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <PackageCheck className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
          <span className="text-xs font-medium">
            Booked{order.courier ? ` with ${order.courier}` : ""}
          </span>
          <InfoTip term="Booked">
            This parcel has an AWB, so it exists with the courier. Booking
            controls are hidden on purpose — booking again would create a second
            shipment and charge your NimbusPost wallet twice for one order.
          </InfoTip>
        </div>

        <dl className="mt-2 space-y-1">
          <TrackRow label="Courier" value={order.courier ?? "Not recorded"} />
          <TrackRow label="AWB" value={<CopyableId id={awb} label="AWB" />} />
          <TrackRow
            label="Tracking link"
            value={
              order.trackingUrl ? (
                <BtnLink
                  href={order.trackingUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-2"
                >
                  <ExternalLink className="h-3 w-3" aria-hidden /> Open
                </BtnLink>
              ) : (
                <span className="text-muted-foreground">None saved</span>
              )
            }
          />
        </dl>
      </div>

      {/* ---- Latest scan ---- */}
      <div className="rounded-lg border border-border bg-muted/30 p-2.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="font-medium">
            {order.deliveryStatus ?? "Awaiting first scan"}
          </span>
          {order.deliveryLocation && (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <MapPin className="h-3 w-3" aria-hidden /> {order.deliveryLocation}
            </span>
          )}
          {order.deliveryStatusAt && (
            <span className="text-muted-foreground tabular-nums">
              {new Date(order.deliveryStatusAt).toLocaleString("en-IN")}
            </span>
          )}
          <InfoTip term="Courier scans">
            Scans arrive on their own every 2 hours and whenever NimbusPost
            sends a status webhook, so this is usually already current. Sync
            asks the courier right now.
            {order.lastSyncedAt
              ? ` Last checked ${new Date(order.lastSyncedAt).toLocaleString("en-IN")}.`
              : ""}
          </InfoTip>

          {viaNimbus && (
            <Btn
              tone="outline"
              onClick={sync}
              disabled={syncing}
              className="ml-auto"
              title="Ask NimbusPost where this parcel is now"
            >
              {syncing ? (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="h-3 w-3" aria-hidden />
              )}
              Sync
            </Btn>
          )}
        </div>
      </div>

      {/* ---- Hand-editing, folded ----
          Kept, because a parcel booked outside NimbusPost is tracked entirely
          from here and a wrong link has to be fixable. Folded, because after a
          real booking these three fields are a *second writer* for columns the
          courier owns — the same shape of bug as the two editors CLAUDE.md
          records for `defaultReturnsInfo`. */}
      {editing ? (
        <ManualTracking order={order} onClose={() => setEditing(false)} />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg text-[11px] text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9"
        >
          Correct the courier details by hand
        </button>
      )}
    </div>
  );
}

/**
 * One `term: value` line of the booked shipment. Wraps, never truncates — an
 * AWB the admin cannot read is not a tracking view.
 *
 * `min-h-11` on a phone because two of these hold real controls (the copy
 * button and the tracking link) and a row that hugs an 19px glyph is a
 * mis-tap between packing parcels.
 */
function TrackRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border/60 text-xs last:border-0 sm:min-h-9">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 font-medium">{value}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  3. Ready to ship — two explicit actions                            */
/* ------------------------------------------------------------------ */

function ShipmentActions({ order }: { order: AdminOrder }) {
  const router = useRouter();
  const [drafting, startDraft] = useTransition();
  const [syncing, startSync] = useTransition();
  const [picking, setPicking] = useState(false);

  const staged = Boolean(order.nimbusShipmentId);

  function draft() {
    startDraft(async () => {
      const res = await draftOrderInNimbusAction(order.id);
      if (!res.ok) {
        toast.error(res.error, { duration: 10000 });
        return;
      }
      toast.success(
        res.alreadyStaged
          ? "A draft was already waiting in NimbusPost."
          : "Draft staged in NimbusPost — no courier, no AWB, nothing charged.",
        {
          description:
            "Open the NimbusPost dashboard to book it, then press Sync here to pull the AWB back.",
          duration: 9000,
        }
      );
      router.refresh();
    });
  }

  function sync() {
    startSync(async () => {
      const res = await syncOrderFromNimbusAction(order.id);
      if (!res.ok) {
        toast.error(res.error || "Could not sync", { duration: 8000 });
        return;
      }
      if (res.outcome === "not-booked") {
        toast.info(
          `Not booked in NimbusPost yet (status: ${res.orderStatus}). The draft is still waiting there.`,
          { duration: 7000 }
        );
      } else if (res.outcome === "tracked") {
        toast.success(res.deliveryStatus ?? "No new scan yet.");
      } else {
        toast.success(
          `Synced — AWB ${res.awb}${res.courier ? ` (${res.courier})` : ""}`
        );
      }
      router.refresh();
    });
  }

  const busy = drafting || syncing;

  return (
    <div className="space-y-2.5">
      {/* ---- Where this order stands ---- */}
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
        {staged ? (
          <>
            <Badge tone="info">
              <FileText className="h-2.5 w-2.5" aria-hidden /> Draft staged
            </Badge>
            An unbooked draft is waiting in NimbusPost. Nothing has been charged.
          </>
        ) : (
          <>
            <Badge tone="neutral">
              <Truck className="h-2.5 w-2.5" aria-hidden /> Not staged
            </Badge>
            Nothing has been sent to NimbusPost for this order yet.
          </>
        )}
        <InfoTip term="Draft vs booked">
          A <b>draft</b> is an unbooked order sitting in NimbusPost: no courier,
          no AWB, no charge, and you can delete it there. <b>Booking</b>{" "}
          allocates the courier, generates the AWB and takes the money out of
          your NimbusPost wallet. Those are the two buttons below, and they are
          separate on purpose.
        </InfoTip>
      </p>

      {/* ---- The two actions ---- */}
      <div className="flex flex-wrap items-center gap-2">
        <Btn
          tone="accent"
          onClick={() => setPicking((v) => !v)}
          disabled={busy}
          aria-expanded={picking}
          title="Pick a courier from the live rates and book the AWB now"
        >
          {picking ? (
            <>
              <X className="h-3.5 w-3.5" aria-hidden /> Cancel
            </>
          ) : (
            <>
              <Truck className="h-3.5 w-3.5" aria-hidden /> Ship now
            </>
          )}
        </Btn>

        <Btn
          tone="outline"
          onClick={draft}
          disabled={busy || picking || staged}
          title={
            staged
              ? "A draft is already staged — book it in the NimbusPost dashboard, then press Sync"
              : "Stage the unbooked draft only. Free, and you can delete it in NimbusPost."
          }
        >
          {drafting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <FileText className="h-3.5 w-3.5" aria-hidden />
          )}
          {staged ? "Draft staged" : "Draft in NimbusPost"}
        </Btn>

        {staged && (
          <Btn
            onClick={sync}
            disabled={busy || picking}
            title="Booked it in the NimbusPost dashboard? Pull the AWB in."
          >
            {syncing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            )}
            Sync from NimbusPost
          </Btn>
        )}
      </div>

      {!picking && (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          <b className="text-foreground">Ship now</b> charges your NimbusPost
          wallet and generates the AWB here.{" "}
          <b className="text-foreground">Draft in NimbusPost</b> costs nothing
          and leaves the booking to you in their dashboard.
        </p>
      )}

      {/* Conditionally rendered, never parked offscreen with a transform —
          see the modal note in CLAUDE.md. */}
      {picking && (
        <CourierPicker order={order} onDone={() => setPicking(false)} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Ship now: live rates → choose → book                               */
/* ------------------------------------------------------------------ */

/**
 * The "Ship now" flow, in one panel: fetch the live rates for this parcel and
 * pincode, show what the courier will be told to collect, and book on one
 * confirmed press.
 *
 * The collection line is read straight off `resolveCollection()` via the
 * server — it is not recomputed here. That rule is what stops a prepaid
 * customer being charged a second time at their door, and the point of
 * printing it above the Book buttons is that it is checkable *before* the
 * money moves rather than after.
 */
function CourierPicker({
  order,
  onDone,
}: {
  order: AdminOrder;
  onDone: () => void;
}) {
  const router = useRouter();
  const [booking, startBook] = useTransition();
  const [loading, setLoading] = useState(true);
  const [options, setOptions] = useState<CourierOption[] | null>(null);
  const [collection, setCollection] = useState<Collection | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  // Quoted on mount rather than behind another press: "Ship now" is one
  // decision, and making the admin ask for rates and then ask to book is the
  // two-step flow this panel replaced.
  //
  // `loading` starts true from `useState` rather than being set here: the panel
  // is conditionally rendered, so it mounts fresh for exactly one order and an
  // effect that opens by calling setState is a cascading render for nothing.
  // `cancelled` guards the unmount — closing the panel mid-request is normal.
  const orderId = order.id;
  useEffect(() => {
    let cancelled = false;
    getCourierOptionsAction(orderId)
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) setQuoteError(res.error);
        else {
          setOptions(res.options);
          setCollection(res.collection);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setQuoteError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  function book(option: CourierOption | null) {
    const who = option ? option.name : "whichever courier NimbusPost allocates";
    const charge = option
      ? `Your NimbusPost wallet will be charged ${formatINR(option.total)}.`
      : "Your NimbusPost wallet will be charged at NimbusPost's rate.";
    const collects = collection
      ? collection.paymentType === "cod"
        ? `The courier will collect ${formatINR(collection.collectAmount)} at the door.`
        : "The courier will collect nothing at the door."
      : "";

    if (
      !confirm(
        `Book order ${order.orderNumber} with ${who}?\n\n${charge}\n${collects}\n\nThis generates a real AWB and cannot be undone from this screen.`
      )
    ) {
      return;
    }

    startBook(async () => {
      const res = await shipOrderNowAction(
        order.id,
        option?.courierId ?? null,
        option?.name ?? null
      );
      if (!res.ok) {
        // The draft survives a failed booking, so say so — otherwise the
        // operator re-drafts and ends up with two orders in NimbusPost.
        toast.error(res.error, {
          description:
            "Nothing was booked and nothing was charged. Any draft in NimbusPost is still there.",
          duration: 14000,
        });
        router.refresh();
        return;
      }
      toast.success(
        `Booked — AWB ${res.awb}${res.courier ? ` (${res.courier})` : ""}`,
        { duration: 8000 }
      );
      if (res.courierMismatch) {
        toast.warning(res.courierMismatch, { duration: 12000 });
      }
      onDone();
      router.refresh();
    });
  }

  function clearChoice() {
    startBook(async () => {
      await chooseCourierAction(order.id, null, null);
      toast.success("Courier choice cleared");
      router.refresh();
    });
  }

  return (
    <div className="overflow-hidden rounded-lg border border-accent/40">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-accent/5 px-3 py-2">
        <p className="text-[11px] font-medium uppercase tracking-wider">
          Ship now — pick a courier
        </p>
        <InfoTip term="Courier rates">
          What your NimbusPost wallet is charged if you book with that courier —
          forward leg, return-to-origin and the COD collection fee. Cheapest
          first. Booking is immediate and generates the AWB here.
        </InfoTip>
      </div>

      {/* What the courier collects. Stated before any Book button, because it
          is the one number that costs a customer real money if it is wrong. */}
      {collection && (
        <p
          className={cn(
            "flex flex-wrap items-center gap-1.5 border-b border-border px-3 py-2 text-xs",
            collection.paymentType === "cod"
              ? "bg-orange-500/10 text-orange-700 dark:text-orange-400"
              : "bg-muted/40 text-muted-foreground"
          )}
        >
          {collection.paymentType === "cod" ? (
            <>
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="font-medium">
                The courier collects {formatINR(collection.collectAmount)} at the
                door.
              </span>
            </>
          ) : (
            <>
              <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>Prepaid — the courier collects nothing.</span>
            </>
          )}
          <InfoTip term="What the courier collects">
            {collection.reason}
          </InfoTip>
        </p>
      )}

      {loading && (
        <p className="flex items-center gap-2 px-3 py-4 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          Checking live rates for {order.pincode}…
        </p>
      )}

      {quoteError && (
        <div className="space-y-2 p-3">
          <p className="flex items-start gap-1.5 text-xs text-danger">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>{quoteError}</span>
          </p>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Rates and booking are different endpoints, so a quote that fails does
            not mean the booking will. You can let NimbusPost allocate a courier
            instead — you will still see which one it picked.
          </p>
          <Btn tone="accent" onClick={() => book(null)} disabled={booking}>
            {booking && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            Book without choosing
          </Btn>
        </div>
      )}

      {options && options.length > 0 && (
        // The one place a horizontal scroller is acceptable: six numeric
        // columns that mean nothing stacked. It scrolls inside its own card,
        // so the page itself never overflows at 320px.
        <div className="max-h-72 overflow-auto overscroll-contain">
          <table className="w-full min-w-[540px] text-xs">
            <thead className="sticky top-0 bg-card">
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-2.5 py-1.5 font-medium">Courier</th>
                <th className="px-2.5 py-1.5 font-medium">ETA</th>
                <th className="px-2.5 py-1.5 font-medium">Forward</th>
                <th className="px-2.5 py-1.5 font-medium">RTO</th>
                <th className="px-2.5 py-1.5 font-medium">COD</th>
                <th className="px-2.5 py-1.5 font-medium">Charge</th>
                <th className="px-2.5 py-1.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {options.map((c, i) => {
                const picked = order.nimbusCourierId === c.courierId;
                return (
                  <tr key={c.courierId} className={picked ? "bg-accent/5" : ""}>
                    <td className="px-2.5 py-1.5">
                      <span className="font-medium">{c.name}</span>
                      {i === 0 && (
                        <Badge tone="success" className="ml-1.5">
                          cheapest
                        </Badge>
                      )}
                      {picked && (
                        <Badge tone="accent" className="ml-1.5">
                          chosen
                        </Badge>
                      )}
                      {c.type && (
                        <span className="block text-[10px] text-muted-foreground">
                          {c.type}
                          {c.chargeableGrams
                            ? ` · charged for ${c.chargeableGrams} g`
                            : ""}
                        </span>
                      )}
                    </td>
                    <td className="px-2.5 py-1.5 text-muted-foreground">
                      {c.tatDays ? `${c.tatDays} d` : "—"}
                    </td>
                    <td className="px-2.5 py-1.5 tabular-nums">
                      {formatINR(c.forward)}
                    </td>
                    <td className="px-2.5 py-1.5 tabular-nums text-muted-foreground">
                      {c.rto ? formatINR(c.rto) : "—"}
                    </td>
                    <td className="px-2.5 py-1.5 tabular-nums text-muted-foreground">
                      {c.cod ? formatINR(c.cod) : "—"}
                    </td>
                    <td className="px-2.5 py-1.5 font-medium tabular-nums">
                      {formatINR(c.total)}
                    </td>
                    <td className="px-2.5 py-1.5 text-right">
                      <Btn
                        tone="accent"
                        onClick={() => book(c)}
                        disabled={booking}
                        // Full 44px on a phone rather than the usual dense
                        // table height: this is the button that spends money,
                        // in a row you reach by scrolling sideways.
                        className="px-2"
                        title={`Book with ${c.name} and charge your wallet ${formatINR(c.total)}`}
                      >
                        {booking ? (
                          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                        ) : (
                          "Book"
                        )}
                      </Btn>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {options && options.length === 0 && (
        <p className="p-3 text-xs text-muted-foreground">
          No courier quoted a rate for this parcel and pincode.
        </p>
      )}

      {order.nimbusCourierName && (
        <p className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
          Saved choice: <b className="text-foreground">{order.nimbusCourierName}</b>
          <button
            type="button"
            onClick={clearChoice}
            disabled={booking}
            className="inline-flex min-h-11 cursor-pointer items-center underline underline-offset-2 hover:text-foreground disabled:opacity-50 sm:min-h-0"
          >
            clear
          </button>
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Manual courier fields                                              */
/* ------------------------------------------------------------------ */

/**
 * The by-hand courier/AWB/link editor, for a parcel shipped outside
 * NimbusPost — or to correct a link. Only ever reached deliberately, from the
 * fold on a booked shipment, so it can never be mistaken for the way to ship
 * an order.
 */
function ManualTracking({
  order,
  onClose,
}: {
  order: AdminOrder;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [courier, setCourier] = useState(order.courier ?? "");
  const [trackingNumber, setTrackingNumber] = useState(order.trackingNumber ?? "");
  const [trackingUrl, setTrackingUrl] = useState(order.trackingUrl ?? "");

  function save() {
    start(async () => {
      const res = await updateOrderTracking(order.id, {
        courier,
        trackingNumber,
        trackingUrl,
      });
      if (res.ok) {
        toast.success("Tracking saved");
        onClose();
        router.refresh();
      } else toast.error(res.error || "Failed to save");
    });
  }

  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-2.5">
      <p className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
        Editing the courier details by hand
        <InfoTip term="Editing by hand">
          These three fields are what the customer sees on their order and in
          their account. For a parcel booked through NimbusPost they are written
          by the courier sync, so anything you type here will be overwritten the
          next time a scan arrives. Use it for a parcel booked outside
          NimbusPost, or to fix a broken tracking link.
        </InfoTip>
      </p>

      <div className="grid gap-2 sm:grid-cols-3">
        <LabelledField label="Courier">
          <input
            value={courier}
            onChange={(e) => setCourier(e.target.value)}
            className="input h-11 text-xs sm:h-9"
            placeholder="e.g. Delhivery"
          />
        </LabelledField>
        <LabelledField label="Tracking number">
          <input
            value={trackingNumber}
            onChange={(e) => setTrackingNumber(e.target.value)}
            className="input h-11 text-xs sm:h-9"
            placeholder="e.g. 1234567890"
          />
        </LabelledField>
        <LabelledField label="Tracking URL">
          <input
            value={trackingUrl}
            onChange={(e) => setTrackingUrl(e.target.value)}
            className="input h-11 text-xs sm:h-9"
            placeholder="https://…"
          />
        </LabelledField>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <Btn tone="ghost" onClick={onClose} disabled={pending}>
          Cancel
        </Btn>
        <Btn tone="solid" onClick={save} disabled={pending}>
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          Save tracking
        </Btn>
      </div>
    </div>
  );
}
