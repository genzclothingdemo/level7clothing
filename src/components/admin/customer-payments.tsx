import { CreditCard, Wallet, XCircle } from "lucide-react";
import { formatINR, whatsappLink } from "@/lib/utils";
import { Badge, Block, BtnLink, Line } from "@/components/admin/order-ui";
import { TableScroll } from "@/components/admin/form-kit";
import { InfoTip } from "@/components/store/info-tip";
import { adminLink, type CustomerOrder, type CustomerRecord } from "@/lib/customers";
import {
  ProductLead,
  variantText,
  type AdminProductRef,
} from "@/components/admin/product-lead";
import type { AdminProductIndex } from "@/components/admin/product-index";
import {
  AdminRef,
  Nothing,
  Stat,
  formatDay,
} from "@/components/admin/customer-ui";

/**
 * Where this person's money actually is.
 *
 * Three states, and they are not the same question as "what did they spend":
 * money that reached the gateway, money the courier should have taken at the
 * door, and money still outstanding. Lifetime spend is deliberately *not*
 * repeated here — it is a tile on Overview, and a second copy computed from a
 * second expression is how two screens end up disagreeing by a rupee.
 *
 * ── Failed payments ──────────────────────────────────────────────────────────
 *
 * `Order.paymentStatus` can be `failed`, and until now that fact rendered as a
 * small grey badge somewhere down the order list. It is the most commercially
 * interesting row on the page: somebody chose the pieces, filled in the
 * address, reached the gateway and did not get through. It gets its own block,
 * above the ledger, with the contact link already loaded.
 *
 * ── The ledger leads with the goods ──────────────────────────────────────────
 *
 * This screen is the one the owner photographed. Every row opened with
 * `L7-MUCL3FCASI` and **nothing on the page said what had been bought** — six
 * reference numbers, three money columns, and no way to tell a ₹1,299 hoodie
 * from a ₹1,299 pair of tees without opening each order on another screen.
 *
 * So the first column is now the product: its photo, its name linked to the
 * editor, and "+2 more" when the order had other lines. The order number is
 * still there, underneath, in mono and muted — it is how a customer refers to
 * the order in a message, so removing it would break the thing the column was
 * originally for. It just is not the headline any more.
 */

const PAYMENT_TONE = {
  paid: "success",
  partial: "warn",
  pending: "neutral",
  failed: "danger",
} as const;

function paymentTone(status: string) {
  return (
    (PAYMENT_TONE as Record<string, "success" | "warn" | "neutral" | "danger">)[
      status
    ] ?? "neutral"
  );
}

/**
 * An order's lines as product references, newest-order-first order preserved.
 *
 * `image` and existence both come from the live catalogue rather than from the
 * order: the order JSON does carry a photo, but a product photographed again
 * since should show its current shot on an admin screen, and a `productId`
 * missing from the index is a piece that has been deleted — which is exactly
 * when a link must NOT be rendered.
 */
function orderRefs(o: CustomerOrder, products: AdminProductIndex): AdminProductRef[] {
  return o.items.map((it) => {
    const p = it.productId ? products.byId.get(it.productId) : undefined;
    return {
      name: it.name,
      image: p?.image ?? null,
      href: p ? adminLink.product(p.id) : null,
      variant: variantText(it.options),
      quantity: it.quantity,
    };
  });
}

