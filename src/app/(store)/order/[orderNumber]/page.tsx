import { CheckCircle2, Hash, MessageCircle, Package } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { cn, formatINR, whatsappLink } from "@/lib/utils";
import { ButtonLink } from "@/components/ui/button";
import { Disclosure } from "@/components/store/disclosure";
import { OrderTimeline } from "@/components/store/order-timeline";
import { ReturnRequest } from "@/components/store/return-request";
import {
  FALLBACK_STATUS_ICON,
  ORDER_STATUS_ICON,
  buildOrderTimeline,
  buildStoreMessages,
  formatOrderDate,
  orderStatusLabel,
  orderStatusPill,
} from "@/components/store/order-status";
import {
  buildOrderReturns,
  type ReturnProductFlags,
} from "@/components/store/order-returns";
import {
  CopyValue,
  OrderDeliveryFacts,
  OrderItems,
  OrderPaymentFacts,
  OrderReferenceIds,
  ProductName,
  ProductThumb,
  StoreMessages,
  type OrderItemView,
} from "@/components/store/order-facts";

export const dynamic = "force-dynamic";
// This page renders a real customer's items, address and order total, so it
// must never be indexed. robots.txt disallows /order; this is the backstop for
// a URL reached from a forwarded confirmation email rather than a crawl.
export const metadata = {
  title: "Order confirmed",
  robots: { index: false, follow: false },
};

/** A line as checkout wrote it into `Order.items` (JSON, so untyped by Prisma). */
type RawItem = {
  productId?: string;
  name: string;
  image?: string;
  price: number;
  quantity: number;
  options?: { name: string; value: string }[];
};

/** The confirmation framing only makes sense while the order is still new. */
const FRESH = new Set(["pending", "confirmed"]);

