"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
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
  PackageCheck,
  Pencil,
  Sparkles,
  Truck,
  User,
  Wallet,
  XCircle,
} from "lucide-react";
import { cn, formatINR, whatsappLink } from "@/lib/utils";
import { CopyableId } from "@/components/admin/copy-id";
import { InfoTip } from "@/components/store/info-tip";
import { ExpandableText } from "@/components/store/expandable-text";
import { Disclosure } from "@/components/store/disclosure";
import { Check } from "@/components/admin/form-kit";
import {
  Badge,
  Block,
  Btn,
  BtnLink,
  LabelledField,
  Line,
  StatusPill,
  statusMeta,
  type BadgeTone,
} from "@/components/admin/order-ui";
import { OrderBulkBar } from "@/components/admin/order-bulk-bar";
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
import { adminOrderState } from "@/lib/orders-pipeline";
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

/* ------------------------------------------------------------------ */
/*  Layout                                                             */
/* ------------------------------------------------------------------ */

/**
 * The one column template, shared by the header and every row, which is what
 * actually makes the columns line up — each row is its own grid, so they can
 * only agree if the track sizes are fixed rather than content-derived.
 *
 * Seven tracks from `md`, eight from `xl` (the shipment column appears). The
 * shipment cell is `hidden xl:block`, so below `xl` it is not a grid item at
 * all and the seven-track template still lands the chevron in the last
 * column.
 *
 * The widths are sized against the real content box, not guessed: the admin
 * shell is `p-4 md:p-8` with a `w-64` sidebar from `lg`, which leaves **704px
 * at both `md` and `lg`** (768−64 and 1024−256−64 happen to coincide) and
 * ~960px at `xl`. Seven tracks come to 548px, so the flexible customer column
 * always has room; the eighth is held back to `xl` because adding it at `lg`
 * would total 684px against 704px and start clipping.
 *
 * Under `md` none of this applies: rows become stacked cards, because eight
 * columns on a 375px screen is a sideways scroll bar, not a table.
 */
const ROW_GRID =
  "md:grid md:grid-cols-[2.75rem_9rem_minmax(0,1fr)_5.5rem_6.5rem_8rem_2.5rem] md:items-center xl:grid-cols-[2.75rem_9rem_minmax(0,1fr)_5.5rem_6.5rem_8rem_8.5rem_2.5rem]";

/** Every cell: one padding value, one minimum, so the rhythm is uniform. */
const CELL = "min-w-0 px-2 py-2";

/* ------------------------------------------------------------------ */
/*  Derived row facts                                                  */
/* ------------------------------------------------------------------ */

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

/**
 * The money state of an order, as one pill.
 *
 * Carries an icon as well as a colour for the same reason `StatusPill` does:
 * "Paid" green and "COD due" orange are the same pill to a red-green
 * colour-blind reader, and this column is scanned, not read.
 */
function paymentMeta(o: AdminOrder): {
  text: string;
  tone: BadgeTone;
  icon: typeof Wallet;
  title: string;
} {
  if (o.paymentStatus === "paid") {
    return {
      text: "Paid",
      tone: "success",
      icon: CheckCircle2,
      title: `Paid in full — ${formatINR(o.amountPaid || o.total)} received. The courier collects nothing.`,
    };
  }
  if (o.paymentStatus === "partial") {
    return {
      text: "Part-paid",
      tone: "info",
      icon: Wallet,
      title: `${formatINR(o.amountPaid)} paid online — the courier collects only the ${formatINR(o.balanceDue)} balance.`,
    };
  }
  if (o.paymentStatus === "failed") {
    return {
      text: "Failed",
      tone: "danger",
      icon: XCircle,
      title: "The online payment failed. This order never auto-confirms.",
    };
  }
  if (o.paymentMethod === "Direct") {
    return {
      text: "Direct",
      tone: "neutral",
      icon: Wallet,
      title:
        "A customised order, paid to you directly. Mark it paid once the money reaches you, or the courier will be told to collect it.",
    };
  }
  return {
    text: "COD due",
    tone: "warn",
    icon: Wallet,
    title: `${formatINR(o.balanceDue || o.total)} to collect on delivery.`,
  };
}

