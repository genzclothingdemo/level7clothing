"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  ChevronDown,
  CreditCard,
  Hash,
  MapPin,
  Package,
  PackageX,
} from "lucide-react";
import { cn, formatINR } from "@/lib/utils";
import { useSettings } from "@/context/settings";
import { ButtonLink } from "@/components/ui/button";
import { Disclosure } from "./disclosure";
import { OrderTimeline } from "./order-timeline";
import { ReturnRequest } from "./return-request";
import {
  FALLBACK_STATUS_ICON,
  ORDER_STATUS_ICON,
  orderStatusLabel,
  orderStatusPill,
  type StoreMessage,
  type TrailEntry,
} from "./order-status";
import {
  OrderDeliveryFacts,
  OrderItems,
  OrderPaymentFacts,
  OrderReferenceIds,
  ProductName,
  ProductThumb,
  StoreMessages,
  CopyValue,
  paymentSummary,
  type OrderDeliveryView,
  type OrderItemView,
  type OrderPaymentView,
  type OrderRefsView,
} from "./order-facts";
import type { OrderReturnsView } from "./order-returns";

/**
 * Everything one row needs, already shaped and already formatted by
 * `/account/page.tsx`. Nothing here is derived in the browser: dates are
 * strings because `toLocaleString()` mismatches on hydration, and slugs are
 * resolved server-side because only the server can tell whether a product
 * still exists.
 */
export type AccountOrder = {
  id: string;
  orderNumber: string;
  status: string;
  /** Pre-formatted: `21 Sep 2026`. */
  placedOn: string;
  total: number;
  items: OrderItemView[];
  trail: TrailEntry[];
  messages: StoreMessage[];
  payment: OrderPaymentView;
  delivery: OrderDeliveryView;
  refs: OrderRefsView;
  deliveryStatus: string | null;
  deliveryLocation: string | null;
  returns: OrderReturnsView;
};

/** Height of the sticky navbar (h-14 / md:h-20) plus a little breathing room. */
const STICKY_OFFSET = 72;

/**
 * The customer's order history.
 *
 * ## What the owner complained about, and what each fix is
 *
 * **"It leads with an order ID nobody recognises."** A row now leads with the
 * first item's photo and name. The order number is still there — small, muted,
 * and with a copy button, because it is what support asks for — but it is the
 * last thing in the row rather than the first.
 *
 * **"There is no product image or name."** Both, linked to the product, with
 * `+N more` when the order has several. The link is only rendered when the
 * product is still active: `/product/<slug>` calls `notFound()` for a
 * deactivated one, and a 404 reached from someone's order history reads as
 * "you deleted my order".
 *
 * **"The status timeline eats the entire screen."** It is a horizontal stepper
 * now — see `order-timeline.tsx`.
 *
 * **"Expanding one order pushes the others off."** Three things together:
 *
 * 1. **Accordion.** One order is open at a time, so the list can only ever
 *    grow by one panel's height.
 * 2. **The panel is height-capped** (`max-h-[58svh]`) and scrolls inside
 *    itself. This is the actual guarantee: however much a customer opens
 *    inside a panel — the update history, the refund form, all four
 *    disclosures at once — the card cannot grow past ~58% of the viewport, so
 *    the next order's header is always still on screen below it.
 * 3. **Second-level disclosure.** Payment, delivery, reference ids and returns
 *    are 44px rows with their answer summarised on the right, so an expanded
 *    panel *starts* at roughly a third of a screen and rarely reaches the cap
 *    at all.
 *
 * Plus: opening a row scrolls its header under the navbar, so the panel opens
 * into view instead of below the fold.
 */
export function AccountOrders({ orders }: { orders: AccountOrder[] }) {
  // Everything closed on arrival. The first impression should be the list —
  // five products the shopper recognises — not one order's innards.
  const [openId, setOpenId] = useState<string | null>(null);
  const { brandName } = useSettings();
  const cards = useRef(new Map<string, HTMLLIElement>());

  /**
   * Bring the opened row into view. Only when it needs it: a row already
   * sitting comfortably on screen is left exactly where the thumb tapped it,
   * because moving the page under someone's finger for no reason is worse
   * than a slightly low panel.
   */
  useEffect(() => {
    if (!openId) return;
    const el = cards.current.get(openId);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.top >= STICKY_OFFSET && rect.bottom <= window.innerHeight) return;
    const reduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({
      top: window.scrollY + rect.top - STICKY_OFFSET,
      behavior: reduce ? "auto" : "smooth",
    });
  }, [openId]);

  if (orders.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-10 text-center">
        <Package aria-hidden className="mx-auto h-9 w-9 text-muted-foreground" />
        <p className="mt-4 font-serif text-xl">No orders yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Once you place an order you can track it, see what you paid and raise
          a return from here.
        </p>
        <ButtonLink href="/shop" className="mt-6">
          Start shopping
        </ButtonLink>
      </div>
    );
  }

  return (
    <ul className="space-y-3">
      {orders.map((order) => (
        <OrderRow
          key={order.id}
          order={order}
          open={openId === order.id}
          onToggle={() =>
            setOpenId((current) => (current === order.id ? null : order.id))
          }
          brandName={brandName}
          register={(el) => {
            if (el) cards.current.set(order.id, el);
            else cards.current.delete(order.id);
          }}
        />
      ))}
    </ul>
  );
}

