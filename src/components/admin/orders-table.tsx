"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ChevronDown,
  Loader2,
  Truck,
  MessageCircle,
  XCircle,
  CheckCircle2,
  MessageSquare,
  RefreshCw,
  ExternalLink,
  Check,
  MapPin,
} from "lucide-react";
import { formatINR, whatsappLink } from "@/lib/utils";
import { CopyableId } from "@/components/admin/copy-id";
import {
  updateOrderStatus,
  updatePaymentStatus,
  updateOrderTracking,
  shipOrderViaNimbus,
  syncOrderFromNimbusAction,
  getCourierOptionsAction,
  chooseCourierAction,
  cancelAndRestoreStock,
  confirmOrder,
  addOrderNote,
} from "@/app/actions/admin";
import { useSettings } from "@/context/settings";

function orderWhatsAppMessage(o: AdminOrder, brandName: string): string {
  const lines = [
    `Hi ${o.customerName.split(" ")[0]}, thank you for your order with ${brandName}! 🖤`,
    ``,
    `Order: ${o.orderNumber}`,
    ...o.items.map((i) => `• ${i.name} × ${i.quantity}`),
    `Total: ${formatINR(o.total)} (${o.paymentMethod})`,
  ];
  if (o.trackingNumber) {
    lines.push(
      ``,
      `Courier: ${o.courier ?? "—"}`,
      `Tracking: ${o.trackingNumber}`
    );
    if (o.trackingUrl) lines.push(o.trackingUrl);
  }
  lines.push(``, `We'll keep you posted on delivery. Thank you! 🙏`);
  return lines.join("\n");
}

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
  items: {
    /** Present on orders placed after line items started recording it. */
    productId?: string;
    /** Resolved server-side; null when the product has since been deleted. */
    slug?: string | null;
    name: string;
    quantity: number;
    price: number;
    options?: { name: string; value: string }[];
  }[];
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
  note: string | null;
  createdAt: string;
  /** How many return requests this order has. */
  returnCount: number;
};

