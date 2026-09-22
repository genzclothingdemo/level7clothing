import { CreditCard, Wallet, XCircle } from "lucide-react";
import { formatINR, whatsappLink } from "@/lib/utils";
import { Badge, Block, BtnLink, Line } from "@/components/admin/order-ui";
import { TableScroll } from "@/components/admin/form-kit";
import { InfoTip } from "@/components/store/info-tip";
import { adminLink, type CustomerRecord } from "@/lib/customers";
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

export function CustomerPayments({ customer }: { customer: CustomerRecord }) {
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

      <FailedAttempts customer={customer} />

      {/* ---- the ledger ---- */}
      <Block
        title="Payment ledger"
        icon={<CreditCard />}
        aside={
          <InfoTip term="Payment ledger">
            One row per order: what it came to, what was taken online, and what
            is left. The three columns add up to the three figures above, so
            there is one place to check them rather than two.
          </InfoTip>
        }
        bodyClassName="p-0"
      >
        <TableScroll className="rounded-none border-0">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left">
                <Th>Order</Th>
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
                    <td className="whitespace-nowrap px-3 py-2">
                      <AdminRef href={adminLink.order(o.orderNumber)} mono>
                        {o.orderNumber}
                      </AdminRef>
                      <span className="block text-[11px] text-muted-foreground">
                        {formatDay(o.createdAt)}
                      </span>
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

function FailedAttempts({ customer }: { customer: CustomerRecord }) {
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

      <ul className="mt-2 space-y-2">
        {failed.map((o) => (
          <li
            key={o.id}
            className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border pt-2 text-xs"
          >
            <AdminRef href={adminLink.order(o.orderNumber)} mono className="font-medium">
              {o.orderNumber}
            </AdminRef>
            <span className="text-muted-foreground">
              {formatDay(o.createdAt)} · {o.paymentMethod}
            </span>
            <span className="ml-auto shrink-0 font-medium tabular-nums">
              {formatINR(o.total)}
            </span>
            {customer.phone && (
              <BtnLink
                href={whatsappLink(
                  customer.phone,
                  `Hi${customer.name ? ` ${customer.name}` : ""}, your payment for order ${o.orderNumber} didn't go through. Would you like a fresh link?`
                )}
                target="_blank"
                rel="noreferrer"
                tone="outline"
                className="basis-full sm:basis-auto"
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