export default async function OrderPage({
  params,
}: {
  params: Promise<{ orderNumber: string }>;
}) {
  const { orderNumber } = await params;

  const order = await prisma.order
    .findUnique({
      where: { orderNumber },
      include: { returnRequests: { orderBy: { createdAt: "desc" } } },
    })
    .catch(() => null);

  if (!order) {
    return (
      <div className="container-px mx-auto max-w-xl py-28 text-center">
        <Package className="mx-auto h-12 w-12 text-muted-foreground" />
        <h1 className="mt-6 font-serif text-3xl">Order not found</h1>
        <p className="mt-2 text-muted-foreground">
          We couldn&apos;t find an order with that number.
        </p>
        <ButtonLink href="/shop" className="mt-8">
          Back to shop
        </ButtonLink>
      </div>
    );
  }

  const settings = await getSettings();
  const rawItems = (Array.isArray(order.items)
    ? order.items
    : []) as unknown as RawItem[];

  // ---- Products behind the lines ----
  // One query, two jobs: the slug each line links to, and the three columns
  // the return policy is resolved from. `isCustomisable` is required — without
  // it `resolveReturnPolicy` silently offers returns on made-to-order pieces.
  const productIds = [
    ...new Set(rawItems.map((i) => i.productId).filter((id): id is string => !!id)),
  ];
  const products = productIds.length
    ? await prisma.product
        .findMany({
          where: { id: { in: productIds } },
          select: {
            id: true,
            slug: true,
            isActive: true,
            images: true,
            returnable: true,
            returnsInfo: true,
            isCustomisable: true,
          },
        })
        .catch(() => [])
    : [];
  const productById = new Map(products.map((p) => [p.id, p]));
  const policyById = new Map<string, ReturnProductFlags>(
    products.map((p) => [
      p.id,
      {
        returnable: p.returnable,
        returnsInfo: p.returnsInfo,
        isCustomisable: p.isCustomisable,
      },
    ])
  );

  const items: OrderItemView[] = rawItems.map((item) => {
    const product = item.productId ? productById.get(item.productId) : undefined;
    return {
      name: item.name,
      quantity: item.quantity,
      price: item.price,
      options: item.options,
      image: item.image?.trim() || product?.images?.[0] || null,
      // Only while the product is live: `/product/<slug>` calls notFound() for
      // an inactive one, so linking there would be a 404 on a page that is
      // otherwise telling the customer everything went fine.
      slug: product?.isActive ? product.slug : null,
    };
  });

  const lead = items[0];
  const extra = items.length - 1;
  const trail = buildOrderTimeline(order.statusHistory);
  // `order.note` is the admin's INTERNAL note and is never read here. What the
  // store has deliberately said to this customer is `customerNote` plus the
  // status notes flagged `forCustomer` — which is what this returns.
  const messages = buildStoreMessages(order.customerNote, order.statusHistory);
  const returns = buildOrderReturns({
    order,
    items: rawItems,
    products: policyById,
    returnRequests: order.returnRequests,
    settings,
    now: new Date(),
  });

  const StatusIcon = ORDER_STATUS_ICON[order.status] ?? FALLBACK_STATUS_ICON;
  const fresh = FRESH.has(order.status);

  const waMessage = [
    `Hi ${settings.brandName}, about my order.`,
    ``,
    `Order: ${order.orderNumber}`,
    ...items.map((i) => `• ${i.name} × ${i.quantity}`),
    `Total: ${formatINR(order.total)} (${order.paymentMethod})`,
    `Name: ${order.customerName}`,
    `Phone: ${order.phone}`,
  ].join("\n");
  const waHref = settings.whatsapp
    ? whatsappLink(settings.whatsapp, waMessage)
    : null;

  return (
    <div className="container-px mx-auto max-w-2xl py-10 md:py-14">
      {/* ── Hero ──
          "Thank you!" is the right thing to say to someone who has just
          checked out and the wrong thing to say to someone opening the same
          link a fortnight later to chase a parcel, so it is only shown while
          the order is still new. */}
      <div className="text-center">
        {fresh ? (
          <>
            <CheckCircle2 className="mx-auto h-12 w-12 text-success" />
            <h1 className="mt-4 font-serif text-3xl md:text-4xl">Thank you!</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {order.paymentMethod === "Direct"
                ? "Your request has been received — we'll contact you shortly to confirm the details of your custom order."
                : `Your order is confirmed. A confirmation email is on its way to ${order.email}.`}
            </p>
          </>
        ) : (
          <>
            <Package className="mx-auto h-9 w-9 text-muted-foreground" />
            <h1 className="mt-4 font-serif text-3xl md:text-4xl">Your order</h1>
          </>
        )}
      </div>

      {/* ── The order, led by what was bought ── */}
      <section className="mt-6 flex items-start gap-3 rounded-2xl border border-border bg-card p-3.5">
        {lead && <ProductThumb item={lead} size="md" />}
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-medium leading-snug">
            {lead ? (
              <ProductName item={lead} className="underline-offset-2 hover:underline" />
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
              {formatOrderDate(order.createdAt)}
            </span>
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            <CopyValue value={order.orderNumber} label="order number" />
          </div>
        </div>
        <span className="shrink-0 text-sm font-medium tabular-nums">
          {formatINR(order.total)}
        </span>
      </section>

      {/* A message from the store — the one thing on this page the customer
          may have to act on, so it is the one thing rendered in violet. */}
      <StoreMessages
        messages={messages}
        brandName={settings.brandName}
        className="mt-4"
      />

      {/* ── Tracking ── */}
      <section className="mt-4 rounded-2xl border border-border bg-card p-4">
        <h2 className="eyebrow mb-3">Tracking</h2>
        <OrderTimeline
          status={order.status}
          trail={trail}
          deliveryStatus={order.deliveryStatus}
          deliveryLocation={order.deliveryLocation}
        />
      </section>

      {/* ── What was bought, and what it cost ── */}
      <section className="mt-4 rounded-2xl border border-border bg-card p-4">
        <h2 className="eyebrow mb-3">
          {items.length} item{items.length === 1 ? "" : "s"}
        </h2>
        <OrderItems items={items} />
        <div className="mt-4 border-t border-border pt-3">
          <OrderPaymentFacts
            payment={{
              subtotal: order.subtotal,
              shipping: order.shipping,
              paymentFee: order.paymentFee,
              discountTotal: order.discountTotal,
              couponCode: order.couponCode,
              total: order.total,
              paymentMethod: order.paymentMethod,
              paymentStatus: order.paymentStatus,
              amountPaid: order.amountPaid,
              balanceDue: order.balanceDue,
            }}
          />
        </div>
      </section>

      {/* ── Where it is going, and the ids that identify it ── */}
      <section className="mt-4 rounded-2xl border border-border bg-card p-4">
        <h2 className="eyebrow mb-3">Delivery</h2>
        <OrderDeliveryFacts
          delivery={{
            customerName: order.customerName,
            phone: order.phone,
            address: order.address,
            city: order.city,
            state: order.state,
            pincode: order.pincode,
            courier: order.courier,
            trackingNumber: order.trackingNumber,
            trackingUrl: order.trackingUrl,
          }}
        />
        <div className="mt-2 border-t border-border">
          <Disclosure
            label="Reference IDs"
            icon={<Hash className="h-3.5 w-3.5" />}
            summary={order.razorpayPaymentId ? "Payment id" : "Order number"}
          >
            <OrderReferenceIds
              refs={{
                orderNumber: order.orderNumber,
                razorpayPaymentId: order.razorpayPaymentId,
                razorpayOrderId: order.razorpayOrderId,
              }}
            />
          </Disclosure>
        </div>
      </section>

      {/* ── Returns ──
          Same component, same engine and the same per-line verdicts as the
          account list. It explains itself when the window is shut rather than
          disappearing, because a missing button generates a support message
          and a closing date does not. */}
      {returns.show && (
        <ReturnRequest
          orderNumber={order.orderNumber}
          lines={returns.lines}
          existing={returns.existing}
          windowOpen={returns.windowOpen}
          daysLeft={returns.daysLeft}
          windowDays={returns.windowDays}
          closedReason={returns.closedReason}
        />
      )}

      {waHref && (
        <a
          href={waHref}
          target="_blank"
          rel="noreferrer"
          className="mt-6 flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-[#25D366] px-5 py-3.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          <MessageCircle className="h-5 w-5" />
          Message us about this order
        </a>
      )}

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <ButtonLink href="/account?tab=orders" variant="outline">
          All my orders
        </ButtonLink>
        <ButtonLink href="/shop">Continue shopping</ButtonLink>
      </div>
    </div>
  );
}