type CourierOption = {
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

const STATUSES = [
  "pending",
  "confirmed",
  "shipped",
  "delivered",
  "cancelled",
  "payment_failed",
];

const statusColor: Record<string, string> = {
  pending: "bg-accent/15 text-accent",
  confirmed: "bg-blue-500/15 text-blue-500",
  shipped: "bg-purple-500/15 text-purple-500",
  delivered: "bg-success/15 text-success",
  cancelled: "bg-danger/15 text-danger",
  payment_failed: "bg-rose-500/15 text-rose-500 border border-rose-500/30",
};

// A short payment badge shown next to the order status.
function paymentBadge(o: AdminOrder): { text: string; cls: string } {
  if (o.paymentStatus === "paid")
    return { text: "Paid", cls: "bg-success/15 text-success" };
  if (o.paymentStatus === "partial")
    return { text: "Part-paid", cls: "bg-blue-500/15 text-blue-500" };
  if (o.paymentStatus === "failed")
    return { text: "Payment failed", cls: "bg-danger/15 text-danger" };
  if (o.paymentMethod === "Direct")
    return { text: "Customised", cls: "bg-muted text-muted-foreground" };
  return { text: "COD due", cls: "bg-orange-500/15 text-orange-500" };
}

/**
 * How much of the return window is left for an order — the same rule the
 * storefront uses (counted from delivery, never from the order date).
 * `windowDays` is null when returns are switched off store-wide.
 */
function returnWindowState(
  o: AdminOrder,
  windowDays: number | null
): { label: string; cls: string; title: string } | null {
  if (windowDays == null) return null;
  if (o.status === "cancelled") return null;
  if (o.status !== "delivered") {
    return {
      label: "returns: not delivered",
      cls: "bg-muted text-muted-foreground",
      title: `The ${windowDays}-day return window starts when you mark this order delivered.`,
    };
  }
  // deliveryStatusAt is stamped when the status flips to delivered (or by the
  // courier scan), so a delivered order always has a date to count from.
  const from = o.deliveryStatusAt ? new Date(o.deliveryStatusAt) : new Date(o.createdAt);
  const daysLeft =
    windowDays - Math.floor((Date.now() - from.getTime()) / 86_400_000);
  if (daysLeft > 0) {
    return {
      label: `returns: ${daysLeft}d left`,
      cls: "bg-success/15 text-success",
      title: `Delivered ${from.toLocaleDateString("en-IN")} — the customer can raise a return for ${daysLeft} more day(s).`,
    };
  }
  return {
    label: "returns: closed",
    cls: "bg-muted text-muted-foreground",
    title: `The ${windowDays}-day window closed. The customer can no longer raise a return themselves.`,
  };
}

export function OrdersTable({
  orders,
  returnWindowDays,
}: {
  orders: AdminOrder[];
  /** null = returns are switched off in Admin > Returns. */
  returnWindowDays: number | null;
}) {
  const router = useRouter();
  const { brandName } = useSettings();
  const [openId, setOpenId] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function changeStatus(id: string, status: string) {
    start(async () => {
      const res = await updateOrderStatus(id, status);
      if (res.ok) {
        toast.success(`Status updated to “${status}” — customer notified`);
        router.refresh();
      } else toast.error(res.error || "Failed");
    });
  }

  function changePaymentStatus(id: string, newPaymentStatus: string) {
    start(async () => {
      await updatePaymentStatus(id, newPaymentStatus);
      toast.success(`Payment status updated to “${newPaymentStatus}”`);
      router.refresh();
    });
  }

  function cancelOrder(id: string) {
    if (!confirm("Cancel this order and restore stock? This cannot be undone.")) return;
    start(async () => {
      const res = await cancelAndRestoreStock(id);
      if (res.ok) {
        toast.success("Order cancelled — stock restored");
        router.refresh();
      } else toast.error(res.error || "Failed to cancel");
    });
  }

  function acceptOrder(id: string) {
    start(async () => {
      const res = await confirmOrder(id);
      if (res.ok) {
        const draft = res.draft;
        if (draft && draft.ok && !draft.skipped) {
          toast.success("Order confirmed — draft shipment created in NimbusPost");
        } else if (draft && !draft.ok && draft.error) {
          toast.success("Order confirmed", {
            description: `Customer emailed. Shipment draft skipped: ${draft.error}`,
          });
        } else {
          toast.success("Order confirmed — customer notified");
        }
        router.refresh();
      } else toast.error(res.error || "Failed to confirm");
    });
  }

  return (
    <div className="space-y-3">
      {orders.map((o) => {
        const open = openId === o.id;
        return (
          <div
            key={o.id}
            className="overflow-hidden rounded-2xl border border-border bg-card"
          >
            <button
              onClick={() => setOpenId(open ? null : o.id)}
              className="flex w-full items-center gap-4 px-5 py-4 text-left"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{o.customerName}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs capitalize ${
                      statusColor[o.status] ?? "bg-muted"
                    }`}
                  >
                    {o.status.replace("_", " ")}
                  </span>
                  {(() => {
                    const b = paymentBadge(o);
                    return (
                      <span className={`rounded-full px-2 py-0.5 text-xs ${b.cls}`}>
                        {b.text}
                      </span>
                    );
                  })()}
                  {o.returnCount > 0 && (
                    <span className="rounded-full bg-danger/15 px-2 py-0.5 text-xs text-danger">
                      {o.returnCount} return{o.returnCount === 1 ? "" : "s"}
                    </span>
                  )}
                  {(() => {
                    const rw = returnWindowState(o, returnWindowDays);
                    if (!rw) return null;
                    return (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${rw.cls}`}
                        title={rw.title}
                      >
                        {rw.label}
                      </span>
                    );
                  })()}
                </div>
                <p className="text-xs text-muted-foreground">
                  {o.orderNumber} · {new Date(o.createdAt).toLocaleString("en-IN")}
                </p>
              </div>
              <span className="text-right font-medium">
                {formatINR(o.total)}
              </span>
              <ChevronDown
                className={`h-4 w-4 text-muted-foreground transition-transform ${
                  open ? "rotate-180" : ""
                }`}
              />
            </button>

            {open && (
              <div className="border-t border-border px-5 py-5 text-sm">
                <div className="grid gap-6 md:grid-cols-2">
                  {/* Items list */}
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Items ({o.items.length})
                    </p>
                    <ul className="mt-2 space-y-1.5">
                      {o.items.map((it, i) => (
                        <li key={i} className="flex justify-between gap-3">
                          <span className="min-w-0">
                            {it.slug ? (
                              <a
                                href={`/product/${it.slug}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Open this product on the store"
                                className="inline-flex items-baseline gap-1 font-medium underline-offset-2 hover:underline"
                              >
                                {it.name}
                                <ExternalLink className="h-3 w-3 shrink-0 self-center opacity-60" />
                              </a>
                            ) : (
                              <span className="font-medium">{it.name}</span>
                            )}{" "}
                            × {it.quantity}
                            {it.options && it.options.length > 0 && (
                              <span className="block text-xs text-muted-foreground">
                                {it.options
                                  .map((op) => `${op.name}: ${op.value}`)
                                  .join(" · ")}
                              </span>
                            )}
                            {it.productId && (
                              <span className="mt-1 block">
                                <CopyableId id={it.productId} />
                                {!it.slug && (
                                  <span className="ml-1.5 text-[11px] text-muted-foreground">
                                    · product no longer in the catalogue
                                  </span>
                                )}
                              </span>
                            )}
                          </span>
                          <span className="whitespace-nowrap font-medium">
                            {formatINR(it.price * it.quantity)}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-3 space-y-1 border-t border-border pt-2 text-xs">
                      <div className="flex justify-between text-muted-foreground">
                        <span>Subtotal</span>
                        <span>{formatINR(o.subtotal)}</span>
                      </div>
                      <div className="flex justify-between text-muted-foreground">
                        <span>Shipping</span>
                        <span>
                          {o.shipping === 0 ? "Free" : formatINR(o.shipping)}
                        </span>
                      </div>
                      {o.discountTotal ? (
                        <div className="flex justify-between text-success">
                          <span>Discount {o.couponCode ? `(${o.couponCode})` : ""}</span>
                          <span>-{formatINR(o.discountTotal)}</span>
                        </div>
                      ) : null}
                      <div className="flex justify-between font-medium text-foreground text-sm">
                        <span>Total</span>
                        <span>{formatINR(o.total)}</span>
                      </div>
                      {o.amountPaid > 0 && (
                        <div className="flex justify-between text-success">
                          <span>Paid online</span>
                          <span>{formatINR(o.amountPaid)}</span>
                        </div>
                      )}
                      {o.balanceDue > 0 && (
                        <div className="flex justify-between font-medium text-accent">
                          <span>COD / Balance due</span>
                          <span>{formatINR(o.balanceDue)}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Customer & Actions */}
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Customer &amp; Delivery
                    </p>
                    <div className="mt-2 text-xs text-muted-foreground">
                      <p className="text-foreground">{o.customerName}</p>
                      <p>{o.email}</p>
                      <p>{o.phone}</p>
                      <p className="mt-1">
                        {o.address}, {o.city}, {o.state} - {o.pincode}
                      </p>
                    </div>

                    {/* Accept a pending (COD/Direct) order before fulfilment. */}
                    {o.status === "pending" && (
                      <div className="mt-4 rounded-xl border border-accent/40 bg-accent/5 p-3">
                        <p className="text-xs text-muted-foreground">
                          {o.paymentStatus === "paid"
                            ? "Paid online — auto-confirmed."
                            : "This order is awaiting your acceptance before it can be dispatched."}
                        </p>
                        <button
                          onClick={() => acceptOrder(o.id)}
                          disabled={pending}
                          className="mt-2 inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
                        >
                          <CheckCircle2 className="h-4 w-4" /> Confirm order
                        </button>
                      </div>
                    )}

                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      {/* Order status dropdown */}
                      <label className="flex items-center gap-2 text-sm">
                        Status
                        <select
                          value={o.status}
                          disabled={pending}
                          onChange={(e) => changeStatus(o.id, e.target.value)}
                          className="input h-9 w-auto capitalize"
                        >
                          {STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {s.replace("_", " ")}
                            </option>
                          ))}
                        </select>
                      </label>
                      {returnWindowDays != null && o.status !== "delivered" && (
                        <p className="w-full text-xs text-muted-foreground">
                          Marking this <b>delivered</b> starts the{" "}
                          {returnWindowDays}-day return window — until then the
                          customer can&apos;t raise a return.
                        </p>
                      )}

                      {/* Payment status dropdown */}
                      <label className="flex items-center gap-2 text-sm">
                        Payment
                        <select
                          value={o.paymentStatus}
                          disabled={pending}
                          onChange={(e) => changePaymentStatus(o.id, e.target.value)}
                          className="input h-9 w-auto capitalize"
                        >
                          <option value="pending">Pending</option>
                          <option value="paid">Paid</option>
                          <option value="partial">Partial</option>
                          <option value="failed">Payment Failed</option>
                        </select>
                      </label>

                      <a
                        href={whatsappLink(o.phone, orderWhatsAppMessage(o, brandName))}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-full bg-[#25D366]/15 px-3 py-1.5 text-xs font-medium text-[#128C7E] hover:bg-[#25D366]/25"
                        title="Send order confirmation to the customer on WhatsApp"
                      >
                        <MessageCircle className="h-3.5 w-3.5" />
                        WhatsApp customer
                      </a>

                      {/* Cancel & restore stock */}
                      {o.status !== "cancelled" && o.paymentStatus !== "paid" && (
                        <button
                          onClick={() => cancelOrder(o.id)}
                          disabled={pending}
                          className="inline-flex items-center gap-1.5 rounded-full bg-danger/10 px-3 py-1.5 text-xs font-medium text-danger hover:bg-danger/20 disabled:opacity-50"
                          title="Cancel this order and immediately return reserved stock"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          Cancel &amp; restore stock
                        </button>
                      )}
                    </div>

                    {/* Admin Note / Comment Editor */}
                    <AdminNoteEditor order={o} />

                    {/* Tracking details */}
                    <TrackingEditor order={o} />
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AdminNoteEditor({ order }: { order: AdminOrder }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [noteText, setNoteText] = useState(order.note ?? "");

  function saveNote() {
    start(async () => {
      const res = await addOrderNote(order.id, noteText);
      if (res.ok) {
        toast.success("Order note saved — visible to customer");
        router.refresh();
      } else {
        toast.error(res.error || "Failed to save note");
      }
    });
  }

  return (
    <div className="mt-4 rounded-xl border border-border bg-muted/20 p-3.5">
      <label className="block">
        <span className="mb-1.5 flex items-center justify-between text-xs font-medium">
          <span className="flex items-center gap-1.5">
            <MessageSquare className="h-3.5 w-3.5 text-accent" />
            Admin Note / Comment for Customer
          </span>
          <span className="text-[11px] font-normal text-muted-foreground">
            Visible on customer order status
          </span>
        </span>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="e.g. Payment failed on online gateway, customisation update..."
            className="input h-9 text-xs flex-1"
          />
          <button
            type="button"
            onClick={saveNote}
            disabled={pending}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3.5 text-xs font-medium text-accent-foreground hover:bg-accent/90 disabled:opacity-50 cursor-pointer"
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save note"}
          </button>
        </div>
      </label>
    </div>
  );
}

function TrackingEditor({ order }: { order: AdminOrder }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [shipping, startShip] = useTransition();
  const [syncing, startSync] = useTransition();
  const [courier, setCourier] = useState(order.courier ?? "");
  const [trackingNumber, setTrackingNumber] = useState(
    order.trackingNumber ?? ""
  );
  const [trackingUrl, setTrackingUrl] = useState(order.trackingUrl ?? "");

  function save() {
    start(async () => {
      const res = await updateOrderTracking(order.id, {
        courier,
        trackingNumber,
        trackingUrl,
      });
      if (res.ok) {
        toast.success("Tracking details saved");
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
        toast.info(
          `Not booked in NimbusPost yet (status: ${res.orderStatus}).`,
          { duration: 6000 }
        );
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

  // ---- Available couriers (reviewed before the draft is booked) ----
  const [couriers, setCouriers] = useState<CourierOption[] | null>(null);
  const [loadingCouriers, startCouriers] = useTransition();
  const [choosing, startChoose] = useTransition();

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

  return (
    <div className="mt-4 rounded-xl border border-border p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Truck className="h-4 w-4 text-muted-foreground" />
        Shipment tracking
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {staged
          ? "A draft is staged in NimbusPost. Review it there, then book here — or book it in their dashboard and press Sync to pull the AWB back."
          : "Step 1 sends an unbooked draft to NimbusPost for review. Nothing is booked and no wallet charge happens until you book it."}{" "}
        Saved details show in the customer&apos;s account.
      </p>

      {!order.trackingNumber && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={shipViaNimbus}
            disabled={shipping || syncing}
            className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-xs font-medium text-accent-foreground disabled:opacity-50 cursor-pointer"
          >
            {shipping ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />{" "}
                {staged ? "Booking…" : "Sending draft…"}
              </>
            ) : (
              <>
                <Truck className="h-3.5 w-3.5" />{" "}
                {staged ? "Book & generate AWB" : "Send draft to NimbusPost"}
              </>
            )}
          </button>

          <button
            onClick={loadCouriers}
            disabled={loadingCouriers || shipping}
            className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-medium disabled:opacity-50 cursor-pointer hover:bg-muted"
            title="See every courier that will carry this parcel, with rates"
          >
            {loadingCouriers ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking…
              </>
            ) : (
              <>
                <Truck className="h-3.5 w-3.5" />{" "}
                {couriers ? "Hide couriers" : "Available couriers & rates"}
              </>
            )}
          </button>

          {staged && (
            <button
              onClick={syncFromNimbus}
              disabled={shipping || syncing}
              className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-medium disabled:opacity-50 cursor-pointer hover:bg-muted"
              title="Already booked it in the NimbusPost dashboard? Pull the AWB in."
            >
              {syncing ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Syncing…
                </>
              ) : (
                <>
                  <RefreshCw className="h-3.5 w-3.5" /> Sync from NimbusPost
                </>
              )}
            </button>
          )}
        </div>
      )}

      {order.nimbusCourierName && !order.trackingNumber && (
        <p className="mt-2 text-xs">
          <span className="rounded-full bg-accent/15 px-2.5 py-1 text-accent">
            Will book with {order.nimbusCourierName}
          </span>{" "}
          <button
            onClick={() => chooseCourier(null)}
            disabled={choosing}
            className="cursor-pointer text-muted-foreground underline disabled:opacity-50"
          >
            clear
          </button>
        </p>
      )}

      {couriers && !order.trackingNumber && (
        <div className="mt-3 overflow-hidden rounded-xl border border-border">
          <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2">
            <p className="text-xs font-medium">
              {couriers.length} couriers serve this pincode
            </p>
            <p className="text-[11px] text-muted-foreground">
              Rates are what your NimbusPost wallet gets charged
            </p>
          </div>
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Courier</th>
                  <th className="px-3 py-2 font-medium">ETA</th>
                  <th className="px-3 py-2 font-medium">Forward</th>
                  <th className="px-3 py-2 font-medium">RTO</th>
                  <th className="px-3 py-2 font-medium">COD</th>
                  <th className="px-3 py-2 font-medium">Total</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {couriers.map((c, i) => {
                  const picked = order.nimbusCourierId === c.courierId;
                  return (
                    <tr key={c.courierId} className={picked ? "bg-accent/5" : ""}>
                      <td className="px-3 py-2">
                        <span className="font-medium">{c.name}</span>
                        {i === 0 && (
                          <span className="ml-1.5 rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] text-success">
                            cheapest
                          </span>
                        )}
                        {c.type && (
                          <span className="block text-[11px] text-muted-foreground">
                            {c.type}
                            {c.chargeableGrams
                              ? ` · charged for ${c.chargeableGrams} g`
                              : ""}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {c.tatDays ? `${c.tatDays} d` : "—"}
                      </td>
                      <td className="px-3 py-2">{formatINR(c.forward)}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {c.rto ? formatINR(c.rto) : "—"}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {c.cod ? formatINR(c.cod) : "—"}
                      </td>
                      <td className="px-3 py-2 font-semibold">
                        {formatINR(c.total)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={() => chooseCourier(picked ? null : c)}
                          disabled={choosing}
                          className={`cursor-pointer rounded-full border px-2.5 py-1 text-[11px] disabled:opacity-50 ${
                            picked
                              ? "border-accent bg-accent text-accent-foreground"
                              : "border-border hover:bg-muted"
                          }`}
                        >
                          {picked ? (
                            <>
                              <Check className="mr-1 inline h-3 w-3" />
                              Chosen
                            </>
                          ) : (
                            "Choose"
                          )}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {order.trackingNumber && (
        <div className="mt-3 rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-xs">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
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
            <button
              onClick={syncFromNimbus}
              disabled={syncing}
              className="ml-auto inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[11px] hover:bg-muted disabled:opacity-50"
            >
              {syncing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              Refresh now
            </button>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Updates automatically every 2 hours and whenever NimbusPost sends a
            status webhook.
            {order.lastSyncedAt &&
              ` Last checked ${new Date(order.lastSyncedAt).toLocaleString("en-IN")}.`}
          </p>
        </div>
      )}
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">
            Courier
          </span>
          <input
            value={courier}
            onChange={(e) => setCourier(e.target.value)}
            className="input h-9"
            placeholder="e.g. Delhivery"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">
            Tracking number
          </span>
          <input
            value={trackingNumber}
            onChange={(e) => setTrackingNumber(e.target.value)}
            className="input h-9"
            placeholder="e.g. 1234567890"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">
            Tracking URL (optional)
          </span>
          <input
            value={trackingUrl}
            onChange={(e) => setTrackingUrl(e.target.value)}
            className="input h-9"
            placeholder="https://…"
          />
        </label>
      </div>
      <div className="mt-3 text-right">
        <button
          onClick={save}
          disabled={pending}
          className="rounded-full border border-border px-4 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50 cursor-pointer"
        >
          Save tracking details
        </button>
      </div>
    </div>
  );
}