function OrderRow({
  order,
  open,
  onToggle,
  brandName,
  register,
}: {
  order: AccountOrder;
  open: boolean;
  onToggle: () => void;
  brandName: string;
  register: (el: HTMLLIElement | null) => void;
}) {
  const panelId = useId();
  const lead = order.items[0];
  const extra = order.items.length - 1;
  const StatusIcon = ORDER_STATUS_ICON[order.status] ?? FALLBACK_STATUS_ICON;

  return (
    <li
      ref={register}
      className="overflow-hidden rounded-2xl border border-border bg-card"
    >
      {/* ── Header ──
          The toggle is an overlay button rather than a wrapper, because the
          product name and thumbnail inside it are links and an <a> cannot live
          inside a <button>. The content layer is `pointer-events-none` so a tap
          anywhere that isn't a link falls through to the toggle underneath;
          each link opts itself back in. */}
      <div className="relative">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={panelId}
          className={cn(
            "absolute inset-0 z-0 w-full cursor-pointer rounded-2xl",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          )}
        >
          <span className="sr-only">
            {open ? "Hide details for order" : "Show details for order"}{" "}
            {order.orderNumber}
          </span>
        </button>

        <div className="pointer-events-none relative z-10 flex items-start gap-3 p-3">
          {lead ? (
            <ProductThumb item={lead} size="md" className="pointer-events-auto" />
          ) : (
            <span className="block w-14 shrink-0" />
          )}

          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 text-sm font-medium leading-snug">
              {lead ? (
                <ProductName
                  item={lead}
                  className="pointer-events-auto underline-offset-2 hover:underline"
                />
              ) : (
                `Order ${order.orderNumber}`
              )}
            </p>

            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                  orderStatusPill(order.status)
                )}
              >
                <StatusIcon aria-hidden className="h-3 w-3" />
                {orderStatusLabel(order.status)}
              </span>
              {extra > 0 && (
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  +{extra} more
                </span>
              )}
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {order.placedOn}
              </span>
            </div>

            <div className="mt-1 text-[11px] text-muted-foreground">
              <CopyValue value={order.orderNumber} label="order number" />
            </div>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <span className="text-sm font-medium tabular-nums">
              {formatINR(order.total)}
            </span>
            <ChevronDown
              aria-hidden
              className={cn(
                "h-4 w-4 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none",
                open && "rotate-180"
              )}
            />
          </div>
        </div>
      </div>

      {/* ── Detail ──
          Conditionally rendered (never parked with a transform), capped, and
          scrollable inside itself so the orders below it stay reachable. */}
      {open && (
        <div
          id={panelId}
          className={cn(
            "max-h-[58svh] overflow-y-auto overscroll-contain border-t border-border sm:max-h-[62svh]",
            "animate-[fadeIn_0.15s_ease-out_both] motion-reduce:animate-none"
          )}
        >
          <div className="space-y-3 p-3">
            <OrderTimeline
              status={order.status}
              trail={order.trail}
              deliveryStatus={order.deliveryStatus}
              deliveryLocation={order.deliveryLocation}
            />

            <StoreMessages messages={order.messages} brandName={brandName} />

            <div>
              <p className="eyebrow mb-2">
                {order.items.length} item{order.items.length === 1 ? "" : "s"}
              </p>
              <OrderItems items={order.items} />
            </div>

            <div className="divide-y divide-border border-t border-border">
              <Disclosure
                label="Payment"
                icon={<CreditCard className="h-3.5 w-3.5" />}
                summary={paymentSummary(order.payment)}
              >
                <OrderPaymentFacts payment={order.payment} />
              </Disclosure>

              <Disclosure
                label="Delivery"
                icon={<MapPin className="h-3.5 w-3.5" />}
                summary={order.delivery.courier ?? order.delivery.city}
              >
                <OrderDeliveryFacts delivery={order.delivery} />
              </Disclosure>

              <Disclosure
                label="Reference IDs"
                icon={<Hash className="h-3.5 w-3.5" />}
                summary={order.refs.razorpayPaymentId ? "Payment id" : "Order number"}
              >
                <OrderReferenceIds refs={order.refs} />
              </Disclosure>

              {order.returns.show && (
                <Disclosure
                  label="Returns"
                  icon={<PackageX className="h-3.5 w-3.5" />}
                  summary={order.returns.summary}
                >
                  <ReturnRequest
                    embedded
                    orderNumber={order.orderNumber}
                    lines={order.returns.lines}
                    existing={order.returns.existing}
                    windowOpen={order.returns.windowOpen}
                    daysLeft={order.returns.daysLeft}
                    windowDays={order.returns.windowDays}
                    closedReason={order.returns.closedReason}
                  />
                </Disclosure>
              )}
            </div>
          </div>
        </div>
      )}
    </li>
  );
}