/** Where this order stands with the courier, as one pill. */
function shipmentMeta(o: AdminOrder): {
  text: string;
  tone: BadgeTone;
  icon: typeof Truck;
  title: string;
} {
  if (o.trackingNumber) {
    return {
      text: o.trackingNumber,
      tone: "accent",
      icon: PackageCheck,
      title: `Booked${o.courier ? ` with ${o.courier}` : ""} — AWB ${o.trackingNumber}.`,
    };
  }
  if (o.nimbusShipmentId) {
    return {
      // The carrier is named when one has been picked — by the confirmation
      // pipeline on `draft`/`book`, or by hand in the rates panel. "Draft
      // staged" on its own is the line that reads as "something happened,
      // unclear what".
      text: o.nimbusCourierName ? `Draft · ${o.nimbusCourierName}` : "Draft staged",
      tone: "info",
      icon: Truck,
      title: o.nimbusCourierName
        ? `An unbooked draft is waiting in NimbusPost, set to go with ${o.nimbusCourierName}. No AWB and no wallet charge until you book it.`
        : "An unbooked draft is waiting in NimbusPost. No courier, no AWB and no wallet charge until you book it.",
    };
  }
  return {
    text: "Not staged",
    tone: "neutral",
    icon: Truck,
    title: "Nothing has been sent to NimbusPost for this order yet.",
  };
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

/** dd MMM, HH:mm — short enough for a column, unambiguous about the year. */
function shortDate(iso: string): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    ...(sameYear ? {} : { year: "2-digit" }),
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ------------------------------------------------------------------ */
/*  Table                                                              */
/* ------------------------------------------------------------------ */

export function OrdersTable({
  orders,
  returnWindowDays,
  totalMatching,
}: {
  orders: AdminOrder[];
  /** null = returns are switched off in Admin > Returns. */
  returnWindowDays: number | null;
  /** Orders matching the active filters across every page. */
  totalMatching: number;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const visibleIds = orders.map((o) => o.id);
  // Intersected on read rather than trimmed on write: the rows underneath
  // change whenever the filters or the page number do, and a selection that
  // still counted a row nobody can see would make "3 of 25 selected" a lie.
  const selectedOrders = orders.filter((o) => selected.has(o.id));

  function toggleAll(next: boolean) {
    setSelected((prev) => {
      const s = new Set(prev);
      for (const id of visibleIds) {
        if (next) s.add(id);
        else s.delete(id);
      }
      return s;
    });
  }

  function toggleRow(id: string, next: boolean) {
    setSelected((prev) => {
      const s = new Set(prev);
      if (next) s.add(id);
      else s.delete(id);
      return s;
    });
  }

  return (
    <div className="space-y-2">
      <OrderBulkBar
        visibleIds={visibleIds}
        // The rows themselves, not just their ids: the bar decides which verbs
        // are possible with `shipmentGateFor`, which needs the order's status
        // and its NimbusPost state.
        selectedOrders={selectedOrders}
        totalMatching={totalMatching}
        onToggleAll={toggleAll}
        onClear={() => setSelected(new Set())}
        // Rows that were just confirmed/cancelled are no longer valid targets
        // for the same action, so the selection is dropped after every run.
        onDone={() => setSelected(new Set())}
      />

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {/* Column headers — desktop only; a card has its own labels. */}
        <div
          className={cn(
            "hidden border-b border-border bg-muted/40 text-[10px] font-medium uppercase tracking-wider text-muted-foreground",
            ROW_GRID
          )}
          role="presentation"
        >
          <span className={CELL} aria-hidden />
          <span className={CELL}>Order</span>
          <span className={CELL}>Customer</span>
          <span className={cn(CELL, "text-right")}>Total</span>
          <span className={CELL}>Payment</span>
          <span className={CELL}>Status</span>
          <span className={cn(CELL, "hidden xl:block")}>Shipment</span>
          <span className={CELL} aria-hidden />
        </div>

        <ul className="divide-y divide-border">
          {orders.map((o) => (
            <OrderRow
              key={o.id}
              order={o}
              returnWindowDays={returnWindowDays}
              open={openId === o.id}
              selected={selected.has(o.id)}
              onSelect={(v) => toggleRow(o.id, v)}
              onToggle={() => setOpenId(openId === o.id ? null : o.id)}
            />
          ))}
        </ul>
      </div>
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
  selected,
  onSelect,
  onToggle,
}: {
  order: AdminOrder;
  returnWindowDays: number | null;
  open: boolean;
  selected: boolean;
  onSelect: (next: boolean) => void;
  onToggle: () => void;
}) {
  const pay = paymentMeta(o);
  const ship = shipmentMeta(o);
  // The operator's sentence — the stored status composed with the shipment
  // stage and the courier's last scan. One pure function, shared with the
  // tracking panel, so the column and the card cannot word it differently.
  const state = adminOrderState(o);
  const rw = returnWindowState(o, returnWindowDays);
  const custom = isCustom(o);
  const itemCount = o.items.reduce((n, i) => n + i.quantity, 0);
  const detailId = `order-detail-${o.id}`;
  const PayIcon = pay.icon;
  const ShipIcon = ship.icon;

  const flags = (
    <>
      {custom && (
        <Badge
          tone="accent"
          title="A made-to-order piece — collect the customisation details before dispatch"
        >
          <Sparkles className="h-2.5 w-2.5" aria-hidden /> Customise
        </Badge>
      )}
      {o.returnCount > 0 && (
        <Badge tone="danger" title={`${o.returnCount} return request(s) on this order`}>
          <AlertTriangle className="h-2.5 w-2.5" aria-hidden />
          {o.returnCount} return{o.returnCount === 1 ? "" : "s"}
        </Badge>
      )}
    </>
  );

  return (
    <li
      className={cn(
        "relative transition-colors",
        selected ? "bg-accent/5" : "hover:bg-muted/30"
      )}
    >
      {/* A 2px rail rather than a background alone: the tint is subtle by
          design, and a selected row still has to be obvious without colour. */}
      {selected && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-0.5 bg-accent"
        />
      )}

      {/* ---------------- Desktop: aligned columns ---------------- */}
      <div className={cn("hidden", ROW_GRID)}>
        <span className={cn(CELL, "flex justify-center py-0")}>
          <Check
            checked={selected}
            onChange={onSelect}
            label={`Select order ${o.orderNumber}`}
          />
        </span>

        {/* The order and customer cells are click targets but NOT tab stops:
            one row should cost two stops (its checkbox and its expander), not
            four. The chevron at the end is the labelled, focusable control
            that carries `aria-expanded` for assistive tech. */}
        <button
          type="button"
          onClick={onToggle}
          tabIndex={-1}
          className={cn(CELL, "cursor-pointer text-left")}
        >
          <span className="block truncate font-mono text-[11px] font-medium">
            {o.orderNumber}
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground tabular-nums">
            {shortDate(o.createdAt)}
          </span>
        </button>

        <button
          type="button"
          onClick={onToggle}
          tabIndex={-1}
          className={cn(CELL, "cursor-pointer text-left")}
        >
          <span className="block truncate text-xs font-medium">{o.customerName}</span>
          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
            {o.city}, {o.state} · {itemCount} item{itemCount === 1 ? "" : "s"}
          </span>
        </button>

        <span className={cn(CELL, "text-right text-xs font-medium tabular-nums")}>
          {formatINR(o.total)}
        </span>

        <span className={CELL}>
          <Badge tone={pay.tone} title={pay.title}>
            <PayIcon className="h-2.5 w-2.5 shrink-0" aria-hidden />
            {pay.text}
          </Badge>
        </span>

        {/* Status on its own line, flags under it. A single wrapping line
            reflows differently in every row, which is exactly what makes a
            column stop reading as a column. */}
        <span className={CELL}>
          <span className="block">
            <StatusPill status={o.status} title={state.line} />
          </span>
          {/* The half `Order.status` cannot say. "Confirmed" alone covers both
              "nothing has been staged" and "a draft is waiting for you", and
              "Shipped" covers both "the AWB exists and the parcel is still
              here" and "it is out for delivery" — this is the clause that
              tells them apart. */}
          <span
            className="mt-0.5 block text-[10px] leading-tight text-muted-foreground"
            title={state.line}
          >
            {state.detail}
          </span>
          {(custom || o.returnCount > 0) && (
            <span className="mt-1 flex flex-wrap gap-1">{flags}</span>
          )}
        </span>

        <span className={cn(CELL, "hidden xl:block")}>
          <Badge tone={ship.tone} title={ship.title} className="max-w-full">
            <ShipIcon className="h-2.5 w-2.5 shrink-0" aria-hidden />
            <span className="min-w-0 truncate">{ship.text}</span>
          </Badge>
        </span>

        <span className={cn(CELL, "flex justify-center py-0")}>
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={detailId}
            aria-label={`${open ? "Hide" : "Show"} details for order ${o.orderNumber}`}
            className="grid h-9 w-9 cursor-pointer place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronDown
              className={cn("h-4 w-4 transition-transform", open && "rotate-180")}
              aria-hidden
            />
          </button>
        </span>
      </div>

      {/* ---------------- Phones: one stacked card ----------------
          Written separately rather than reflowed from the grid above: the two
          layouts want different information in different orders, and a single
          markup that tries to be both is how a "responsive" table ends up
          scrolling sideways at 320px. */}
      <div className="flex items-start gap-1 md:hidden">
        <Check
          checked={selected}
          onChange={onSelect}
          label={`Select order ${o.orderNumber}`}
        />

        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={detailId}
          className="min-w-0 flex-1 cursor-pointer py-2 pr-1 text-left"
        >
          <span className="flex flex-wrap items-baseline gap-x-2">
            <span className="min-w-0 max-w-full truncate text-sm font-medium">
              {o.customerName}
            </span>
            <span className="font-mono text-[11px] text-muted-foreground">
              {o.orderNumber}
            </span>
          </span>

          <span className="mt-1 flex flex-wrap items-center gap-1">
            <StatusPill status={o.status} />
            <Badge tone={pay.tone} title={pay.title}>
              <PayIcon className="h-2.5 w-2.5 shrink-0" aria-hidden />
              {pay.text}
            </Badge>
            {flags}
            {rw && (
              <Badge tone={rw.tone} title={rw.title}>
                {rw.label}
              </Badge>
            )}
          </span>

          <span className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
            <span className="tabular-nums">{shortDate(o.createdAt)}</span>
            <span>
              {itemCount} item{itemCount === 1 ? "" : "s"}
            </span>
            <span className="min-w-0 max-w-full truncate">{ship.text}</span>
          </span>

          {/* Same clause as the desktop Status column. The shipment badge is
              `hidden xl:block`, so without this a phone shows the status word
              and nothing about where the parcel has got to. */}
          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
            {state.detail}
          </span>
        </button>

        <span className="flex shrink-0 items-center gap-0.5 self-center pr-1">
          <span className="text-sm font-medium tabular-nums">{formatINR(o.total)}</span>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180"
            )}
            aria-hidden
          />
        </span>
      </div>

      {open && (
        <div id={detailId}>
          <OrderDetail order={o} returnWindowDays={returnWindowDays} />
        </div>
      )}
    </li>
  );
}

