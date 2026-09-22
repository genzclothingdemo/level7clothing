"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  Check,
  Copy,
  ExternalLink,
  ImageOff,
  MessageSquare,
  Truck,
} from "lucide-react";
import { cn, formatINR } from "@/lib/utils";
import { InfoTip, GlossaryText } from "./info-tip";
import type { StoreMessage } from "./order-status";

/**
 * The facts a customer actually asks about an order, as small blocks that both
 * surfaces render.
 *
 * The account list and the order page used to describe the same order with two
 * different sets of markup — the list had no images, no reference ids and no
 * courier details; the page had no images and no tracking link. Every block
 * here is rendered by both, so the two can no longer drift, and a fix to (say)
 * the way a part-paid order explains itself lands in both places at once.
 *
 * Blocks are content only: no card, no border, no heading. The surface decides
 * whether a block sits inside a `Disclosure` (account list) or under a heading
 * (order page).
 */

/* ------------------------------------------------------------------ types */

export type OrderItemView = {
  name: string;
  quantity: number;
  /** Unit price in whole rupees. */
  price: number;
  options?: { name: string; value: string }[];
  /** Photo captured on the order, falling back to the product's own. */
  image: string | null;
  /**
   * Resolved on the server from `productId`, and **only** when the product
   * still exists and is active — `/product/<slug>` calls `notFound()` for an
   * inactive one, so linking to it would be a 404 dressed up as a product.
   * Null means: render the name as plain text.
   */
  slug: string | null;
};

/* ------------------------------------------------------------ copy button */

/**
 * A value with a copy button — the order number, an AWB, a Razorpay payment
 * id. These are the strings a customer reads out to their bank or pastes into
 * a courier's site, and on a phone "select the text" is not a real option.
 *
 * The 44px hit area is pulled back with negative margins so the button costs
 * ~24px of layout while still being thumb-sized, the same trick `InfoTip` uses.
 */
export function CopyValue({
  value,
  label,
  className,
  valueClassName,
}: {
  value: string;
  /** Names the button for screen readers: "Copy order number". */
  label: string;
  className?: string;
  valueClassName?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      // No clipboard permission (or an insecure origin). The value is still
      // on screen and selectable, so there is nothing useful to say here.
    }
  }

  return (
    <span className={cn("inline-flex min-w-0 items-center gap-0.5", className)}>
      <span className={cn("min-w-0 truncate font-mono", valueClassName)}>
        {value}
      </span>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? `${label} copied` : `Copy ${label}`}
        className={cn(
          "-my-2.5 -mr-2.5 grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full",
          "text-muted-foreground transition-colors hover:text-accent",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          // The account card's header sits inside a `pointer-events-none`
          // wrapper so the row behind it stays tappable; this opts the one
          // control that must still work back in. A no-op anywhere else.
          "pointer-events-auto"
        )}
      >
        {copied ? (
          <Check aria-hidden className="h-3.5 w-3.5 text-success" />
        ) : (
          <Copy aria-hidden className="h-3.5 w-3.5" />
        )}
      </button>
    </span>
  );
}

/* ----------------------------------------------------------------- thumbs */

// `sm` is 44px wide rather than 40 so that, on the rare line where the thumb
// is the only thing being tapped, it is still a thumb-sized target.
const THUMB = {
  sm: { box: "w-11", sizes: "44px" },
  md: { box: "w-14", sizes: "56px" },
} as const;

/**
 * A product photo at the store's portrait ratio. Wrapped in a link only when
 * the product is still there — a dead link from an order history is worse than
 * no link, because the shopper reads a 404 as "you deleted my order".
 */
