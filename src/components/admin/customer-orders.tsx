import { ShoppingBag } from "lucide-react";
import { formatINR } from "@/lib/utils";
import { Badge, Block, StatusPill } from "@/components/admin/order-ui";
import { adminLink, type CustomerRecord } from "@/lib/customers";
import {
  AdminProductThumb,
  AdminProductName,
  variantText,
} from "@/components/admin/product-lead";
import type { AdminProductIndex } from "@/components/admin/product-index";
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
 *
 * ── The card's headline is the goods, not the reference ──────────────────────
 *
 * It used to be `L7-MUCL3FCASI` at `text-sm font-medium` — the largest text on
 * the card — with the line items below a divider at `text-xs` and no photos at
 * all. For a section whose entire purpose is "what does this person buy", the
 * most prominent thing on every card was the one string that answers nothing.
 *
 * Now each line carries its photo and its name at the top of the card, and the
 * order number sits with the date and the status on the line underneath. It is
 * still a link to Admin → Orders filtered to it, which is how you get from here
 * to actually working the order.
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
  products: AdminProductIndex;
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
              {/* ---- the goods, first: photo, name, variant, line total ----
                  Every line is shown rather than one with "+N more", because
                  this section exists to be read as a buying history — which
                  size, which colour, how often — and that is the one question
                  a collapsed list cannot answer. */}
              {o.items.length > 0 ? (
                <ul className="space-y-1.5">
                  {o.items.map((it, i) => {
                    const product = it.productId
                      ? products.byId.get(it.productId)
                      : undefined;
                    const variant = variantText(it.options);
                    const ref = {
                      name: it.name,
                      image: product?.image ?? null,
                      href: product ? adminLink.product(product.id) : null,
                    };
                    return (
                      <li
                        key={`${o.id}-${i}`}
                        className="flex items-start gap-2 text-xs"
                      >
                        <AdminProductThumb item={ref} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="line-clamp-2 block font-medium leading-snug">
                            {/* `DeadRef` is kept for the one case it names:
                                the line points at a product id that is no
                                longer in the catalogue. A line with no id at
                                all (a very old order) is just plain text — it
                                was never linked and nothing was deleted. */}
                            {product ? (
                              <AdminProductName item={ref} />
                            ) : it.productId ? (
                              <DeadRef>{it.name}</DeadRef>
                            ) : (
                              it.name
                            )}
                          </span>
                          <span className="mt-0.5 block text-[11px] text-muted-foreground">
                            {variant ? `${variant} · ` : ""}× {it.quantity}
                          </span>
                        </span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {formatINR(it.price * it.quantity)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No line items recorded on this order.
                </p>
              )}

              {/* ---- and only then the paperwork ---- */}
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border pt-1.5">
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

              <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
                <AdminRef
                  href={adminLink.order(o.orderNumber)}
                  mono
                  className="text-[11px]"
                  title="Open this order"
                >
                  {o.orderNumber}
                </AdminRef>
                <span>
                  {formatDayTime(o.createdAt)} · {o.itemCount} item
                  {o.itemCount === 1 ? "" : "s"}
                </span>
                {o.couponCode && (
                  <span>
                    <AdminRef href={adminLink.coupon(o.couponCode)} mono>
                      {o.couponCode}
                    </AdminRef>{" "}
                    −{formatINR(o.discountTotal)}
                  </span>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Block>
  );
}
