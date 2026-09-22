import Link from "next/link";
import { getFinanceReport, METRIC, notMeasuredFor } from "@/lib/analytics";
import { RankBars, Meter } from "@/components/admin/finance-chart";
import {
  Caveat,
  DefRow,
  Degraded,
  Empty,
  NotMeasured,
  Panel,
  PanelLink,
  StatTile,
  TileGrid,
  formatCount,
  formatINR,
  formatPercent,
} from "@/components/admin/finance-ui";
import { readClock } from "@/components/admin/dash-workspace";
import { Badge } from "@/components/admin/order-ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard — Finance" };

/**
 * Admin → Dashboard → Finance.
 *
 * The bank-balance view, as distinct from the shop view on Sales. It answers
 * one question the rest of the workspace deliberately does not: of everything
 * the store booked, how much is actually money, and where did the rest go.
 *
 * The order is the order the arithmetic happens in — goods at list price, less
 * discount, giving net revenue; then shipping and the total billed; then what
 * of that has been collected; then what went back out as refunds.
 *
 * Nothing on this page is profit. There is no cost price on a product and no
 * courier invoice in the database, and the page says so rather than letting
 * "revenue" be read as "earnings".
 */
export default async function FinanceSection({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; grain?: string }>;
}) {
  const sp = await searchParams;
  const now = await readClock();
  const report = await getFinanceReport(sp.range, now, sp.grain);

  const { revenue, cash, refunds, window: win } = report;
  const nothing = revenue.orders === 0 && revenue.cancelledOrders === 0;

  /** Refunds paid out over revenue booked — two clocks, stated as such. */
  const refundRate =
    revenue.netRevenue > 0 ? Math.round((refunds.net / revenue.netRevenue) * 1000) / 10 : null;

  return (
    <div className="space-y-5">
      {report.degraded && <Degraded />}

      <TileGrid>
        <StatTile
          emphasis
          label="Cash collected"
          value={formatINR(cash.collected)}
          tip={METRIC.collected}
          note={`Over orders placed in ${win.phrase}. Refunds are the exception on this screen and are dated by when the money left instead, so they can belong to an earlier period.`}
          sub={`of ${formatINR(cash.billed)} billed`}
        />
        <StatTile
          label="Still outstanding"
          value={formatINR(cash.outstanding)}
          tip={METRIC.outstanding}
          good="down"
        />
        <StatTile
          label="Refunds paid out"
          value={formatINR(refunds.net)}
          tip={METRIC.refundsPaid}
          good="down"
          sub={`${refunds.paidCount} refund${refunds.paidCount === 1 ? "" : "s"}`}
        />
        <StatTile
          label="Refund rate"
          value={formatPercent(refundRate)}
          tip={METRIC.refundRate}
          good="down"
        />
      </TileGrid>

      {/* ---- Composition + cash ------------------------------------------ */}

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel
          title="How net revenue is built"
          tip="The arithmetic behind the headline, in the order it is applied. Every line is summed over the same set of orders — placed in this period, cancelled ones excluded."
        >
          {nothing ? (
            <Empty>No orders placed in this period.</Empty>
          ) : (
            <div>
              <DefRow
                label="Goods at list price"
                value={formatINR(revenue.grossGoods)}
                tip={METRIC.grossGoods}
              />
              <DefRow
                label={`Coupon discounts${revenue.couponOrders ? ` (${revenue.couponOrders} orders)` : ""}`}
                value={formatINR(revenue.discounts)}
                tone="deduction"
                tip={METRIC.discounts}
              />
              <DefRow
                label="Net revenue"
                value={formatINR(revenue.netRevenue)}
                tone="total"
                tip={METRIC.netRevenue}
              />
              <div className="mt-4 border-t border-dashed border-border pt-2">
                <DefRow
                  label="Shipping charged"
                  value={formatINR(revenue.shippingCharged)}
                  tip={METRIC.shippingCharged}
                />
                <DefRow
                  label="Total billed to customers"
                  value={formatINR(revenue.billed)}
                  tone="total"
                  tip={METRIC.billed}
                />
              </div>
              <Caveat label="Why shipping sits below the line">
                Shipping is not merchandise the store sold — it is money passed
                through to a courier, and the courier&apos;s actual bill is not
                in this database. Nothing on this page is profit: there is no
                cost-of-goods column on a product.
              </Caveat>
            </div>
          )}
        </Panel>

        <Panel
          title="Cash collected"
          tip={METRIC.collected}
          note="Booked revenue is not money in the bank. On a cash-on-delivery store the gap between the two is the number that matters."
        >
          {nothing ? (
            <Empty>No orders placed in this period.</Empty>
          ) : (
            <div className="space-y-4">
              <Meter
                value={cash.collected}
                limit={cash.billed}
                valueLabel={formatINR(cash.collected)}
                limitLabel={formatINR(cash.billed)}
                caption={
                  cash.outstanding > 0 ? (
                    <>
                      <span className="tabular-nums text-foreground">
                        {formatINR(cash.outstanding)}
                      </span>{" "}
                      still to collect
                    </>
                  ) : (
                    "nothing outstanding"
                  )
                }
              />
              <div>
                <DefRow label="Paid online" value={formatINR(cash.online)} tip={METRIC.online} />
                <DefRow
                  label="Collected on delivery"
                  value={formatINR(cash.onDelivery)}
                  tip={METRIC.onDelivery}
                />
                <DefRow
                  label="Still outstanding"
                  value={formatINR(cash.outstanding)}
                  tip={METRIC.outstanding}
                  strong
                />
              </div>
              <Caveat label="When a COD balance counts as collected">
                A cash-on-delivery balance counts as collected only once the
                order is marked delivered —{" "}
                <code className="text-foreground">balanceDue</code> is written
                at checkout and never decremented, so reading it as income would
                invent money on every parcel still in transit. This is the same
                rule the refund engine uses, so the two can never disagree.
              </Caveat>
            </div>
          )}
        </Panel>
      </div>

      {/* ---- Cash by payment method --------------------------------------- */}

      <Panel
        title="Cash by payment method"
        tip="The cash position for each checkout method, on one zero-based scale. This is the same set of orders Sales splits by revenue — here the bar is money in hand rather than money booked, which is a different ranking on a cash-on-delivery store."
      >
        <RankBars
          emptyText="No orders placed in this period."
          rows={report.byPaymentMethod.map((s) => ({
            key: s.key,
            label: s.label,
            value: s.collected,
            valueLabel: formatINR(s.collected),
            sub: (
              <>
                {formatINR(s.netRevenue)} booked across {s.orders} order
                {s.orders === 1 ? "" : "s"}
                {s.outstanding > 0 && (
                  <>
                    {" "}
                    · <span className="tabular-nums">{formatINR(s.outstanding)}</span> still
                    to collect
                  </>
                )}
              </>
            ),
          }))}
        />
      </Panel>

      {/* ---- Refunds ------------------------------------------------------ */}

      <Panel
        title="Refunds"
        tip={METRIC.refundsPaid}
        note="Dated by when the money left, not by when the order was placed — so these do not line up with the period above, and are never subtracted inside the revenue chart."
        aside={<PanelLink href="/admin/returns?status=all">Open returns</PanelLink>}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <DefRow
              label="Returned goods value"
              value={formatINR(refunds.gross)}
              tip={METRIC.refundGross}
            />
            <DefRow
              label="Fee kept by the store"
              value={formatINR(refunds.fee)}
              tone="deduction"
              tip={METRIC.refundFee}
            />
            <DefRow
              label={`Paid back to customers${refunds.paidCount ? ` (${refunds.paidCount})` : ""}`}
              value={formatINR(refunds.net)}
              tone="total"
              tip={METRIC.refundsPaid}
            />
          </div>
          <div>
            <DefRow
              label="Net revenue this period"
              value={formatINR(revenue.netRevenue)}
              tip={METRIC.netRevenue}
            />
            <DefRow
              label="Less refunds paid this period"
              value={formatINR(refunds.net)}
              tone="deduction"
              tip={METRIC.refundsPaid}
            />
            <DefRow
              label="Net of refunds"
              value={formatINR(revenue.netRevenue - refunds.net)}
              tone="total"
              tip="Net revenue booked in this period minus refunds paid out in this period. The two are measured on different clocks — a refund here can belong to an order from an earlier period — so read it as a cash-flow view, not as a restatement of revenue."
            />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>
            {refunds.raised} request{refunds.raised === 1 ? "" : "s"} raised in this period
          </span>
          {refunds.pendingCount > 0 && (
            <Badge tone="warn" title={METRIC.refundPending}>
              {refunds.pendingCount} awaiting payout · {formatINR(refunds.pendingValue)}
            </Badge>
          )}
          <Link href="/admin/finance/fulfilment" className="underline hover:text-accent">
            Return rate by product
          </Link>
        </div>
        {refunds.pendingCount > 0 && (
          <Caveat label="Why approved-but-unpaid sits outside the period">
            Approved-but-unpaid requests are shown whenever they were raised,
            not just this period, because that money is owed out regardless of
            when it was agreed. It is deliberately not inside any period&apos;s
            refund total until it is actually sent.
          </Caveat>
        )}
      </Panel>

      {/* ---- Catalogue value ---------------------------------------------- */}

      <Panel
        title="Stock on hand"
        tip="Σ Product.stock across the whole catalogue, as it stands right now. Not a windowed figure — stock is a present-tense fact and does not have a period."
        note="Shown here because it is the one asset figure available, and it is the largest thing on the balance sheet this database knows about."
      >
        <TileGrid>
          <StatTile
            label="Units in stock"
            value={formatCount(report.catalogue.unitsInStock)}
            tip="Σ Product.stock across every product, active or not, right now."
            good="none"
          />
          <StatTile
            label="Products"
            value={formatCount(report.catalogue.total)}
            tip="Every row in the catalogue."
            good="none"
            sub={`${report.catalogue.active} active`}
          />
          <StatTile
            label="Out of stock"
            value={formatCount(report.catalogue.outOfStock)}
            tip="Active products whose stock is zero or less. Every one of these is a live product page that cannot be bought."
            good="down"
          />
          <StatTile
            label="Cancelled value"
            value={formatINR(revenue.cancelledValue)}
            tip={METRIC.cancelled}
            good="down"
            sub={`${revenue.cancelledOrders} order${revenue.cancelledOrders === 1 ? "" : "s"}`}
            note="Excluded from every other figure on this page."
          />
        </TileGrid>
        <Caveat label="Why stock is not valued in rupees">
          Stock is counted in units, not in rupees. Valuing it would need a cost
          price per product, which does not exist — multiplying stock by the
          selling price would value the shelf at what it might fetch rather than
          at what it cost, which is not an asset figure anyone should put in a
          book.
        </Caveat>
      </Panel>

      {/* ---- The honest blank ---------------------------------------------- */}

      <Panel
        title="What this section cannot tell you"
        tip="The absences that belong to the money view specifically. The full list is on Overview."
      >
        <NotMeasured rows={notMeasuredFor("finance")} />
      </Panel>
    </div>
  );
}
