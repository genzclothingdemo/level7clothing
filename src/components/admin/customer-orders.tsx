import { ShoppingBag } from "lucide-react";
import { formatINR } from "@/lib/utils";
import { Badge, Block, StatusPill } from "@/components/admin/order-ui";
import {
  adminLink,
  type CustomerProductIndex,
  type CustomerRecord,
} from "@/lib/customers";
import {
  AdminRef,
  DeadRef,
  Nothing,
  formatDayTime,
} from "@/components/admin/customer-ui";

/**
 * Everything this person has bought.
 *
 * The order *state* is not restated here — status, payment, shipment and the
 * buttons that change any of them all live on Admin → Orders, and every order
 * number is a link to that screen filtered to it. What this adds, and what the
 * orders screen cannot give you, is the same list read as one person's
 * history: what they buy, in which size, how often, and how it has changed.
 *
 * So the line items stay (they are this section's whole reason to exist) and
 * each one links to the product editor, while the order's own machinery does
 * not get a second, read-only copy here.
 */

/** Payment status has no shared pill — order status does, and that one is used. */
const PAYMENT_TONE = {
  paid: "success",
  partial: "warn",
  pending: "neutral",
  failed: "danger",
} as const;

function paymentTone(status: string) {
  return (PAYMENT_TONE as Record<string, "success" | "warn" | "neutral" | "danger">)[
    status
  ] ?? "neutral";
}

export function CustomerOrders({
  customer,
  products,
}: {
  customer: CustomerRecord;
  products: CustomerProductIndex;
}) {
  const orders = customer.orders;
  const contact = customer.email ?? customer.phone ?? "";

  return (
    <Block
      title="Order history"
      icon={<ShoppingBag />}
      aside={
        // Only when there is something to manage: a link to a search that is
        // guaranteed to come back empty is a dead end wearing a link's clothes.
        orders.length > 0 && contact ? (
          <AdminRef
            href={adminLink.orderSearch(contact)}
            className="text-[10px] uppercase tracking-wider"
            title="Open these on the orders screen, where they can be worked"
          >
            Manage in Orders
          </AdminRef>
        ) : undefined
      }
      bodyClassName="p-2 sm:p-3"
    >
      {orders.length === 0 ? (
        <Nothing>
          No orders placed yet. What they have shown interest in is under{" "}
          <AdminRef href={adminLink.customerActivity(customer.id)}>
            Activity
          </AdminRef>
          .
        </Nothing>
      ) : (
        <ul className="space-y-2">
          {orders.map((o) => (
            <li
              key={o.id}
              className="rounded-lg border border-border bg-background/40 p-2.5"
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <AdminRef
                  href={adminLink.order(o.orderNumber)}
                  mono
                  className="text-sm font-medium"
                  title="Open this order"
                >
                  {o.orderNumber}
                </AdminRef>
                <StatusPill status={o.status} />
                {o.paymentStatus === "failed" && (
                  <Badge
                    tone={paymentTone(o.paymentStatus)}
                    title="The payment attempt did not go through — see Payments"
                  >
                    Payment failed
                  </Badge>
                )}
                {o.isGuest && (
                  <Badge title="Placed without signing in">Guest</Badge>
                )}
                <span className="ml-auto shrink-0 text-sm font-medium tabular-nums">
                  {formatINR(o.total)}
                </span>
              </div>

              <p className="mt-1 text-[11px] text-muted-foreground">
                {formatDayTime(o.createdAt)} · {o.itemCount} item
                {o.itemCount === 1 ? "" : "s"}
                {o.couponCode && (
                  <>
                    {" · "}
                    <AdminRef href={adminLink.coupon(o.couponCode)} mono>
                      {o.couponCode}
                    </AdminRef>{" "}
                    −{formatINR(o.discountTotal)}
                  </>
                )}
              </p>

              {/* ---- line items, each linked to its product ---- */}
              {o.items.length > 0 && (
                <ul className="mt-2 space-y-1 border-t border-border pt-1.5">
                  {o.items.map((it, i) => {
                    const product = it.productId
                      ? products.byId.get(it.productId)
                      : undefined;
                    return (
                      <li
                        key={`${o.id}-${i}`}
                        className="flex flex-wrap items-baseline gap-x-2 text-xs"
                      >
                        <span className="min-w-0 flex-1">
                          {product ? (
                            <AdminRef
                              href={adminLink.product(product.id)}
                              title="Edit this product"
                            >
                              {it.name}
                            </AdminRef>
                          ) : it.productId ? (
                            <DeadRef>{it.name}</DeadRef>
                          ) : (
                            <span>{it.name}</span>
                          )}
                          {it.options.length > 0 && (
                            <span className="text-muted-foreground">
                              {" · "}
                              {it.options
                                .map((op) => `${op.name}: ${op.value}`)
                                .join(" · ")}
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          × {it.quantity} · {formatINR(it.price * it.quantity)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </Block>
  );
}
