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
} from "lucide-react";
import { formatINR, whatsappLink } from "@/lib/utils";
import {
  updateOrderStatus,
  updatePaymentStatus,
  updateOrderTracking,
  shipOrderViaNimbus,
  cancelAndRestoreStock,
  confirmOrder,
  addOrderNote,
} from "@/app/actions/admin";

function orderWhatsAppMessage(o: AdminOrder): string {
  const lines = [
    `Hi ${o.customerName.split(" ")[0]}, thank you for your order with Level7 Clothing! 🧡`,
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
  note: string | null;
  createdAt: string;
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

export function OrdersTable({ orders }: { orders: AdminOrder[] }) {
  const router = useRouter();
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
                        <li key={i} className="flex justify-between">
                          <span>
                            {it.name} × {it.quantity}
                            {it.options && it.options.length > 0 && (
                              <span className="block text-xs text-muted-foreground">
                                {it.options
                                  .map((op) => `${op.name}: ${op.value}`)
                                  .join(" · ")}
                              </span>
                            )}
                          </span>
                          <span className="font-medium">
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
                        href={whatsappLink(o.phone, orderWhatsAppMessage(o))}
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
      if (res.ok) {
        toast.success(
          `Dispatched — AWB ${res.awb}${res.courier ? ` (${res.courier})` : ""}`
        );
        router.refresh();
      } else toast.error(res.error || "Could not dispatch", { duration: 10000 });
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
          ? "A draft shipment is staged in NimbusPost — one click generates the AWB."
          : "Generate a courier + AWB via NimbusPost, or enter tracking manually."}{" "}
        Saved details show in the customer&apos;s account.
      </p>

      {!order.trackingNumber && (
        <button
          onClick={shipViaNimbus}
          disabled={shipping}
          className="mt-3 inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-xs font-medium text-accent-foreground disabled:opacity-50 cursor-pointer"
        >
          {shipping ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Dispatching…
            </>
          ) : (
            <>
              <Truck className="h-3.5 w-3.5" />{" "}
              {staged ? "Dispatch (generate AWB)" : "Dispatch via NimbusPost"}
            </>
          )}
        </button>
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