export function ProductThumb({
  item,
  size = "sm",
  className,
  unlinked = false,
}: {
  item: Pick<OrderItemView, "name" | "image" | "slug">;
  size?: keyof typeof THUMB;
  className?: string;
  /** Set when something around it is already the link — nested <a> is invalid. */
  unlinked?: boolean;
}) {
  const spec = THUMB[size];
  const box = cn(
    "relative block aspect-[4/5] shrink-0 overflow-hidden rounded-lg bg-muted ring-1 ring-border/60",
    spec.box,
    className
  );
  const content = item.image ? (
    <Image
      src={decodeURI(item.image)}
      alt={item.name}
      fill
      sizes={spec.sizes}
      className="object-cover"
    />
  ) : (
    <span className="grid h-full w-full place-items-center text-muted-foreground">
      <ImageOff aria-hidden className="h-4 w-4" />
    </span>
  );

  if (!item.slug || unlinked) return <span className={box}>{content}</span>;
  return (
    <Link
      href={`/product/${item.slug}`}
      aria-label={item.name}
      className={cn(
        box,
        "transition-opacity hover:opacity-90",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      )}
    >
      {content}
    </Link>
  );
}

/** The product's name: a link when it still exists, plain text when it doesn't. */
export function ProductName({
  item,
  className,
}: {
  item: Pick<OrderItemView, "name" | "slug">;
  className?: string;
}) {
  if (!item.slug) return <span className={className}>{item.name}</span>;
  return (
    <Link
      href={`/product/${item.slug}`}
      className={cn(
        "rounded-sm transition-colors hover:text-accent",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
    >
      {item.name}
    </Link>
  );
}

export function variantLabel(item: Pick<OrderItemView, "options">): string {
  return (item.options ?? []).map((o) => `${o.name}: ${o.value}`).join(" · ");
}

/* ------------------------------------------------------------------ items */

/**
 * Every line on the order: photo, name, variant, quantity, line price.
 *
 * The photo *and* the name sit inside one link covering the whole row, rather
 * than being two small links side by side. On a phone that turns a 17px-tall
 * text link into a 55px row, and it is what a shopper expects to be able to
 * hit when they want to buy the same thing again. The price stays outside it,
 * because a price that navigates is a price that gets tapped by accident.
 */
export function OrderItems({
  items,
  className,
}: {
  items: OrderItemView[];
  className?: string;
}) {
  return (
    <ul className={cn("space-y-2", className)}>
      {items.map((item, i) => {
        const variant = variantLabel(item);
        const body = (
          <>
            <ProductThumb item={item} size="sm" unlinked />
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 block text-xs font-medium leading-snug">
                {item.name}
              </span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                {variant ? `${variant} · ` : ""}Qty {item.quantity}
              </span>
            </span>
          </>
        );
        return (
          <li key={i} className="flex items-center gap-2.5">
            {item.slug ? (
              <Link
                href={`/product/${item.slug}`}
                className={cn(
                  "flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-lg",
                  "transition-colors hover:text-accent",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                )}
              >
                {body}
              </Link>
            ) : (
              // The product is gone. Same row, no link — a 404 reached from an
              // order history reads as "you deleted my order".
              <span className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5">
                {body}
              </span>
            )}
            <span className="shrink-0 text-xs font-medium tabular-nums">
              {formatINR(item.price * item.quantity)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------------------------------------------------------------- payment */

export type OrderPaymentView = {
  subtotal: number;
  shipping: number;
  discountTotal: number;
  couponCode: string | null;
  total: number;
  /** "COD" | "Razorpay" | "Partial" | "Direct" — free text on the row. */
  paymentMethod: string;
  /** "pending" | "paid" | "partial" | "failed". */
  paymentStatus: string;
  amountPaid: number;
  balanceDue: number;
};

/**
 * The label the customer recognises, not the code the checkout stored.
 * The wording is chosen so `GlossaryText` can hang its explanation off it —
 * "Cash on Delivery" and "Partial payment" are both glossary terms.
 */
const METHOD_LABEL: Record<string, string> = {
  COD: "Cash on Delivery",
  Razorpay: "Paid online (prepaid)",
  Partial: "Partial payment — advance online, rest on delivery",
  Direct: "Direct request — we'll confirm the details with you",
};

const PAYMENT_STATUS: Record<string, { label: string; pill: string }> = {
  paid: { label: "Paid", pill: "bg-success/15 text-success" },
  partial: { label: "Part paid", pill: "bg-accent/12 text-accent" },
  pending: { label: "Not paid yet", pill: "bg-muted text-muted-foreground" },
  failed: { label: "Payment failed", pill: "bg-danger/10 text-danger" },
};

/** The short version, for a closed disclosure: `COD · ₹10 due`. */
export function paymentSummary(p: OrderPaymentView): string {
  const bits = [p.paymentMethod];
  if (p.balanceDue > 0 && p.paymentMethod !== "Direct") {
    bits.push(`${formatINR(p.balanceDue)} due`);
  } else if (p.amountPaid > 0) {
    bits.push("paid");
  }
  return bits.join(" · ");
}

export function OrderPaymentFacts({
  payment,
  className,
}: {
  payment: OrderPaymentView;
  className?: string;
}) {
  const status =
    PAYMENT_STATUS[payment.paymentStatus] ?? PAYMENT_STATUS.pending;
  const method = METHOD_LABEL[payment.paymentMethod] ?? payment.paymentMethod;

  return (
    <div className={cn("text-xs", className)}>
      <dl className="space-y-1">
        <MoneyRow label="Subtotal" value={formatINR(payment.subtotal)} />
        {payment.discountTotal > 0 && (
          <MoneyRow
            label={`Discount${payment.couponCode ? ` (${payment.couponCode})` : ""}`}
            value={`−${formatINR(payment.discountTotal)}`}
            tone="success"
          />
        )}
        <MoneyRow
          label="Shipping"
          value={payment.shipping === 0 ? "Free" : formatINR(payment.shipping)}
        />
        <div className="flex items-baseline justify-between gap-3 border-t border-border pt-1.5 font-medium">
          <dt>Total</dt>
          <dd className="tabular-nums">{formatINR(payment.total)}</dd>
        </div>
      </dl>

      <div className="mt-2.5 space-y-1.5 border-t border-border pt-2.5">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-muted-foreground">
            <GlossaryText text={method} />
          </span>
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
              status.pill
            )}
          >
            {status.label}
          </span>
        </p>

        {payment.amountPaid > 0 && (
          <MoneyRow
            label="Paid online"
            value={formatINR(payment.amountPaid)}
            tip={
              <InfoTip term="Paid online">
                Already taken by card, UPI or net banking when you placed the
                order. Nothing more to pay for this part.
              </InfoTip>
            }
          />
        )}

        {payment.balanceDue > 0 && payment.paymentMethod !== "Direct" && (
          <MoneyRow
            label="Due on delivery"
            value={formatINR(payment.balanceDue)}
            strong
            tip={
              <InfoTip term="Due on delivery">
                Hand this to the courier when the parcel arrives — cash, or UPI
                at the door if the rider supports it. Keep it ready; riders
                rarely carry change.
              </InfoTip>
            }
          />
        )}
      </div>
    </div>
  );
}

function MoneyRow({
  label,
  value,
  tone,
  strong,
  tip,
}: {
  label: string;
  value: string;
  tone?: "success";
  strong?: boolean;
  tip?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={cn("min-w-0", tone === "success" ? "text-success" : "text-muted-foreground")}>
        {label}
        {tip}
      </dt>
      <dd
        className={cn(
          "shrink-0 tabular-nums",
          tone === "success" && "text-success",
          strong && "font-medium"
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/* --------------------------------------------------------------- delivery */

export type OrderDeliveryView = {
  customerName: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  courier: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
};

export function OrderDeliveryFacts({
  delivery,
  className,
}: {
  delivery: OrderDeliveryView;
  className?: string;
}) {
  const hasCourier = Boolean(
    delivery.courier || delivery.trackingNumber || delivery.trackingUrl
  );

  return (
    <div className={cn("space-y-2.5 text-xs", className)}>
      <address className="not-italic">
        <span className="font-medium">{delivery.customerName}</span>
        <span className="mt-0.5 block text-muted-foreground">
          {delivery.address}, {delivery.city}, {delivery.state} —{" "}
          {delivery.pincode}
        </span>
        {delivery.phone && (
          <span className="block text-muted-foreground">{delivery.phone}</span>
        )}
      </address>

      {hasCourier && (
        <div className="space-y-1.5 border-t border-border pt-2.5">
          {delivery.courier && (
            <p className="flex flex-wrap items-center gap-x-2">
              <Truck aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span>{delivery.courier}</span>
            </p>
          )}
          {delivery.trackingNumber && (
            <p className="flex flex-wrap items-center gap-x-2">
              <span className="shrink-0 text-muted-foreground">
                AWB
                <InfoTip term="AWB">
                  The courier&apos;s tracking number for your parcel. Quote it
                  to them directly if a delivery goes wrong — it identifies the
                  shipment, where the order number does not.
                </InfoTip>
              </span>
              <CopyValue
                value={delivery.trackingNumber}
                label="tracking number"
                valueClassName="text-[11px]"
              />
            </p>
          )}
          {delivery.trackingUrl && (
            <a
              href={delivery.trackingUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center gap-1.5 text-accent hover:underline"
            >
              Track shipment
              <ExternalLink aria-hidden className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- references */

export type OrderRefsView = {
  orderNumber: string;
  razorpayPaymentId: string | null;
  razorpayOrderId: string | null;
};

export function OrderReferenceIds({
  refs,
  className,
}: {
  refs: OrderRefsView;
  className?: string;
}) {
  return (
    <dl className={cn("space-y-2 text-xs", className)}>
      <RefRow label="Order number" value={refs.orderNumber} copyLabel="order number" />
      {refs.razorpayPaymentId && (
        <RefRow
          label="Payment id"
          value={refs.razorpayPaymentId}
          copyLabel="payment id"
          tip={
            <InfoTip term="Payment id">
              The reference your bank or UPI app holds against this charge.
              Quote this one — not the order number — if you need to raise a
              query with them about the money.
            </InfoTip>
          }
        />
      )}
      {refs.razorpayOrderId && (
        <RefRow
          label="Payment order id"
          value={refs.razorpayOrderId}
          copyLabel="payment order id"
        />
      )}
    </dl>
  );
}

function RefRow({
  label,
  value,
  copyLabel,
  tip,
}: {
  label: string;
  value: string;
  copyLabel: string;
  tip?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
      <dt className="shrink-0 text-muted-foreground">
        {label}
        {tip}
      </dt>
      <dd className="min-w-0">
        <CopyValue value={value} label={copyLabel} valueClassName="text-[11px]" />
      </dd>
    </div>
  );
}

/* --------------------------------------------------------- store messages */

/**
 * What the store has said to this customer — the one thing on an order they
 * may actually have to act on, so it is the one thing rendered in violet.
 *
 * Built by `buildStoreMessages`, which reads `customerNote` and the status
 * notes flagged `forCustomer`. It never reads `Order.note`: that column is the
 * admin's private note and is overwritten with internal text.
 */
export function StoreMessages({
  messages,
  brandName,
  className,
}: {
  messages: StoreMessage[];
  brandName: string;
  className?: string;
}) {
  if (messages.length === 0) return null;

  return (
    <section
      className={cn(
        "rounded-xl border border-accent/45 bg-accent/10 p-3",
        className
      )}
    >
      <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-widest text-accent">
        <MessageSquare aria-hidden className="h-3.5 w-3.5 shrink-0" />
        Message from {brandName}
      </p>
      <ul className="mt-2 space-y-2.5">
        {messages.map((m, i) => (
          <li key={i}>
            <p className="whitespace-pre-line text-xs leading-relaxed text-foreground">
              {m.text}
            </p>
            {m.meta && (
              <p className="mt-0.5 text-[10px] text-muted-foreground">{m.meta}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
