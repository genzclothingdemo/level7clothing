import Link from "next/link";
import { getFinanceReport, delta, METRIC, TIMEZONE_NOTE } from "@/lib/analytics";
import { ColumnChart, RankBars, Meter } from "@/components/admin/finance-chart";
import {
  Caveat,
  DefRow,
  Empty,
  Panel,
  StatTile,
  TileGrid,
  formatCount,
  formatINR,
} from "@/components/admin/finance-ui";
import { TableScroll } from "@/components/admin/form-kit";
import { Badge } from "@/components/admin/order-ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Finance" };

/**
 * Admin → Finance → Money.
 *
 * The page is thin on purpose: it reads the range out of the URL, asks
 * `lib/analytics` for one report, and renders it. Every definition, every
 * exclusion and every piece of arithmetic lives in that module, and the (i)
 * text on each figure is the same constant the query was written against — so
 * a number and its explanation cannot drift apart.
 *
 * The order of the page is the order the questions get asked: what did we
 * sell, how did that move, how was it built, how much of it is actually in
 * the bank, what went back out, and where did it come from.
 */

/**
 * Wall clock, read through an async boundary rather than called in the render
 * body — the same pattern as Admin → Customers. The page is force-dynamic so
 * the value is genuinely per-request.
 */
async function readClock(): Promise<Date> {
  return new Date();
}

