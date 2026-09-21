"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  CheckCircle2,
  ChevronDown,
  CreditCard,
  ExternalLink,
  History,
  Loader2,
  MapPin,
  MessageCircle,
  MessageSquare,
  Package,
  Pencil,
  Sparkles,
  Truck,
  User,
  XCircle,
} from "lucide-react";
import { formatINR, whatsappLink } from "@/lib/utils";
import { CopyableId } from "@/components/admin/copy-id";
import { InfoTip } from "@/components/store/info-tip";
import { ExpandableText } from "@/components/store/expandable-text";
import {
  Badge,
  Block,
  Btn,
  BtnLink,
  LabelledField,
  Line,
  type BadgeTone,
} from "@/components/admin/order-ui";
import { OrderTracking } from "@/components/admin/order-tracking";
import type {
  AdminOrder,
  AdminOrderItem,
  StatusEntry,
} from "@/components/admin/order-types";
import {
  addOrderNote,
  cancelAndRestoreStock,
  confirmOrder,
  setCustomerNote,
  updateOrderStatus,
  updatePaymentStatus,
} from "@/app/actions/admin";
import { useSettings } from "@/context/settings";

/** Re-exported so the page keeps importing the type from here. */
export type { AdminOrder } from "@/components/admin/order-types";

const STATUSES = [
  "pending",
  "confirmed",
  "shipped",
  "delivered",
  "cancelled",
  "payment_failed",
];

const STATUS_TONE: Record<string, BadgeTone> = {
  pending: "warn",
  confirmed: "info",
  shipped: "accent",
  delivered: "success",
  cancelled: "danger",
  payment_failed: "danger",
};

function orderWhatsAppMessage(o: AdminOrder, brandName: string): string {
  const lines = [
    `Hi ${o.customerName.split(" ")[0]}, thank you for your order with ${brandName}! 🖤`,
    ``,
    `Order: ${o.orderNumber}`,
    ...o.items.map((i) => `• ${i.name} × ${i.quantity}`),
    `Total: ${formatINR(o.total)} (${o.paymentMethod})`,
  ];
  if (o.trackingNumber) {
    lines.push(``, `Courier: ${o.courier ?? "—"}`, `Tracking: ${o.trackingNumber}`);
    if (o.trackingUrl) lines.push(o.trackingUrl);
  }
  lines.push(``, `We'll keep you posted on delivery. Thank you! 🙏`);
  return lines.join("\n");
}

/** A short payment badge shown next to the order status. */
function paymentBadge(o: AdminOrder): { text: string; tone: BadgeTone } {
  if (o.paymentStatus === "paid") return { text: "Paid", tone: "success" };
  if (o.paymentStatus === "partial") return { text: "Part-paid", tone: "info" };
  if (o.paymentStatus === "failed") return { text: "Payment failed", tone: "danger" };
  if (o.paymentMethod === "Direct") return { text: "Customised", tone: "neutral" };
  return { text: "COD due", tone: "warn" };
}

/**
 * How much of the return window is left for an order — the same rule the
 * storefront uses (counted from delivery, never from the order date).
 * `windowDays` is null when returns are switched off store-wide.
 */
function returnWindowState(
  o: AdminOrder,
  windowDays: number | null
): { label: string; tone: BadgeTone; title: string } | null {
  if (windowDays == null) return null;
  if (o.status === "cancelled") return null;
  if (o.status !== "delivered") {
    return {
      label: "returns: not delivered",
      tone: "neutral",
      title: `The ${windowDays}-day return window starts when you mark this order delivered.`,
    };
  }
  // deliveryStatusAt is stamped when the status flips to delivered (or by the
  // courier scan), so a delivered order always has a date to count from.
  const from = o.deliveryStatusAt
    ? new Date(o.deliveryStatusAt)
    : new Date(o.createdAt);
  const daysLeft =
    windowDays - Math.floor((Date.now() - from.getTime()) / 86_400_000);
  if (daysLeft > 0) {
    return {
      label: `returns: ${daysLeft}d left`,
      tone: "success",
      title: `Delivered ${from.toLocaleDateString("en-IN")} — the customer can raise a return for ${daysLeft} more day(s).`,
    };
  }
  return {
    label: "returns: closed",
    tone: "neutral",
    title: `The ${windowDays}-day window closed. The customer can no longer raise a return themselves.`,
  };
}

/**
 * Made-to-order lines in this order. The `needsCustomisation` column is
 * denormalised at checkout, but the per-item flags come from the live
 * catalogue — so orders placed before the column existed still light up.
 */
