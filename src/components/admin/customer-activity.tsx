import {
  Heart,
  MessageSquare,
  PackageX,
  ShoppingBag,
  ShoppingCart,
} from "lucide-react";
import { formatINR } from "@/lib/utils";
import { Badge, Block, type BadgeTone } from "@/components/admin/order-ui";
import { ExpandableText } from "@/components/store/expandable-text";
import { InfoTip } from "@/components/store/info-tip";
import {
  LEAD_STATUS_LABEL,
  LEAD_STATUS_COLOR,
  isLeadStatus,
} from "@/lib/leads";
import {
  RETURN_STATUS_LABEL,
  RETURN_STATUS_COLOR,
  isReturnStatus,
  returnReasonLabel,
} from "@/lib/returns";
import {
  adminLink,
  type CustomerProduct,
  type CustomerRecord,
} from "@/lib/customers";
import {
  AdminRef,
  DeadRef,
  Nothing,
  formatDay,
  formatDayTime,
} from "@/components/admin/customer-ui";

/**
 * Everything this person has done, each entry linked to the screen that owns
 * it. Nothing here is a dead end: an order links to the orders list filtered
 * to it, a line item to the product editor, a return to the returns queue, a
 * lead to the interested-customers list, a chat to the inbox.
 *
 * Where a product has since been deleted the reference is shown struck
 * through rather than linked — the order is still a fact, the product is not.
 */

type ProductIndex = {
  byId: Map<string, CustomerProduct>;
  bySlug: Map<string, CustomerProduct>;
};

/**
 * Order-status colours. `orders-table.tsx` has the same map but does not
 * export it, and that file is not ours to touch — six lines of presentation
 * duplicated is cheaper than reaching into it.
 */
const ORDER_TONE: Record<string, BadgeTone> = {
  pending: "warn",
  confirmed: "info",
  shipped: "accent",
  delivered: "success",
  cancelled: "danger",
  payment_failed: "danger",
};

const PAYMENT_TONE: Record<string, BadgeTone> = {
  paid: "success",
  partial: "warn",
  pending: "neutral",
  failed: "danger",
};

/* ------------------------------------------------------------------ */
/*  Orders                                                             */
/* ------------------------------------------------------------------ */

