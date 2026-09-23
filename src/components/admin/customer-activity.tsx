import {
  Heart,
  MessageSquare,
  PackageX,
  ShoppingCart,
} from "lucide-react";
import { formatINR } from "@/lib/utils";
import { Badge, Block } from "@/components/admin/order-ui";
import { ExpandableText } from "@/components/store/expandable-text";
import { InfoTip } from "@/components/store/info-tip";
import { LEAD_STATUS_LABEL, LEAD_STATUS_COLOR, isLeadStatus } from "@/lib/leads";
import {
  RETURN_STATUS_LABEL,
  RETURN_STATUS_COLOR,
  isReturnStatus,
  returnReasonLabel,
} from "@/lib/returns";
import { adminLink, type CustomerRecord } from "@/lib/customers";
import {
  AdminProductName,
  AdminProductThumb,
  type AdminProductRef,
} from "@/components/admin/product-lead";
import type { AdminProductIndex } from "@/components/admin/product-index";
import {
  AdminRef,
  DeadRef,
  Nothing,
  formatDay,
} from "@/components/admin/customer-ui";

/**
 * Everything this person has done that is not an order or a payment: what is
 * in their cart, what they have asked, what they want back, what they have
 * saved.
 *
 * Nothing here is a dead end. A cart line links to the product, a return to
 * the returns queue, a chat to the inbox, a saved item to the product editor.
 * Where a product has since been deleted the reference is shown struck through
 * rather than linked — the cart entry is still a fact, the product is not.
 *
 * Every block that is *about a product* now leads with its photo. Three of the
 * four here are: a cart line, a return and a saved item are all "this piece",
 * and a return in particular used to open with `L7R-4KQ2` at `font-medium`
 * with the piece it was about on the line below in muted grey. The request
 * number is what you paste into the returns queue, which is one tap away from
 * it — it is not what tells you whether this is worth approving.
 */

/** One row's product, resolved against the live catalogue. */
function refFor(
  productId: string | null,
  fallbackName: string,
  products: AdminProductIndex
): { ref: AdminProductRef; found: boolean } {
  const p = productId ? products.byId.get(productId) : undefined;
  return {
    ref: {
      name: p?.name ?? fallbackName,
      image: p?.image ?? null,
      href: p ? adminLink.product(p.id) : null,
    },
    found: Boolean(p),
  };
}

/* ------------------------------------------------------------------ */
/*  Cart                                                               */
/* ------------------------------------------------------------------ */

/**
 * What is in their cart right now.
 *
 * A `Lead` is one sighting of a product added to a cart by somebody the store
 * could identify. Open ones — `interested` or `contacted` — are the live
 * signal and come first; `ordered` and `lost` are closed and fold underneath,
 * because a cart entry that became an order is history, not an opportunity.
 *
 * This used to be the last block on the page, under the wishlist. On somebody
 * who has never bought anything it is the *only* thing on the page, which is
 * why it now opens the section.
 */
