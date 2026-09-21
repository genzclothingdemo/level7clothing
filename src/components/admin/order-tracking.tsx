"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Loader2, MapPin, RefreshCw, Truck } from "lucide-react";
import { formatINR } from "@/lib/utils";
import { InfoTip } from "@/components/store/info-tip";
import { Badge, Btn, LabelledField } from "@/components/admin/order-ui";
import type { AdminOrder, CourierOption } from "@/components/admin/order-types";
import {
  chooseCourierAction,
  getCourierOptionsAction,
  shipOrderViaNimbus,
  syncOrderFromNimbusAction,
  updateOrderTracking,
} from "@/app/actions/admin";

/**
 * The shipment half of an order: draft → book → AWB, plus the manual courier
 * fields for anything shipped outside NimbusPost.
 *
 * Split out of `orders-table.tsx` (which was 931 lines) so the order detail
 * reads as five blocks rather than one wall. The two-step draft/book flow is
 * deliberate — see the "Draft-first" note in CLAUDE.md. Long explanations that
 * used to sit here as paragraphs are now `(i)` tips.
 */
export function OrderTracking({ order }: { order: AdminOrder }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [shipping, startShip] = useTransition();
  const [syncing, startSync] = useTransition();
  const [courier, setCourier] = useState(order.courier ?? "");
  const [trackingNumber, setTrackingNumber] = useState(order.trackingNumber ?? "");
  const [trackingUrl, setTrackingUrl] = useState(order.trackingUrl ?? "");
  const [couriers, setCouriers] = useState<CourierOption[] | null>(null);
  const [loadingCouriers, startCouriers] = useTransition();
  const [choosing, startChoose] = useTransition();

  function save() {
    start(async () => {
      const res = await updateOrderTracking(order.id, {
        courier,
        trackingNumber,
        trackingUrl,
      });
      if (res.ok) {
        toast.success("Tracking saved");
        router.refresh();
      } else toast.error(res.error || "Failed to save");
    });
  }

  function shipViaNimbus() {
    startShip(async () => {
      const res = await shipOrderViaNimbus(order.id);
      if (!res.ok) {
        toast.error(res.error || "Could not dispatch", { duration: 10000 });
        return;
      }
      if (res.outcome === "drafted") {
        toast.success(
          "Draft sent to NimbusPost — review it there, then book to generate the AWB.",
          { duration: 8000 }
        );
      } else {
        toast.success(
          `Booked — AWB ${res.awb}${res.courier ? ` (${res.courier})` : ""}`
        );
        // NimbusPost decides the carrier; if it overrode the choice, say so.
        if (res.courierMismatch) {
          toast.warning(res.courierMismatch, { duration: 10000 });
        }
      }
      router.refresh();
    });
  }

  function syncFromNimbus() {
    startSync(async () => {
      const res = await syncOrderFromNimbusAction(order.id);
      if (!res.ok) {
        toast.error(res.error || "Could not sync", { duration: 8000 });
        return;
      }
      if (res.outcome === "not-booked") {
        toast.info(`Not booked in NimbusPost yet (status: ${res.orderStatus}).`, {
          duration: 6000,
        });
        router.refresh();
        return;
      }
      if (res.outcome === "tracked") {
        toast.success(
          res.deliveryStatus
            ? `Courier says: ${res.deliveryStatus}`
            : "No new scan from the courier yet."
        );
        router.refresh();
        return;
      }
      toast.success(
        `Synced — AWB ${res.awb}${res.courier ? ` (${res.courier})` : ""}`
      );
      router.refresh();
    });
  }

  function loadCouriers() {
    if (couriers) {
      setCouriers(null); // toggle closed
      return;
    }
    startCouriers(async () => {
      const res = await getCourierOptionsAction(order.id);
      if (!res.ok) {
        toast.error(res.error, { duration: 8000 });
        return;
      }
      setCouriers(res.options);
    });
  }

  function chooseCourier(option: CourierOption | null) {
    startChoose(async () => {
      await chooseCourierAction(
        order.id,
        option?.courierId ?? null,
        option?.name ?? null
      );
      toast.success(
        option ? `${option.name} selected for this order` : "Courier choice cleared"
      );
      router.refresh();
    });
  }

  const staged = Boolean(order.nimbusShipmentId);
  const booked = Boolean(order.trackingNumber);

  return (
    <div className="space-y-3">
      {/* ---- Live courier status ---- */}
      {booked && (
        <div className="rounded-lg border border-border bg-muted/30 p-2.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span className="font-medium">
              {order.deliveryStatus ?? "Awaiting first scan"}
            </span>
            {order.deliveryLocation && (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <MapPin className="h-3 w-3" /> {order.deliveryLocation}
              </span>
            )}
            {order.deliveryStatusAt && (
              <span className="text-muted-foreground">
                {new Date(order.deliveryStatusAt).toLocaleString("en-IN")}
              </span>
            )}
            <InfoTip term="Auto-sync">
              Courier scans arrive on their own every 2 hours and whenever
              NimbusPost sends a status webhook.
              {order.lastSyncedAt
                ? ` Last checked ${new Date(order.lastSyncedAt).toLocaleString("en-IN")}.`
                : ""}
            </InfoTip>
            <Btn
              tone="outline"
              onClick={syncFromNimbus}
              disabled={syncing}
              className="ml-auto"
            >
              {syncing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              Refresh
            </Btn>
          </div>
        </div>
      )}

      {/* ---- Draft → book ---- */}
      {!booked && (
        <div className="space-y-2">
          <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            {staged ? "Draft staged in NimbusPost." : "Not sent to NimbusPost yet."}
            <InfoTip term="NimbusPost draft">
              A draft is an unbooked order: no courier, no AWB and no wallet
              charge until you book it. Book it here, or book it in the
              NimbusPost dashboard and press Sync to pull the AWB back.
            </InfoTip>
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <Btn tone="accent" onClick={shipViaNimbus} disabled={shipping || syncing}>
              {shipping ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {staged ? "Booking…" : "Sending…"}
                </>
              ) : (
                <>
                  <Truck className="h-3.5 w-3.5" />
                  {staged ? "Book & generate AWB" : "Send draft"}
                </>
              )}
            </Btn>

            <Btn
              onClick={loadCouriers}
              disabled={loadingCouriers || shipping}
              title="Every courier that will carry this parcel, with rates"
            >
              {loadingCouriers ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking…
                </>
              ) : (
                <>
                  <Truck className="h-3.5 w-3.5" />
                  {couriers ? "Hide couriers" : "Couriers & rates"}
                </>
              )}
            </Btn>

            {staged && (
              <Btn
                onClick={syncFromNimbus}
                disabled={shipping || syncing}
                title="Already booked it in the NimbusPost dashboard? Pull the AWB in."
              >
                {syncing ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Syncing…
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-3.5 w-3.5" /> Sync
                  </>
                )}
              </Btn>
            )}
          </div>

          {order.nimbusCourierName && (
            <p className="flex flex-wrap items-center gap-2 text-xs">
              <Badge tone="accent">Will book with {order.nimbusCourierName}</Badge>
              <button
                type="button"
                onClick={() => chooseCourier(null)}
                disabled={choosing}
                className="inline-flex min-h-11 cursor-pointer items-center text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50 sm:min-h-0"
              >
                clear
              </button>
            </p>
          )}
        </div>
      )}

      {/* ---- Courier rate table ---- */}
      {couriers && !booked && (
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="flex items-center gap-1 border-b border-border bg-muted/40 px-3 py-2">
            <p className="text-[11px] font-medium">
              {couriers.length} couriers serve this pincode
            </p>
            <InfoTip term="Courier rates">
              What your NimbusPost wallet is charged if you book with that
              courier — forward leg, return-to-origin, and the COD collection
              fee. The cheapest is listed first.
            </InfoTip>
          </div>
          {/* The only place a horizontal scroller is acceptable: six numeric
              columns that mean nothing stacked. It scrolls inside its own card,
              so the page itself never overflows at 320px. */}
          <div className="max-h-72 overflow-auto">
            <table className="w-full min-w-[520px] text-xs">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-2.5 py-1.5 font-medium">Courier</th>
                  <th className="px-2.5 py-1.5 font-medium">ETA</th>
                  <th className="px-2.5 py-1.5 font-medium">Forward</th>
                  <th className="px-2.5 py-1.5 font-medium">RTO</th>
                  <th className="px-2.5 py-1.5 font-medium">COD</th>
                  <th className="px-2.5 py-1.5 font-medium">Total</th>
                  <th className="px-2.5 py-1.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {couriers.map((c, i) => {
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
                          tone={picked ? "accent" : "outline"}
                          onClick={() => chooseCourier(picked ? null : c)}
                          disabled={choosing}
                          className="min-h-8 px-2 sm:min-h-8"
                        >
                          {picked ? (
                            <>
                              <Check className="h-3 w-3" /> Chosen
                            </>
                          ) : (
                            "Choose"
                          )}
                        </Btn>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ---- Manual courier fields ---- */}
      <div className="grid gap-2 sm:grid-cols-3">
        <LabelledField
          label="Courier"
          hint={
            <InfoTip term="Manual tracking">
              For a parcel booked outside NimbusPost. Whatever you save here is
              what the customer sees on their order and in their account.
            </InfoTip>
          }
        >
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
      <div className="flex justify-end">
        <Btn tone="solid" onClick={save} disabled={pending}>
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Save tracking
        </Btn>
      </div>
    </div>
  );
}