export function CustomerOrders({
  customer,
  products,
}: {
  customer: CustomerRecord;
  products: ProductIndex;
}) {
  return (
    <Block
      title="Orders"
      icon={ShoppingBag}
      aside={
        customer.orders.length > 0 ? (
          <Badge>{customer.orders.length}</Badge>
        ) : undefined
      }
      bodyClassName="p-2 sm:p-3"
    >
      {customer.orders.length === 0 ? (
        <Nothing>No orders placed yet.</Nothing>
      ) : (
        <ul className="space-y-2">
          {customer.orders.map((o) => (
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
                <Badge tone={ORDER_TONE[o.status] ?? "neutral"}>{o.status}</Badge>
                {o.isGuest && (
                  <Badge title="Placed without signing in">Guest</Badge>
                )}
                <span className="ml-auto shrink-0 text-sm font-medium tabular-nums">
                  {formatINR(o.total)}
                </span>
              </div>

              <p className="mt-1 text-[11px] text-muted-foreground">
                {formatDayTime(o.createdAt)} · {o.itemCount} item
                {o.itemCount === 1 ? "" : "s"} · {o.city}, {o.state} {o.pincode}
              </p>

              {/* ---- payment state ---- */}
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                <Badge tone="neutral">{o.paymentMethod}</Badge>
                <Badge tone={PAYMENT_TONE[o.paymentStatus] ?? "neutral"}>
                  {o.paymentStatus}
                </Badge>
                {o.amountPaid > 0 && (
                  <span className="text-success">
                    {formatINR(o.amountPaid)} paid
                  </span>
                )}
                {o.balanceDue > 0 && (
                  <span
                    className={
                      o.status === "delivered" ? "text-muted-foreground" : "text-accent"
                    }
                  >
                    {formatINR(o.balanceDue)}{" "}
                    {o.status === "delivered" ? "collected on delivery" : "due"}
                  </span>
                )}
                {o.couponCode && (
                  <span className="text-muted-foreground">
                    {o.couponCode} −{formatINR(o.discountTotal)}
                  </span>
                )}
              </div>

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
                              {it.options.map((op) => `${op.name}: ${op.value}`).join(" · ")}
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

/* ------------------------------------------------------------------ */
/*  Returns                                                            */
/* ------------------------------------------------------------------ */

export function CustomerReturns({
  customer,
  products,
}: {
  customer: CustomerRecord;
  products: ProductIndex;
}) {
  return (
    <Block
      title="Returns"
      icon={PackageX}
      aside={
        customer.returns.length > 0 ? (
          <Badge>{customer.returns.length}</Badge>
        ) : undefined
      }
    >
      {customer.returns.length === 0 ? (
        <Nothing>No return has ever been raised.</Nothing>
      ) : (
        <ul className="space-y-2">
          {customer.returns.map((r) => {
            const status = isReturnStatus(r.status) ? r.status : null;
            const product = r.productId ? products.byId.get(r.productId) : undefined;
            return (
              <li key={r.id} className="text-xs">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <AdminRef
                    href={adminLink.return(r.requestNumber)}
                    mono
                    className="font-medium"
                    title="Open this return"
                  >
                    {r.requestNumber}
                  </AdminRef>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      status ? RETURN_STATUS_COLOR[status] : "bg-muted"
                    }`}
                  >
                    {status ? RETURN_STATUS_LABEL[status] : r.status}
                  </span>
                  <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
                    {r.refundAmount != null
                      ? `${formatINR(r.refundAmount)} refunded`
                      : formatINR(r.unitPrice * r.quantity)}
                  </span>
                </div>
                <p className="mt-0.5 text-muted-foreground">
                  {product ? (
                    <AdminRef href={adminLink.product(product.id)}>
                      {r.productName}
                    </AdminRef>
                  ) : r.productId ? (
                    <DeadRef>{r.productName}</DeadRef>
                  ) : (
                    r.productName
                  )}
                  {r.variantLabel ? ` · ${r.variantLabel}` : ""} × {r.quantity} ·{" "}
                  {returnReasonLabel(r.reason)}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {formatDay(r.createdAt)} · on order{" "}
                  <AdminRef href={adminLink.order(r.orderNumber)} mono>
                    {r.orderNumber}
                  </AdminRef>
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </Block>
  );
}

/* ------------------------------------------------------------------ */
/*  Chat                                                               */
/* ------------------------------------------------------------------ */

export function CustomerChats({ customer }: { customer: CustomerRecord }) {
  const unread = customer.threads.reduce((n, t) => n + t.adminUnread, 0);

  return (
    <Block
      title="Chat"
      icon={MessageSquare}
      aside={
        unread > 0 ? (
          <Badge tone="accent">{unread} unread</Badge>
        ) : customer.threads.length > 0 ? (
          <Badge>{customer.threads.length}</Badge>
        ) : undefined
      }
    >
      {customer.threads.length === 0 ? (
        <Nothing>Never started a chat.</Nothing>
      ) : (
        <ul className="space-y-2">
          {customer.threads.map((t) => (
            <li key={t.id} className="text-xs">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {/*
                  The inbox has no per-thread route — it is one polling panel
                  that picks its own thread — so this opens the inbox rather
                  than pretending to deep-link.
                */}
                <AdminRef href={adminLink.chat()} className="font-medium">
                  Open in inbox
                </AdminRef>
                {t.isClosed && <Badge>Closed</Badge>}
                {!t.claimed && (
                  <Badge title="Started before signing in — not attached to an account">
                    Guest thread
                  </Badge>
                )}
                <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                  {formatDay(t.lastMessageAt)}
                </span>
              </div>
              {t.lastMessage && (
                <ExpandableText
                  lines={2}
                  className="mt-0.5"
                  contentClassName="text-muted-foreground"
                >
                  {`“${t.lastMessage}”`}
                </ExpandableText>
              )}
            </li>
          ))}
        </ul>
      )}
    </Block>
  );
}

/* ------------------------------------------------------------------ */
/*  Wishlist                                                           */
/* ------------------------------------------------------------------ */

export function CustomerWishlist({
  customer,
  products,
}: {
  customer: CustomerRecord;
  products: ProductIndex;
}) {
  return (
    <Block
      title="Wishlist"
      icon={Heart}
      aside={
        <>
          {customer.wishlist.length > 0 && (
            <Badge>{customer.wishlist.length}</Badge>
          )}
          <InfoTip term="Wishlist">
            Saved items live on the account, so only a signed-in shopper has
            one. A guest&apos;s wishlist stays in their browser and merges in
            when they sign in.
          </InfoTip>
        </>
      }
    >
      {customer.wishlist.length === 0 ? (
        <Nothing>Nothing saved.</Nothing>
      ) : (
        <ul className="space-y-1.5">
          {customer.wishlist.map((w) => {
            const product = products.bySlug.get(w.slug);
            return (
              <li
                key={w.id}
                className="flex flex-wrap items-baseline gap-x-2 text-xs"
              >
                <span className="min-w-0 flex-1">
                  {product ? (
                    <AdminRef
                      href={adminLink.product(product.id)}
                      title="Edit this product"
                    >
                      {product.name}
                    </AdminRef>
                  ) : (
                    <DeadRef>{w.slug}</DeadRef>
                  )}
                  {product && !product.isActive && (
                    <span className="ml-1.5 text-[11px] text-muted-foreground">
                      (hidden)
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                  {product ? formatINR(product.price) : "no longer available"} ·{" "}
                  {formatDay(w.createdAt)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Block>
  );
}

/* ------------------------------------------------------------------ */
/*  Leads                                                              */
/* ------------------------------------------------------------------ */

export function CustomerLeads({
  customer,
  products,
}: {
  customer: CustomerRecord;
  products: ProductIndex;
}) {
  // The leads screen searches name, phone, email and product name, so the
  // person's own contact detail is the filter that finds their rows.
  const leadFilter = customer.email ?? customer.phone ?? "";

  return (
    <Block
      title="Cart interest"
      icon={ShoppingCart}
      aside={
        <>
          {customer.leads.length > 0 && <Badge>{customer.leads.length}</Badge>}
          {leadFilter && (
            <AdminRef
              href={adminLink.lead(leadFilter)}
              className="text-[10px] uppercase tracking-wider"
            >
              Manage
            </AdminRef>
          )}
        </>
      }
    >
      {customer.leads.length === 0 ? (
        <Nothing>Never left anything in a cart.</Nothing>
      ) : (
        <ul className="space-y-2">
          {customer.leads.map((l) => {
            const product = l.productId ? products.byId.get(l.productId) : undefined;
            const status = isLeadStatus(l.status) ? l.status : null;
            return (
              <li key={l.id} className="text-xs">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="min-w-0 flex-1">
                    {product ? (
                      <AdminRef href={adminLink.product(product.id)}>
                        {l.productName}
                      </AdminRef>
                    ) : l.productId ? (
                      <DeadRef>{l.productName}</DeadRef>
                    ) : (
                      l.productName
                    )}
                    <span className="text-muted-foreground">
                      {" "}
                      × {l.quantity}
                      {l.price != null ? ` · ${formatINR(l.price)}` : ""}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      status ? LEAD_STATUS_COLOR[status] : "bg-muted"
                    }`}
                  >
                    {status ? LEAD_STATUS_LABEL[status] : l.status}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {formatDay(l.createdAt)}
                </p>
                {l.notes && (
                  <ExpandableText
                    lines={2}
                    className="mt-0.5"
                    contentClassName="text-muted-foreground"
                  >
                    {l.notes}
                  </ExpandableText>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Block>
  );
}