/**
 * One expanded order, in the order the admin actually works in.
 *
 * The owner's complaint was that a single order ate the screen — *"abhi ek
 * order status kitni space occupied karta hai… use dropdown & (i) button, make
 * priority wised… dont create extra spacing padding margin"*. It was six
 * equal-weight cards in a 2-column grid, each with its own header bar, each
 * fully expanded whether or not anyone needed it. Everything had the same
 * prominence, so nothing did.
 *
 * Three tiers now, by what the admin does with it:
 *
 * 1. **Act** — the status change and the one shipment action the gate allows.
 *    Top, always visible, one strip.
 * 2. **Check** — items, money, what the courier collects. Two columns, dense.
 * 3. **Read-only** — address, notes, reference ids, history. Behind
 *    `Disclosure` folds, each with a summary on the right so the fold usually
 *    answers the question without being opened.
 *
 * Every explanation is behind an `InfoTip`; none of it is body text. That is
 * most of the height that went.
 */
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
  const pay = paymentMeta(o);
  const rw = returnWindowState(o, returnWindowDays);
  const itemCount = o.items.reduce((n, i) => n + i.quantity, 0);

  return (
    <div className="space-y-1.5 border-t border-border bg-muted/20 p-1.5">
      {/* ================= 1. ACT ================= */}
      <div className="space-y-1.5 rounded-lg border border-border bg-card p-1.5">
        {/* Made-to-order first: it is the one thing that must be settled
            before anything below it is pressed. */}
        {flagged && (
          <div className="rounded-lg border border-accent/40 bg-accent/10 px-2.5 py-1.5">
            <p className="flex flex-wrap items-center gap-1 text-xs font-medium text-accent">
              <Sparkles className="h-3.5 w-3.5" aria-hidden /> Needs customisation
              <InfoTip term="Needs customisation">
                At least one piece in this order is made to order. Collect the
                details from the customer before you book the shipment —
                customised pieces are also non-returnable by default.
              </InfoTip>
            </p>
            {custom.length > 0 ? (
              <ul className="mt-1 space-y-0.5">
                {custom.map((it, i) => (
                  <li key={i} className="text-xs">
                    <span className="font-medium">{it.name}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      —{" "}
                      {it.customisationNote
                        ? `collect: ${it.customisationNote}`
                        : "no collection note on this product yet"}
                    </span>
                    {it.note ? (
                      <span className="text-muted-foreground">
                        {" "}
                        · customer wrote: {it.note}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-0.5 text-xs text-muted-foreground">
                Flagged at checkout. The product has since changed, so check with
                the customer what they expect.
              </p>
            )}
          </div>
        )}

        <StatusControls order={o} returnWindowDays={returnWindowDays} />
        <OrderTracking order={o} />
      </div>

      {/* ================= 2. CHECK ================= */}
      <div className="grid gap-1.5 lg:grid-cols-2">
        <Block
          title="Items"
          icon={<Package />}
          aside={
            <Badge>
              {itemCount} unit{itemCount === 1 ? "" : "s"}
            </Badge>
          }
          bodyClassName="p-0"
        >
          <ul className="divide-y divide-border">
            {o.items.map((it, i) => (
              <ItemRow key={i} item={it} />
            ))}
          </ul>
        </Block>

        <Block
          title="Money"
          icon={<CreditCard />}
          aside={
            <Badge tone={pay.tone} title={pay.title}>
              {pay.text}
            </Badge>
          }
          bodyClassName="p-2"
        >
          <div className="space-y-0.5">
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
            <div className="mt-0.5 border-t border-border pt-0.5">
              <Line label="Total" value={formatINR(o.total)} tone="foreground" strong />
            </div>
            {o.amountPaid > 0 && (
              <Line label="Paid online" value={formatINR(o.amountPaid)} tone="success" />
            )}
            {o.balanceDue > 0 && (
              <Line
                label={
                  <span className="inline-flex items-center gap-0.5">
                    Courier collects
                    <InfoTip term="Courier collects">
                      Exactly what the courier is told to take at the door. On a
                      part-paid order this is the balance only — the advance you
                      already took online is never collected twice. Marking the
                      order paid drops it to nothing.
                    </InfoTip>
                  </span>
                }
                value={formatINR(o.balanceDue)}
                tone="accent"
                strong
              />
            )}
          </div>

          <div className="mt-1.5 flex flex-wrap items-end gap-1.5">
            <PaymentStatusPicker order={o} />
            <span className="pb-1.5 text-[11px] text-muted-foreground">
              via {o.paymentMethod}
            </span>
          </div>
        </Block>
      </div>

      {/* ================= 3. READ-ONLY ================= */}
      <div className="divide-y divide-border rounded-lg border border-border bg-card px-2.5">
        <Disclosure
          label="Customer & address"
          icon={<User className="h-3.5 w-3.5" />}
          summary={`${o.customerName} · ${o.city}, ${o.state} ${o.pincode}`}
        >
          <div className="space-y-1 text-xs">
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <a
                href={`mailto:${o.email}`}
                className="break-all text-muted-foreground underline-offset-2 hover:text-accent hover:underline"
              >
                {o.email}
              </a>
              <a
                href={`tel:${o.phone}`}
                className="text-muted-foreground underline-offset-2 hover:text-accent hover:underline"
              >
                {o.phone}
              </a>
              {rw && (
                <Badge tone={rw.tone} title={rw.title}>
                  {rw.label}
                </Badge>
              )}
            </p>
            <p className="flex gap-1.5 text-muted-foreground">
              <MapPin className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
              <span>
                {o.address}, {o.city}, {o.state} - {o.pincode}
              </span>
            </p>
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <BtnLink
                href={whatsappLink(o.phone, orderWhatsAppMessage(o, brandName))}
                target="_blank"
                rel="noreferrer"
                className="border border-[#25D366]/45 text-[#128C7E] hover:bg-[#25D366]/10 dark:text-[#25D366]"
                title="Send the order summary to the customer on WhatsApp"
              >
                <MessageCircle className="h-3.5 w-3.5" aria-hidden /> WhatsApp
              </BtnLink>
              <CopyableId id={o.orderNumber} label="Order number" />
              {o.nimbusShipmentId && (
                <CopyableId id={o.nimbusShipmentId} label="NimbusPost draft" />
              )}
            </div>
          </div>
        </Disclosure>

        <Disclosure
          label="Notes"
          icon={<MessageSquare className="h-3.5 w-3.5" />}
          summary={
            o.customerNote
              ? "customer message live"
              : o.note
                ? "internal note"
                : "none"
          }
        >
          <NotesBlock order={o} />
        </Disclosure>

        <Disclosure
          label="History"
          icon={<History className="h-3.5 w-3.5" />}
          summary={
            o.statusHistory.length
              ? `${o.statusHistory.length} entries · last ${statusMeta(
                  o.statusHistory[o.statusHistory.length - 1].status
                ).label.toLowerCase()}`
              : "nothing recorded"
          }
        >
          <HistoryList entries={o.statusHistory} />
        </Disclosure>
      </div>
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
    <li className="flex gap-2.5 px-2.5 py-1.5">
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
              <Sparkles className="h-2.5 w-2.5" aria-hidden /> Customise
            </Badge>
          )}
        </p>

        {it.options && it.options.length > 0 && (
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {it.options.map((op) => `${op.name}: ${op.value}`).join(" · ")}
          </p>
        )}

        {/* 44px tall on phones so these are thumb-sized, tight on desktop. */}
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
          {live ? (
            <>
              <a
                href={`/product/${it.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center gap-1 text-muted-foreground underline-offset-2 hover:text-accent hover:underline sm:min-h-0"
              >
                <ExternalLink className="h-3 w-3" aria-hidden /> Store page
              </a>
              <a
                href={`/admin/products/${it.productId}/edit`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center gap-1 text-muted-foreground underline-offset-2 hover:text-accent hover:underline sm:min-h-0"
              >
                <Pencil className="h-3 w-3" aria-hidden /> Edit product
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
      className="w-44"
      label="Payment status"
      hint={
        <InfoTip term="Payment status">
          What you have actually collected, and it feeds straight into the
          shipment: marking an order <b>paid</b> tells the courier to collect
          nothing, which is how a customised order paid to you directly avoids
          being charged a second time at the door.
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
      if (!res.ok) {
        toast.error(res.error || "Failed to confirm");
        return;
      }

      // The order is confirmed either way; the shipment is a separate fact and
      // is reported as one. A booking that failed must never read as success.
      const shipment = res.shipment;
      switch (shipment.outcome) {
        case "booked":
          toast.success(shipment.message, { duration: 8000 });
          if (shipment.caveat) toast.warning(shipment.caveat, { duration: 10000 });
          break;
        case "drafted":
          toast.success("Order confirmed", {
            description: shipment.message,
            duration: 9000,
          });
          // A pinned courier that did not quote, or rates that failed
          // altogether, changes which carrier this draft is waiting for —
          // which is exactly the sort of thing that is only noticed on an
          // invoice if nobody says it out loud.
          if (shipment.caveat) toast.warning(shipment.caveat, { duration: 10000 });
          break;
        case "skipped":
          toast.success("Order confirmed", { description: shipment.message });
          break;
        case "failed":
          toast.warning("Order confirmed — but the shipment did not go through", {
            description: shipment.drafted
              ? `${shipment.error} The draft is still in NimbusPost; book it once that is fixed.`
              : shipment.error,
            duration: 12000,
          });
          break;
      }
      router.refresh();
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
    <div className="space-y-1.5">
      {o.status === "pending" && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-accent/10 px-2.5 py-1.5">
          <p className="flex items-center gap-1 text-xs text-foreground">
            {o.paymentStatus === "paid"
              ? "Paid online — confirm to start fulfilment."
              : "Waiting for your acceptance."}
            <InfoTip term="Confirming an order">
              Confirming emails the customer. What it then does with the courier
              — nothing, a free unbooked draft, or a booked AWB charged to your
              wallet — is the <b>On confirm</b> setting shown above the list.
              Either way you can still dispatch by hand from here.
            </InfoTip>
          </p>
          <Btn tone="accent" onClick={accept} disabled={pending} className="ml-auto">
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
            )}
            Confirm order
          </Btn>
        </div>
      )}

      {/* One row: the status change, the optional message that rides with it,
          and the two buttons. `items-end` so the labels sit above a single
          baseline instead of each control finding its own. */}
      <div className="flex flex-wrap items-end gap-1.5">
        <LabelledField
          className="w-40"
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
                {statusMeta(s).label}
              </option>
            ))}
          </select>
        </LabelledField>

        <LabelledField
          className="flex-1 basis-56"
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
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
          Update status
        </Btn>

        {o.status !== "cancelled" && o.paymentStatus !== "paid" && (
          <Btn
            tone="danger"
            onClick={cancel}
            disabled={pending}
            title="Cancel this order and immediately return reserved stock"
          >
            <XCircle className="h-3.5 w-3.5" aria-hidden /> Cancel
          </Btn>
        )}
      </div>
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
    <div className="grid gap-2 md:grid-cols-2">
      <div>
        <LabelledField
          label={
            <>
              Message to the customer
              {o.customerNote && (
                <Badge tone="accent" className="ml-1">
                  live
                </Badge>
              )}
            </>
          }
          hint={
            <InfoTip term="Message to the customer">
              Shown in a highlighted callout on the customer&apos;s order page
              and signed with your store name. Use it for anything they need to
              act on — customisation details, a delay, a payment problem.
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
        <div className="mt-1 flex justify-end">
          <Btn tone="accent" onClick={saveCustomer} disabled={savingCustomer}>
            {savingCustomer && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            )}
            Save message
          </Btn>
        </div>
      </div>

      <div>
        <LabelledField
          label="Internal note"
          hint={
            <InfoTip term="Internal note">
              Staff only — it is not shown on the customer&apos;s order page. It
              starts out holding whatever the customer typed in &ldquo;order
              notes&rdquo; at checkout, and saving replaces that with your own
              remark.
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
        <div className="mt-1 flex justify-end">
          <Btn tone="outline" onClick={saveInternal} disabled={savingInternal}>
            {savingInternal && (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            )}
            Save note
          </Btn>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  History                                                            */
/* ------------------------------------------------------------------ */

function HistoryList({ entries }: { entries: StatusEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-xs text-muted-foreground">Nothing recorded yet.</p>;
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
                <span className="font-medium">{statusMeta(h.status).label}</span>
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