export function CustomerCart({
  customer,
  products,
}: {
  customer: CustomerRecord;
  products: AdminProductIndex;
}) {
  const open = customer.leads.filter(
    (l) => l.status === "interested" || l.status === "contacted"
  );
  const closed = customer.leads.filter(
    (l) => l.status !== "interested" && l.status !== "contacted"
  );

  // The leads screen searches name, phone, email and product name, so the
  // person's own contact detail is the filter that finds their rows.
  const leadFilter = customer.email ?? customer.phone ?? "";

  return (
    <Block
      title="In their cart"
      icon={<ShoppingCart />}
      aside={
        <>
          {customer.stats.openCartItems > 0 && (
            <Badge tone="info">{customer.stats.openCartItems} open</Badge>
          )}
          <InfoTip term="In their cart">
            Every product this person has put in a cart, captured at the moment
            they added it. Open entries are still live interest; entries marked
            ordered or lost are closed and listed underneath. The statuses and
            the follow-up notes are set on Interested customers.
          </InfoTip>
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
        <div className="space-y-2">
          {open.length > 0 && (
            <ul className="space-y-2">
              {open.map((l) => (
                <LeadRow key={l.id} lead={l} products={products} />
              ))}
            </ul>
          )}

          {open.length === 0 && (
            <Nothing>Nothing open — every cart entry is closed.</Nothing>
          )}

          {closed.length > 0 && (
            <div className="border-t border-border pt-2">
              <p className="eyebrow mb-1.5">
                Closed · {closed.length}
              </p>
              <ul className="space-y-2">
                {closed.map((l) => (
                  <LeadRow key={l.id} lead={l} products={products} />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Block>
  );
}

function LeadRow({
  lead,
  products,
}: {
  lead: CustomerRecord["leads"][number];
  products: AdminProductIndex;
}) {
  const { ref, found } = refFor(lead.productId, lead.productName, products);
  const status = isLeadStatus(lead.status) ? lead.status : null;

  return (
    <li className="flex items-start gap-2 text-xs">
      <AdminProductThumb item={ref} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="min-w-0 flex-1">
            <span className="font-medium">
              {found ? (
                <AdminProductName item={ref} />
              ) : lead.productId ? (
                <DeadRef>{lead.productName}</DeadRef>
              ) : (
                lead.productName
              )}
            </span>
            <span className="text-muted-foreground">
              {" "}
              × {lead.quantity}
              {lead.price != null ? ` · ${formatINR(lead.price)}` : ""}
            </span>
          </span>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
              status ? LEAD_STATUS_COLOR[status] : "bg-muted"
            }`}
          >
            {status ? LEAD_STATUS_LABEL[status] : lead.status}
          </span>
        </div>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {formatDay(lead.createdAt)}
        </p>
        {lead.notes && (
          <ExpandableText
            lines={2}
            className="mt-0.5"
            contentClassName="text-muted-foreground"
          >
            {lead.notes}
          </ExpandableText>
        )}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/*  Chat                                                               */
/* ------------------------------------------------------------------ */

export function CustomerChats({ customer }: { customer: CustomerRecord }) {
  const unread = customer.stats.unreadMessages;

  return (
    <Block
      title="Chat"
      icon={<MessageSquare />}
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
                {t.adminUnread > 0 && (
                  <Badge tone="accent">{t.adminUnread} unread</Badge>
                )}
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
/*  Returns                                                            */
/* ------------------------------------------------------------------ */

export function CustomerReturns({
  customer,
  products,
}: {
  customer: CustomerRecord;
  products: AdminProductIndex;
}) {
  const open = customer.stats.openReturns;

  return (
    <Block
      title="Returns"
      icon={<PackageX />}
      aside={
        customer.returns.length > 0 ? (
          open > 0 ? (
            <Badge tone="warn">{open} open</Badge>
          ) : (
            <Badge>{customer.returns.length}</Badge>
          )
        ) : undefined
      }
    >
      {customer.returns.length === 0 ? (
        <Nothing>No return has ever been raised.</Nothing>
      ) : (
        <ul className="space-y-2">
          {customer.returns.map((r) => {
            const status = isReturnStatus(r.status) ? r.status : null;
            const { ref, found } = refFor(r.productId, r.productName, products);
            return (
              <li key={r.id} className="flex items-start gap-2 text-xs">
                {/* The piece coming back is the question — "is this the ₹399
                    tee or the ₹2,400 jacket" decides how the request is
                    handled, and the request number cannot answer it. */}
                <AdminProductThumb item={ref} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="min-w-0 flex-1 font-medium">
                      {found ? (
                        <AdminProductName item={ref} />
                      ) : r.productId ? (
                        <DeadRef>{r.productName}</DeadRef>
                      ) : (
                        r.productName
                      )}
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        status ? RETURN_STATUS_COLOR[status] : "bg-muted"
                      }`}
                    >
                      {status ? RETURN_STATUS_LABEL[status] : r.status}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {r.refundAmount != null
                        ? `${formatINR(r.refundAmount)} refunded`
                        : formatINR(r.unitPrice * r.quantity)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {r.variantLabel ? `${r.variantLabel} · ` : ""}× {r.quantity} ·{" "}
                    {returnReasonLabel(r.reason)}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
                    <AdminRef
                      href={adminLink.return(r.requestNumber)}
                      mono
                      className="text-[11px]"
                      title="Open this return"
                    >
                      {r.requestNumber}
                    </AdminRef>
                    <span>{formatDay(r.createdAt)} · on order</span>
                    <AdminRef
                      href={adminLink.order(r.orderNumber)}
                      mono
                      className="text-[11px]"
                    >
                      {r.orderNumber}
                    </AdminRef>
                  </p>
                </div>
              </li>
            );
          })}
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
  products: AdminProductIndex;
}) {
  return (
    <Block
      title="Wishlist"
      icon={<Heart />}
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
            // The wishlist stores a slug, not an id, so an unresolved row has
            // literally nothing but the slug to show — which is exactly the
            // case the thumb's `ImageOff` placeholder is for.
            const ref: AdminProductRef = {
              name: product?.name ?? w.slug,
              image: product?.image ?? null,
              href: product ? adminLink.product(product.id) : null,
            };
            return (
              <li key={w.id} className="flex items-start gap-2 text-xs">
                <AdminProductThumb item={ref} size="sm" />
                <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
                  <span className="min-w-0 flex-1 font-medium">
                    {product ? (
                      <AdminProductName item={ref} />
                    ) : (
                      <DeadRef>{w.slug}</DeadRef>
                    )}
                    {product && !product.isActive && (
                      <span className="ml-1.5 font-normal text-[11px] text-muted-foreground">
                        (hidden)
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    {product ? formatINR(product.price) : "no longer available"} ·{" "}
                    {formatDay(w.createdAt)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Block>
  );
}
