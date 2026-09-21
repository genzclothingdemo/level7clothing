import { CheckCircle2, Package, MessageCircle, MessageSquare } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { formatINR, whatsappLink } from "@/lib/utils";
import { ButtonLink } from "@/components/ui/button";
import {
  OrderTimeline,
  type StatusEntry,
} from "@/components/store/order-timeline";
import {
  ReturnRequest,
  type ExistingRequest,
  type ReturnableLine,
} from "@/components/store/return-request";
import {
  formatReturnDate,
  isReturnStatus,
  resolveReturnPolicy,
  returnWindow,
} from "@/lib/returns";
import { prisma as db } from "@/lib/prisma";

export const dynamic = "force-dynamic";
// This page renders a real customer's items, address and order total, so it
// must never be indexed. robots.txt disallows /order; this is the backstop for
// a URL reached from a forwarded confirmation email rather than a crawl.
export const metadata = {
  title: "Order confirmed",
  robots: { index: false, follow: false },
};

type Item = {
  name: string;
  quantity: number;
  price: number;
  options?: { name: string; value: string }[];
};

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

  const items = order.items as unknown as Item[];

  // ---- Returns ----
  // Eligibility is resolved per line: the store switch, then the product's own
  // returnable flag, then the delivery window. The action re-checks all three.
  const settings = await getSettings();
  const productIds = items
    .map((i) => (i as Item & { productId?: string }).productId)
    .filter(Boolean) as string[];
  const returnFlags = productIds.length
    ? await db.product
        .findMany({
          where: { id: { in: productIds } },
          // `isCustomisable` is required here: resolveReturnPolicy treats a
          // made-to-order piece with no explicit `returnable` as non-returnable,
          // but the field is optional on its input type — so omitting it from
          // this select silently falls through to defaultReturnable and offers
          // returns on personalised work. Typechecks either way.
          select: {
            id: true,
            returnable: true,
            returnsInfo: true,
            isCustomisable: true,
          },
        })
        .catch(() => [])
    : [];
  const flagById = new Map(returnFlags.map((p) => [p.id, p]));

  const win = returnWindow(order, settings.returnWindowDays, new Date());
  const closedReason = !settings.returnsEnabled
    ? ("store_disabled" as const)
    : !win.deliveredAt
      ? ("not_delivered" as const)
      : !win.open
        ? ("window_closed" as const)
        : null;

  const returnLines: ReturnableLine[] = items.map((it, index) => {
    const pid = (it as Item & { productId?: string }).productId;
    const policy = resolveReturnPolicy(
      (pid ? flagById.get(pid) : undefined) ?? {},
      settings
    );
    return {
      index,
      name: it.name,
      quantity: it.quantity,
      price: it.price,
      variantLabel:
        (it.options ?? []).map((o) => `${o.name}: ${o.value}`).join(" · ") || null,
      eligible: policy.returnable,
    };
  });

  const existingReturns: ExistingRequest[] = order.returnRequests.map((r) => ({
    requestNumber: r.requestNumber,
    productName: r.productName,
    status: isReturnStatus(r.status) ? r.status : "pending",
    reason: r.reason,
    adminNote: r.adminNote,
    createdAt: r.createdAt.toISOString(),
    // The figures stored at the decision, never recomputed here: the customer
    // is shown what was agreed, not what today's fee settings would produce.
    refund:
      r.refundAmount == null
        ? null
        : {
            net: r.refundAmount,
            gross: r.refundGross,
            fee: r.refundFee,
            method: r.refundMethod,
            upi: r.refundUpi,
            reference: r.refundReference,
            paidOn: r.refundedAt ? formatReturnDate(r.refundedAt) : null,
          },
  }));
  const history = (
    Array.isArray(order.statusHistory) ? order.statusHistory : []
  ) as unknown as (StatusEntry & { forCustomer?: boolean })[];

  // ---- What the store has told this customer ----
  // Two sources, both written deliberately for them: `customerNote`, the
  // standing message on the order, and the notes the admin attached to a
  // status update (flagged `forCustomer`).
  //
  // `order.note` is the admin's INTERNAL note and is never read here — the
  // rest of `statusHistory` is internal too (NimbusPost draft/AWB chatter,
  // courier scans, "cancelled by admin"), which is why this filters on the
  // flag instead of showing every entry that happens to carry a note.
  const storeUpdates = history
    .filter((h) => h.forCustomer && h.note?.trim())
    .reverse();
  const hasStoreMessage = Boolean(order.customerNote?.trim()) ||
    storeUpdates.length > 0;

  const waMessage = [
    `Hi ${settings.brandName}, I just placed an order! 🧡`,
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
    <div className="container-px mx-auto max-w-2xl py-16">
      <div className="text-center">
        <CheckCircle2 className="mx-auto h-14 w-14 text-success" />
        <h1 className="mt-5 font-serif text-4xl">Thank you!</h1>
        <p className="mt-2 text-muted-foreground">
          {order.paymentMethod === "Direct" ? (
            <>
              Your request{" "}
              <span className="font-medium text-foreground">
                {order.orderNumber}
              </span>{" "}
              has been received. We&apos;ll contact you shortly to confirm the
              details of your custom order.
            </>
          ) : (
            <>
              Your order{" "}
              <span className="font-medium text-foreground">
                {order.orderNumber}
              </span>{" "}
              is confirmed. A confirmation email is on its way to {order.email}.
            </>
          )}
        </p>
      </div>

      {/* A message from the store. Deliberately loud — violet border, violet
          wash, violet label — because it is the one thing on this page the
          customer may have to act on. */}
      {hasStoreMessage && (
        <section className="mt-8 rounded-2xl border border-accent/45 bg-accent/10 p-5">
          <p className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-widest text-accent">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent/20">
              <MessageSquare className="h-3.5 w-3.5" />
            </span>
            Message from {settings.brandName}
          </p>

          {order.customerNote?.trim() && (
            <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-foreground">
              {order.customerNote}
            </p>
          )}

          {storeUpdates.length > 0 && (
            <ul
              className={`space-y-3 ${
                order.customerNote?.trim()
                  ? "mt-4 border-t border-accent/25 pt-4"
                  : "mt-3"
              }`}
            >
              {storeUpdates.map((h, i) => (
                <li key={i}>
                  <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">
                    {h.note}
                  </p>
                  <p className="mt-1 text-xs capitalize text-muted-foreground">
                    {h.status.replace("_", " ")} ·{" "}
                    {new Date(h.at).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div className="mt-8 rounded-2xl border border-border bg-card p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-xl">Order summary</h2>
          <span className="rounded-full bg-muted px-3 py-1 text-xs capitalize text-muted-foreground">
            {order.status}
          </span>
        </div>

        <ul className="mt-5 divide-y divide-border">
          {items.map((i, idx) => (
            <li key={idx} className="flex justify-between py-3 text-sm">
              <span>
                {i.name} <span className="text-muted-foreground">× {i.quantity}</span>
                {i.options && i.options.length > 0 && (
                  <span className="block text-xs text-muted-foreground">
                    {i.options.map((o) => `${o.name}: ${o.value}`).join(" · ")}
                  </span>
                )}
              </span>
              <span className="font-medium">
                {formatINR(i.price * i.quantity)}
              </span>
            </li>
          ))}
        </ul>

        <div className="mt-4 space-y-2 border-t border-border pt-4 text-sm">
          <Row label="Subtotal" value={formatINR(order.subtotal)} />
          <Row
            label="Shipping"
            value={order.shipping === 0 ? "Free" : formatINR(order.shipping)}
          />
          <div className="flex justify-between border-t border-border pt-2 text-base font-medium">
            <span>Total</span>
            <span>{formatINR(order.total)}</span>
          </div>
          <Row label="Payment" value={order.paymentMethod} />
          {order.amountPaid > 0 && (
            <Row label="Paid online" value={formatINR(order.amountPaid)} />
          )}
          {order.balanceDue > 0 && order.paymentMethod !== "Direct" && (
            <Row label="Due on delivery" value={formatINR(order.balanceDue)} />
          )}
        </div>

        <div className="mt-6 rounded-xl bg-muted p-4 text-sm">
          <p className="font-medium">{order.customerName}</p>
          <p className="mt-1 text-muted-foreground">
            {order.address}, {order.city}, {order.state} - {order.pincode}
          </p>
          <p className="text-muted-foreground">{order.phone}</p>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-border bg-card p-6">
        <h2 className="font-serif text-xl">Order status</h2>
        <div className="mt-5">
          {/* `note` is intentionally not passed: it is the admin's internal
              note. Anything meant for the customer is in the violet callout
              above, sourced from `customerNote` + flagged status updates. */}
          <OrderTimeline
            status={order.status}
            history={history}
            deliveryStatus={order.deliveryStatus}
            brandName={settings.brandName}
          />
        </div>
        <p className="mt-4 text-sm text-muted-foreground">
          Track this order any time from{" "}
          <a href="/account" className="text-accent hover:underline">
            your account
          </a>
          .
        </p>
      </div>

      <ReturnRequest
        orderNumber={order.orderNumber}
        lines={returnLines}
        existing={existingReturns}
        windowOpen={win.open && settings.returnsEnabled}
        daysLeft={win.daysLeft}
        windowDays={settings.returnWindowDays}
        closedReason={closedReason}
      />

      {waHref && (
        <a
          href={waHref}
          target="_blank"
          rel="noreferrer"
          className="mt-6 flex items-center justify-center gap-2 rounded-2xl bg-[#25D366] px-5 py-3.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          <MessageCircle className="h-5 w-5" />
          Send order details to us on WhatsApp
        </a>
      )}

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <ButtonLink href="/account" variant="outline">
          View in my account
        </ButtonLink>
        <ButtonLink href="/shop">Continue shopping</ButtonLink>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}