export function CustomerPayments({
  customer,
  products,
}: {
  customer: CustomerRecord;
  products: AdminProductIndex;
}) {
  const s = customer.stats;
  const orders = customer.orders;

  if (orders.length === 0) {
    return (
      <Block title="Payments" icon={<CreditCard />}>
        <Nothing>
          No orders yet, so there is nothing paid, collected or outstanding.
        </Nothing>
      </Block>
    );
  }

  return (
    <div className="space-y-3">
      <section aria-label="Money">
        <div className="mb-2 flex items-center gap-1">
          <Wallet
            className="h-3.5 w-3.5 text-muted-foreground"
            aria-hidden="true"
          />
          <h2 className="eyebrow">Where the money is</h2>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <Stat
            label="Paid online"
            value={formatINR(s.paidOnline)}
            tone={s.paidOnline > 0 ? "success" : "default"}
            tip={
              <>
                The sum of each order&apos;s <b>amount paid</b> — money that
                actually reached the payment gateway, whether that was the full
                total or a partial advance.
              </>
            }
          />
          <Stat
            label="On delivery"
            value={formatINR(s.collectedOnDelivery)}
            tip={
              <>
                The balance due on orders the courier has marked{" "}
                <b>delivered</b>. The database records what was owed, not the
                moment cash changed hands, so this is inferred from the delivery
                status — read it as &ldquo;should have been collected&rdquo;.
              </>
            }
          />
          <Stat
            label="Still to collect"
            value={formatINR(s.stillDue)}
            tone={s.stillDue > 0 ? "accent" : "default"}
            tip="Balance on orders that have not been delivered yet — pending, confirmed or in transit. Cancelled orders are excluded."
          />
          <Stat
            label="Failed"
            value={formatINR(s.failedValue)}
            tone={s.failedPayments > 0 ? "danger" : "default"}
            sub={
              s.failedPayments > 0
                ? `${s.failedPayments} attempt${s.failedPayments === 1 ? "" : "s"}`
                : undefined
            }
            tip="Orders whose payment attempt did not go through. Cancelled ones are included here — a failed payment is usually why an order ends up cancelled, so excluding them would delete the signal."
          />
          <Stat
            label="Usual method"
            value={s.preferredPaymentMethod ?? "—"}
            sub={
              s.preferredPaymentMethod
                ? `${s.preferredPaymentCount} of ${s.countedOrders}`
                : undefined
            }
            tip="The method used on the most orders. A tie goes to the one used most recently."
          />
        </div>
      </section>

      <FailedAttempts customer={customer} products={products} />

      {/* ---- the ledger ---- */}
      <Block
        title="Payment ledger"
        icon={<CreditCard />}
        aside={
          <InfoTip term="Payment ledger">
            One row per order: what was bought, what it came to, what was taken
            online, and what is left. The three money columns add up to the
            three figures above, so there is one place to check them rather than
            two. Each row leads with the product because that is what you are
            scanning for; the order number under it is what you quote back to
            the customer.
          </InfoTip>
        }
        bodyClassName="p-0"
      >
        <TableScroll className="rounded-none border-0">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left">
                {/* Was "Order", and held only the reference number. */}
                <Th>Item</Th>
                <Th>Method</Th>
                <Th>Payment</Th>
                <Th align="right">Total</Th>
                <Th align="right">Paid</Th>
                <Th align="right">Outstanding</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {orders.map((o) => {
                const cancelled = o.status === "cancelled";
                const delivered = o.status === "delivered";
                return (
                  <tr key={o.id} className="align-top">
                    {/* `min-w-[13rem]`, and the cell no longer forbids
                        wrapping: a product name is not a reference number and
                        truncating every one of them to a single line turns the
                        column back into something you cannot read. The table
                        already scrolls horizontally inside `TableScroll`. */}
                    <td className="min-w-[13rem] px-3 py-2">
                      <ProductLead
                        items={orderRefs(o, products)}
                        size="sm"
                        meta={
                          <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
                            <AdminRef
                              href={adminLink.order(o.orderNumber)}
                              mono
                              className="text-[11px]"
                              title="Open this order"
                            >
                              {o.orderNumber}
                            </AdminRef>
                            <span>{formatDay(o.createdAt)}</span>
                          </span>
                        }
                      />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                      {o.paymentMethod}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={paymentTone(o.paymentStatus)}>
                        {o.paymentStatus}
                      </Badge>
                      {cancelled && (
                        <span className="mt-0.5 block text-[11px] text-muted-foreground">
                          order cancelled
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      {formatINR(o.total)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      {o.amountPaid > 0 ? (
                        <span className="text-success">
                          {formatINR(o.amountPaid)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      {o.balanceDue > 0 ? (
                        <>
                          <span
                            className={
                              delivered || cancelled
                                ? "text-muted-foreground"
                                : "text-accent"
                            }
                          >
                            {formatINR(o.balanceDue)}
                          </span>
                          <span className="block text-[11px] text-muted-foreground">
                            {cancelled
                              ? "written off"
                              : delivered
                                ? "collected at door"
                                : "due"}
                          </span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroll>

        <div className="space-y-1.5 border-t border-border p-3">
          <Line
            label="Paid online"
            value={formatINR(s.paidOnline)}
            tone={s.paidOnline > 0 ? "success" : "muted"}
          />
          <Line
            label="Collected on delivery"
            value={formatINR(s.collectedOnDelivery)}
          />
          <Line
            label="Still to collect"
            value={formatINR(s.stillDue)}
            tone={s.stillDue > 0 ? "accent" : "muted"}
            strong={s.stillDue > 0}
          />
        </div>
      </Block>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Failed attempts                                                    */
/* ------------------------------------------------------------------ */

function FailedAttempts({
  customer,
  products,
}: {
  customer: CustomerRecord;
  products: AdminProductIndex;
}) {
  const failed = customer.orders.filter((o) => o.paymentStatus === "failed");
  if (failed.length === 0) return null;

  return (
    <Block
      title="Payments that failed"
      icon={<XCircle />}
      aside={<Badge tone="danger">{failed.length}</Badge>}
    >
      <p className="text-xs text-muted-foreground">
        Chosen, addressed, taken to the gateway — and it did not go through.
        These are the warmest leads on this page, not errors to hide.
      </p>

      {/*
        The piece they were trying to buy is the point of this block. A row
        that says only "L7-MUCL3FCASI · 21 Sep · Razorpay · ₹1,299" gives you
        nothing to say when you pick up the phone; "the Oversized Tee, ₹1,299"
        is a conversation. The WhatsApp message still quotes the order number,
        because that is what the customer can check against their bank.
      */}
      <ul className="mt-2 space-y-2">
        {failed.map((o) => (
          <li key={o.id} className="border-t border-border pt-2 text-xs">
            <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
              <ProductLead
                className="min-w-0 flex-1"
                items={orderRefs(o, products)}
                size="sm"
                meta={
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
                    <AdminRef
                      href={adminLink.order(o.orderNumber)}
                      mono
                      className="text-[11px]"
                      title="Open this order"
                    >
                      {o.orderNumber}
                    </AdminRef>
                    <span>
                      {formatDay(o.createdAt)} · {o.paymentMethod}
                    </span>
                  </span>
                }
              />
              <span className="shrink-0 font-medium tabular-nums">
                {formatINR(o.total)}
              </span>
            </div>
            {customer.phone && (
              <BtnLink
                href={whatsappLink(
                  customer.phone,
                  `Hi${customer.name ? ` ${customer.name}` : ""}, your payment for order ${o.orderNumber} didn't go through. Would you like a fresh link?`
                )}
                target="_blank"
                rel="noreferrer"
                tone="outline"
                className="mt-1.5"
              >
                Follow up on WhatsApp
              </BtnLink>
            )}
          </li>
        ))}
      </ul>
    </Block>
  );
}

function Th({
  children,
  align = "left",
}: {
  children?: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={`px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground ${
        align === "right" ? "text-right" : ""
      }`}
    >
      {children}
    </th>
  );
}