export default async function FinanceMoney({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const sp = await searchParams;
  const now = await readClock();
  const report = await getFinanceReport(sp.range, now);

  const { revenue, cash, refunds, previous, window: win } = report;
  const vs = previous ? `vs ${previous.label}` : undefined;
  const nothing = revenue.orders === 0 && revenue.cancelledOrders === 0;

  return (
    <div className="space-y-5">
      {report.degraded && (
        <p className="rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-xs text-danger">
          At least one query failed, so some panels below may read zero. This is
          a reporting failure, not a business one — check the database
          connection before acting on anything here.
        </p>
      )}

      {/* ---- Headline ---------------------------------------------------- */}

      <TileGrid>
        <StatTile
          emphasis
          label="Net revenue"
          value={formatINR(revenue.netRevenue)}
          tip={METRIC.netRevenue}
          delta={previous ? delta(revenue.netRevenue, previous.netRevenue) : undefined}
          deltaLabel={vs}
          sub={`${win.label} · booked, not collected`}
        />
        <StatTile
          label="Orders"
          value={formatCount(revenue.orders)}
          tip={METRIC.orders}
          delta={previous ? delta(revenue.orders, previous.orders) : undefined}
          deltaLabel={vs}
          sub={
            revenue.cancelledOrders > 0
              ? `${revenue.cancelledOrders} cancelled (${formatINR(revenue.cancelledValue)}) excluded`
              : "none cancelled"
          }
        />
        <StatTile
          label="Average order value"
          value={formatINR(revenue.aov)}
          tip={METRIC.aov}
          delta={previous ? delta(revenue.aov, previous.aov) : undefined}
          deltaLabel={vs}
        />
        <StatTile
          label="Units sold"
          value={formatCount(revenue.units)}
          tip={METRIC.units}
          delta={previous ? delta(revenue.units, previous.units) : undefined}
          deltaLabel={vs}
        />
      </TileGrid>

      {!previous && (
        <p className="text-xs text-muted-foreground">
          No period-on-period comparison on All time — there is no equally long
          period before it to compare against. Pick 7, 30 or 90 days for deltas.
        </p>
      )}

      {/* ---- Trend ------------------------------------------------------- */}

      <Panel
        title="Net revenue over time"
        tip={METRIC.netRevenue}
        subtitle={
          <>
            One bar per {report.granularity}, by order date. {TIMEZONE_NOTE} Refunds
            are <strong className="font-medium text-foreground">not</strong> netted
            out of these bars — they are dated by when the money left, which is a
            different day from the order, and are reported separately below.{" "}
            {win.days !== null && (
              <>
                The window is a rolling one ending now, so the first and last bars
                cover part of a {report.granularity} and will read low. They are
                kept rather than trimmed, because dropping them would take real
                orders out of the total to tidy the axis.
              </>
            )}
          </>
        }
      >
        <ColumnChart
          measure="Net revenue"
          unit={report.granularity}
          columns={report.series.map((p) => ({
            key: p.key,
            label: p.label,
            value: p.netRevenue,
            detail: `${p.orders} order${p.orders === 1 ? "" : "s"}, ${p.units} unit${p.units === 1 ? "" : "s"}`,
          }))}
          formatValue={formatINR}
          tableHead={[report.granularity === "month" ? "Month" : report.granularity === "week" ? "Week of" : "Day", "Net revenue", "Orders / units"]}
        />
      </Panel>

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
              <Caveat>
                Shipping sits below the line because it is not merchandise the
                store sold — it is money passed through to a courier, and the
                courier&apos;s actual bill is not in this database. Nothing on
                this page is profit: there is no cost-of-goods column on a
                product.
              </Caveat>
            </div>
          )}
        </Panel>

        <Panel
          title="Cash collected"
          tip={METRIC.collected}
          subtitle="Booked revenue is not money in the bank. On a cash-on-delivery store the gap between the two is the number that matters."
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
              <Caveat>
                A cash-on-delivery balance counts as collected only once the
                order is marked delivered — <code className="text-foreground">balanceDue</code>{" "}
                is written at checkout and never decremented, so reading it as
                income would invent money on every parcel still in transit. This
                is the same rule the refund engine uses, so the two can never
                disagree.
              </Caveat>
            </div>
          )}
        </Panel>
      </div>

      {/* ---- Refunds ------------------------------------------------------ */}

      <Panel
        title="Refunds"
        tip={METRIC.refundsPaid}
        subtitle="Dated by when the money left, not by when the order was placed — so these do not line up with the period above, and are never subtracted inside the revenue chart."
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
          <Link href="/admin/returns?status=all" className="underline hover:text-accent">
            Open returns
          </Link>
        </div>
        {refunds.pendingCount > 0 && (
          <Caveat>
            Approved-but-unpaid requests are shown whenever they were raised, not
            just this period, because that money is owed out regardless of when
            it was agreed. It is deliberately not inside any period&apos;s refund
            total until it is actually sent.
          </Caveat>
        )}
      </Panel>

      {/* ---- Splits ------------------------------------------------------- */}

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel
          title="By payment method"
          tip="Net revenue split by the method chosen at checkout, with the cash position for each. Bars share one zero-based scale, so their lengths are directly comparable."
        >
          <RankBars
            emptyText="No orders placed in this period."
            rows={report.byPaymentMethod.map((s) => ({
              key: s.key,
              label: s.label,
              value: s.netRevenue,
              valueLabel: formatINR(s.netRevenue),
              sub: (
                <>
                  {s.orders} order{s.orders === 1 ? "" : "s"} ·{" "}
                  <span className="tabular-nums">{formatINR(s.collected)}</span> collected
                  {s.outstanding > 0 && (
                    <>
                      {" "}
                      · <span className="tabular-nums">{formatINR(s.outstanding)}</span>{" "}
                      outstanding
                    </>
                  )}
                </>
              ),
            }))}
          />
        </Panel>

        <Panel
          title="By order status"
          tip="The same counted orders, split by where they are in the pipeline. Kept in lifecycle order rather than sorted by size — sorting would scramble the one thing this answers, which is where orders are piling up."
          subtitle="Cancelled orders are excluded from every money figure on this page, so they do not appear here."
        >
          <RankBars
            emptyText="No orders placed in this period."
            rows={report.byStatus.map((s) => ({
              key: s.key,
              label: s.label,
              value: s.netRevenue,
              valueLabel: formatINR(s.netRevenue),
              sub: (
                <>
                  {s.orders} order{s.orders === 1 ? "" : "s"}
                  {s.outstanding > 0 && (
                    <>
                      {" "}
                      · <span className="tabular-nums">{formatINR(s.outstanding)}</span> not yet
                      collected
                    </>
                  )}
                </>
              ),
            }))}
          />
          {revenue.cancelledOrders > 0 && (
            <Caveat>
              {revenue.cancelledOrders} cancelled order
              {revenue.cancelledOrders === 1 ? "" : "s"} worth{" "}
              {formatINR(revenue.cancelledValue)} were placed in this period and
              left out of every figure above.
            </Caveat>
          )}
        </Panel>
      </div>

      {/* ---- Coupons ------------------------------------------------------ */}

      <Panel
        title="Coupons redeemed"
        tip={METRIC.couponUse}
        subtitle="From the redemption ledger, which records a use even if the order is later cancelled — so this can exceed the discount inside net revenue above."
      >
        {report.coupons.length === 0 ? (
          <Empty>No coupons redeemed in this period.</Empty>
        ) : (
          <TableScroll>
            <table className="w-full text-sm">
              <caption className="sr-only">
                Coupons redeemed in {win.label.toLowerCase()}, by discount given
              </caption>
              <thead className="bg-muted/40">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Code
                  </th>
                  <th scope="col" className="px-3 py-2 text-right text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Uses
                  </th>
                  <th scope="col" className="px-3 py-2 text-right text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Discount given
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {report.coupons.map((c) => (
                  <tr key={c.code}>
                    <th scope="row" className="px-3 py-2 text-left font-normal">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{c.code}</code>
                        {!c.isActive && <Badge tone="neutral">Off</Badge>}
                      </span>
                    </th>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {c.uses}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      {formatINR(c.discount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Panel>
    </div>
  );
}