function customItems(o: AdminOrder): AdminOrderItem[] {
  return o.items.filter((i) => i.isCustomisable);
}

function isCustom(o: AdminOrder): boolean {
  return o.needsCustomisation || customItems(o).length > 0;
}

export function OrdersTable({
  orders,
  returnWindowDays,
}: {
  orders: AdminOrder[];
  /** null = returns are switched off in Admin > Returns. */
  returnWindowDays: number | null;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      {orders.map((o) => (
        <OrderRow
          key={o.id}
          order={o}
          returnWindowDays={returnWindowDays}
          open={openId === o.id}
          onToggle={() => setOpenId(openId === o.id ? null : o.id)}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  One order: summary row + expanded detail                           */
/* ------------------------------------------------------------------ */

function OrderRow({
  order: o,
  returnWindowDays,
  open,
  onToggle,
}: {
  order: AdminOrder;
  returnWindowDays: number | null;
  open: boolean;
  onToggle: () => void;
}) {
  const pay = paymentBadge(o);
  const rw = returnWindowState(o, returnWindowDays);
  const custom = isCustom(o);
  const itemCount = o.items.reduce((n, i) => n + i.quantity, 0);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      {/* Summary. Stays a stacked card at every width — ten columns of table
          would only scroll sideways on a phone. */}
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/40"
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="min-w-0 max-w-full truncate text-sm font-medium">
              {o.customerName}
            </span>
            <span className="font-mono text-[11px] text-muted-foreground">
              {o.orderNumber}
            </span>
          </span>

          <span className="mt-1 flex flex-wrap items-center gap-1">
            <Badge tone={STATUS_TONE[o.status] ?? "neutral"}>
              {o.status.replace("_", " ")}
            </Badge>
            <Badge tone={pay.tone}>{pay.text}</Badge>
            {custom && (
              <Badge tone="accent" title="A made-to-order piece — collect the customisation details before dispatch">
                <Sparkles className="h-2.5 w-2.5" /> Needs customisation
              </Badge>
            )}
            {o.returnCount > 0 && (
              <Badge tone="danger">
                {o.returnCount} return{o.returnCount === 1 ? "" : "s"}
              </Badge>
            )}
            {rw && (
              <Badge tone={rw.tone} title={rw.title}>
                {rw.label}
              </Badge>
            )}
          </span>

          <span className="mt-1 block text-[11px] text-muted-foreground">
            {new Date(o.createdAt).toLocaleString("en-IN")} · {itemCount} item
            {itemCount === 1 ? "" : "s"}
          </span>
        </span>

        <span className="shrink-0 text-sm font-medium tabular-nums">
          {formatINR(o.total)}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && <OrderDetail order={o} returnWindowDays={returnWindowDays} />}
    </div>
  );
}

function OrderDetail({
  order: o,
  returnWindowDays,
}: {
  order: AdminOrder;
  returnWindowDays: number | null;
}) {
  const { brandName } = useSettings();
  const custom = customItems(o);
  const flagged = isCustom(o);
  const pay = paymentBadge(o);

  return (
    <div className="grid gap-2.5 border-t border-border bg-muted/20 p-2.5 md:grid-cols-2">
      {/* ---- Customisation banner ---- */}
      {flagged && (
        <div className="rounded-lg border border-accent/40 bg-accent/10 p-2.5 md:col-span-2">
          <p className="flex flex-wrap items-center gap-1 text-xs font-medium text-accent">
            <Sparkles className="h-3.5 w-3.5" /> Needs customisation
            <InfoTip term="Needs customisation">
              At least one piece in this order is made to order. Collect the
              details below from the customer before you book the shipment —
              customised pieces are also non-returnable by default.
            </InfoTip>
          </p>
          {custom.length > 0 ? (
            <ul className="mt-1.5 space-y-1">
              {custom.map((it, i) => (
                <li key={i} className="text-xs">
                  <span className="font-medium">{it.name}</span>
                  {it.customisationNote ? (
                    <span className="text-muted-foreground">
                      {" "}
                      — collect: {it.customisationNote}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">
                      {" "}
                      — no collection note on this product yet
                    </span>
                  )}
                  {it.note ? (
                    <span className="mt-0.5 block text-muted-foreground">
                      Customer wrote: {it.note}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">
              Flagged at checkout. The product has since changed, so check with
              the customer what they expect.
            </p>
          )}
        </div>
      )}

      {/* ---- Customer & delivery ---- */}
      <Block title="Customer & delivery address" icon={User}>
        <div className="space-y-1 text-xs">
          <p className="font-medium">{o.customerName}</p>
          <p>
            <a
              href={`mailto:${o.email}`}
              className="break-all text-muted-foreground underline-offset-2 hover:text-accent hover:underline"
            >
              {o.email}
            </a>
          </p>
          <p>
            <a
              href={`tel:${o.phone}`}
              className="text-muted-foreground underline-offset-2 hover:text-accent hover:underline"
            >
              {o.phone}
            </a>
          </p>
          <p className="flex gap-1.5 pt-1 text-muted-foreground">
            <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
            <span>
              {o.address}, {o.city}, {o.state} - {o.pincode}
            </span>
          </p>
        </div>
        <div className="mt-2.5">
          <BtnLink
            href={whatsappLink(o.phone, orderWhatsAppMessage(o, brandName))}
            target="_blank"
            rel="noreferrer"
            className="border border-[#25D366]/45 text-[#128C7E] hover:bg-[#25D366]/10 dark:text-[#25D366]"
            title="Send the order summary to the customer on WhatsApp"
          >
            <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
          </BtnLink>
        </div>
      </Block>

      {/* ---- Items ---- */}
      <Block
        title="Items"
        icon={Package}
        aside={<Badge>{o.items.length}</Badge>}
        bodyClassName="p-0"
      >
        <ul className="divide-y divide-border">
          {o.items.map((it, i) => (
            <ItemRow key={i} item={it} />
          ))}
        </ul>
      </Block>

      {/* ---- Payment ---- */}
      <Block
        title="Payment"
        icon={CreditCard}
        aside={<Badge tone={pay.tone}>{pay.text}</Badge>}
      >
        <div className="space-y-1">
          <Line label="Subtotal" value={formatINR(o.subtotal)} />
          <Line
            label="Shipping"
            value={o.shipping === 0 ? "Free" : formatINR(o.shipping)}
          />
          {o.discountTotal ? (
            <Line
              label={`Discount${o.couponCode ? ` (${o.couponCode})` : ""}`}
              value={`-${formatINR(o.discountTotal)}`}
              tone="success"
            />
          ) : null}
          <div className="mt-1 border-t border-border pt-1">
            <Line
              label="Total"
              value={formatINR(o.total)}
              tone="foreground"
              strong
            />
          </div>
          {o.amountPaid > 0 && (
            <Line label="Paid online" value={formatINR(o.amountPaid)} tone="success" />
          )}
          {o.balanceDue > 0 && (
            <Line
              label="Balance due"
              value={formatINR(o.balanceDue)}
              tone="accent"
              strong
            />
          )}
          <div className="pt-1">
            <Line label="Method" value={o.paymentMethod} />
          </div>
        </div>

        <div className="mt-2.5">
          <PaymentStatusPicker order={o} />
        </div>
      </Block>

      {/* ---- Notes ---- */}
      <NotesBlock order={o} />

      {/* ---- Fulfilment & tracking ---- */}
      <Block title="Fulfilment & tracking" icon={Truck} className="md:col-span-2">
        <StatusControls order={o} returnWindowDays={returnWindowDays} />
        <div className="mt-2.5 border-t border-border pt-2.5">
          <OrderTracking order={o} />
        </div>
      </Block>

      {/* ---- History ---- */}
      <Block title="History" icon={History} className="md:col-span-2">
        <HistoryList entries={o.statusHistory} />
      </Block>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Items                                                              */
/* ------------------------------------------------------------------ */

function ItemRow({ item: it }: { item: AdminOrderItem }) {
  // A slug only exists when the product is still in the catalogue, so it is
  // also what decides whether the admin edit link is safe to render. A deleted
  // product renders as plain text — never a link that 404s.
  const live = Boolean(it.slug);

  return (
    <li className="flex gap-2.5 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
          {live ? (
            <a
              href={`/product/${it.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              title="Open this product on the store"
              className="font-medium underline-offset-2 hover:text-accent hover:underline"
            >
              {it.name}
            </a>
          ) : (
            <span className="font-medium">{it.name}</span>
          )}
          <span className="text-muted-foreground">× {it.quantity}</span>
          {it.isCustomisable && (
            <Badge tone="accent">
              <Sparkles className="h-2.5 w-2.5" /> Customise
            </Badge>
          )}
        </p>

        {it.options && it.options.length > 0 && (
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {it.options.map((op) => `${op.name}: ${op.value}`).join(" · ")}
          </p>
        )}

        {/* 44px tall on phones so these are thumb-sized, tight on desktop. */}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          {live ? (
            <>
              <a
                href={`/product/${it.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center gap-1 text-muted-foreground underline-offset-2 hover:text-accent hover:underline sm:min-h-0"
              >
                <ExternalLink className="h-3 w-3" /> Store page
              </a>
              <a
                href={`/admin/products/${it.productId}/edit`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center gap-1 text-muted-foreground underline-offset-2 hover:text-accent hover:underline sm:min-h-0"
              >
                <Pencil className="h-3 w-3" /> Edit product
              </a>
            </>
          ) : (
            <span className="text-muted-foreground">
              Product no longer in the catalogue
            </span>
          )}
          {it.productId && <CopyableId id={it.productId} />}
        </div>
      </div>

      <span className="shrink-0 text-xs font-medium tabular-nums">
        {formatINR(it.price * it.quantity)}
      </span>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/*  Payment status                                                     */
/* ------------------------------------------------------------------ */

function PaymentStatusPicker({ order }: { order: AdminOrder }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function change(next: string) {
    start(async () => {
      await updatePaymentStatus(order.id, next);
      toast.success(`Payment marked “${next}”`);
      router.refresh();
    });
  }

  return (
    <LabelledField
      label="Payment status"
      hint={
        <InfoTip term="Payment status">
          What you have actually collected. Partial payment means an advance was
          paid online and the rest is due on delivery — it does not change what
          the courier collects, so update it after you reconcile.
        </InfoTip>
      }
    >
      <select
        value={order.paymentStatus}
        disabled={pending}
        onChange={(e) => change(e.target.value)}
        className="input h-11 text-xs capitalize sm:h-9"
      >
        <option value="pending">Pending</option>
        <option value="paid">Paid</option>
        <option value="partial">Partial</option>
        <option value="failed">Payment failed</option>
      </select>
    </LabelledField>
  );
}

/* ------------------------------------------------------------------ */
/*  Status + order-level actions                                       */
/* ------------------------------------------------------------------ */

function StatusControls({
  order: o,
  returnWindowDays,
}: {
  order: AdminOrder;
  returnWindowDays: number | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [status, setStatus] = useState(o.status);
  const [note, setNote] = useState("");

  function applyStatus() {
    start(async () => {
      const res = await updateOrderStatus(o.id, status, note.trim() || undefined);
      if (res.ok) {
        setNote("");
        toast.success(`Status updated to “${status}” — customer notified`);
        router.refresh();
      } else toast.error(res.error || "Failed");
    });
  }

  function accept() {
    start(async () => {
      const res = await confirmOrder(o.id);
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

  function cancel() {
    if (!confirm("Cancel this order and restore stock? This cannot be undone."))
      return;
    start(async () => {
      const res = await cancelAndRestoreStock(o.id);
      if (res.ok) {
        toast.success("Order cancelled — stock restored");
        router.refresh();
      } else toast.error(res.error || "Failed to cancel");
    });
  }

  return (
    <div className="space-y-2.5">
      {o.status === "pending" && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-accent/10 p-2.5">
          <p className="flex items-center gap-1 text-xs text-foreground">
            {o.paymentStatus === "paid"
              ? "Paid online — confirm to start fulfilment."
              : "Waiting for your acceptance."}
            <InfoTip term="Confirming an order">
              Confirming emails the customer and stages an unbooked draft in
              NimbusPost. Nothing is charged to your wallet until you book it.
            </InfoTip>
          </p>
          <Btn tone="accent" onClick={accept} disabled={pending} className="ml-auto">
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" />
            )}
            Confirm order
          </Btn>
        </div>
      )}

      <div className="grid gap-2 sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)_auto] sm:items-end">
        <LabelledField
          label="Order status"
          hint={
            returnWindowDays != null ? (
              <InfoTip term="Return window">
                Marking this <b>delivered</b> starts the {returnWindowDays}-day
                return window. Until then the customer cannot raise a return.
              </InfoTip>
            ) : undefined
          }
        >
          <select
            value={status}
            disabled={pending}
            onChange={(e) => setStatus(e.target.value)}
            className="input h-11 text-xs capitalize sm:h-9"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </select>
        </LabelledField>

        <LabelledField
          label="Message with this update"
          hint={
            <InfoTip term="Status message">
              Optional. It rides along with the status change, is stamped into
              the history, and is shown to the customer on their order page.
              Keep internal remarks in the internal note instead.
            </InfoTip>
          }
        >
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Packed today, dispatching tomorrow"
            className="input h-11 text-xs sm:h-9"
          />
        </LabelledField>

        <Btn
          tone="solid"
          onClick={applyStatus}
          disabled={pending || status === o.status}
          title={
            status === o.status
              ? "Pick a different status to send an update"
              : "Update the status and email the customer"
          }
        >
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Update status
        </Btn>
      </div>

      {o.status !== "cancelled" && o.paymentStatus !== "paid" && (
        <Btn
          tone="danger"
          onClick={cancel}
          disabled={pending}
          title="Cancel this order and immediately return reserved stock"
        >
          <XCircle className="h-3.5 w-3.5" /> Cancel & restore stock
        </Btn>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Notes                                                              */
/* ------------------------------------------------------------------ */

/**
 * Two notes that must never be confused:
 *
 * - **customerNote** is published on the customer's order page in a violet
 *   callout.
 * - **note** is internal and is rendered nowhere on the storefront.
 */
function NotesBlock({ order: o }: { order: AdminOrder }) {
  const router = useRouter();
  const [savingCustomer, startCustomer] = useTransition();
  const [savingInternal, startInternal] = useTransition();
  const [customer, setCustomer] = useState(o.customerNote ?? "");
  const [internal, setInternal] = useState(o.note ?? "");

  function saveCustomer() {
    startCustomer(async () => {
      const res = await setCustomerNote(o.id, customer);
      if (res.ok) {
        toast.success("Message saved — the customer sees it on their order");
        router.refresh();
      } else toast.error(res.error || "Failed to save");
    });
  }

  function saveInternal() {
    startInternal(async () => {
      const res = await addOrderNote(o.id, internal);
      if (res.ok) {
        toast.success("Internal note saved — staff only");
        router.refresh();
      } else toast.error(res.error || "Failed to save");
    });
  }

  return (
    <Block
      title="Notes"
      icon={MessageSquare}
      aside={
        o.customerNote ? <Badge tone="accent">customer message live</Badge> : null
      }
    >
      <div className="space-y-3">
        <div>
          <LabelledField
            label="Message to the customer"
            hint={
              <InfoTip term="Message to the customer">
                Shown in a highlighted callout on the customer&apos;s order page
                and signed with your store name. Use it for anything they need
                to act on — customisation details, a delay, a payment problem.
              </InfoTip>
            }
          >
            <textarea
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
              rows={2}
              placeholder="e.g. Send us the name to print by Friday and we'll dispatch Monday."
              className="input text-xs"
            />
          </LabelledField>
          <div className="mt-1.5 flex justify-end">
            <Btn tone="accent" onClick={saveCustomer} disabled={savingCustomer}>
              {savingCustomer && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save message
            </Btn>
          </div>
        </div>

        <div className="border-t border-border pt-3">
          <LabelledField
            label="Internal note"
            hint={
              <InfoTip term="Internal note">
                Staff only — it is not shown on the customer&apos;s order page.
                It starts out holding whatever the customer typed in
                &ldquo;order notes&rdquo; at checkout, and saving replaces that
                with your own remark.
              </InfoTip>
            }
          >
            <textarea
              value={internal}
              onChange={(e) => setInternal(e.target.value)}
              rows={2}
              placeholder="e.g. Called twice, no answer. Retry Monday."
              className="input text-xs"
            />
          </LabelledField>
          <div className="mt-1.5 flex justify-end">
            <Btn tone="outline" onClick={saveInternal} disabled={savingInternal}>
              {savingInternal && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save note
            </Btn>
          </div>
        </div>
      </div>
    </Block>
  );
}

/* ------------------------------------------------------------------ */
/*  History                                                            */
/* ------------------------------------------------------------------ */

function HistoryList({ entries }: { entries: StatusEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">Nothing recorded yet.</p>
    );
  }
  // Newest first — the last thing that happened is what you came to check.
  const newestFirst = [...entries].reverse();

  return (
    <ExpandableText lines={10} moreLabel="Show all" lessLabel="Show less">
      <ol className="space-y-1.5">
        {newestFirst.map((h, i) => (
          <li key={i} className="flex gap-2 text-xs">
            <span
              aria-hidden="true"
              className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-border"
            />
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                <span className="font-medium capitalize">
                  {h.status.replace("_", " ")}
                </span>
                {h.forCustomer && <Badge tone="accent">sent to customer</Badge>}
                <span className="text-muted-foreground">
                  {new Date(h.at).toLocaleString("en-IN")}
                </span>
              </p>
              {h.note && (
                <p className="break-words text-muted-foreground">{h.note}</p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </ExpandableText>
  );
}
