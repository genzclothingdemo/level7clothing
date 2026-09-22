import {
  getAttentionQueue,
  getCustomerAnalytics,
  getFinanceReport,
  resolveWindow,
  delta,
  METRIC,
  NOT_MEASURED,
  TIMEZONE_NOTE,
  formatHours,
} from "@/lib/analytics";
import { InfoTip } from "@/components/store/info-tip";
import { ColumnChart } from "@/components/admin/finance-chart";
import {
  Caveat,
  Degraded,
  Empty,
  NotMeasured,
  Panel,
  PanelLink,
  StatTile,
  TileGrid,
  WorkQueue,
  formatCount,
  formatINR,
  formatPercent,
} from "@/components/admin/finance-ui";
import { Workspace, readClock } from "@/components/admin/dash-workspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

/**
 * Admin → Dashboard → Overview.
 *
 * The executive view, and the first of the workspace's six sections.
 *
 * **Work first, then money.** The queue used to be a half-width panel below
 * the headline tiles and a full-width chart — roughly 1,100px down, under the
 * fold at every size. That is the wrong order for the screen an owner opens at
 * nine in the morning: revenue is a report you consult, the queue is work you
 * clear, and it is the only block here with an action behind it. So the order
 * is now what needs doing → what the store took → how it is trending → the
 * shape of the business.
 *
 * Two deliberate scoping decisions, both stated on screen rather than only
 * here:
 *
 * - The tiles and the chart are scoped by the range control above them.
 * - **"Needs attention" is not.** An order that has been waiting a month to be
 *   confirmed is more urgent than one from this morning, so filtering that
 *   strip by the same window would hide precisely the rows that matter.
 *
 * The last panel is the list of things this workspace *cannot* compute — the
 * most expensive mistake available on a screen like this is believing a figure
 * exists when it does not, and every row doubles as the next thing to build.
 * It stays on Overview in full, but collapsed: it is read once and never
 * changes, and expanded it outweighed every live figure on the page.
 *
 * **Nothing on this screen prints an explanation.** Every panel used to carry a
 * subtitle paragraph, every tile a clause, and two panels a four-line caveat —
 * so the page was a third figures and two thirds sentences that are true on
 * every visit forever. None of that text is gone: it moved into the `(i)` the
 * figure already had (`note` on `Panel` and `StatTile`) or into a closed
 * `Caveat`. The rule to hold the line at: **if a string is the same on every
 * visit, it is documentation and belongs behind a tap.** Only values, counts
 * and labels are printed.
 */
export default async function AdminOverview({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; grain?: string }>;
}) {
  const sp = await searchParams;
  const now = await readClock();

  // The window is resolved once, up front, so all three reads below can run in
  // parallel against the same interval. Asking `getFinanceReport` for it first
  // and then chaining would serialise the whole page behind one query set, and
  // `getFinanceReport` is deliberately not React-cached — calling it twice
  // really does run it twice.
  const resolved = resolveWindow(sp.range, now);

  const [report, queue, customers] = await Promise.all([
    getFinanceReport(sp.range, now, sp.grain),
    getAttentionQueue(),
    // Needs the identity rule in lib/customers, which is a second fan-out of
    // queries. It is React-cached, so the Customers section rendering in the
    // same request shares this one resolution.
    getCustomerAnalytics(resolved, now),
  ]);

  const { revenue, cash, previous, window: win } = report;
  const vs = previous ? `vs ${previous.label}` : undefined;
  const nothing = revenue.orders === 0 && revenue.cancelledOrders === 0;

  /**
   * The queue, as chips.
   *
   * `short` is a noun phrase, not a sentence — these sit side by side in a
   * strip, so "orders waiting to be confirmed" and "cart leads nobody has
   * followed up" would wrap to two lines each and turn six chips into a
   * paragraph. `alert` is reserved for the three queues that cost money while
   * they sit there: an unconfirmed order, an open return and a live product
   * nobody can buy. Colouring all eight red would make none of them read as
   * urgent.
   */
  const queueRows = [
    {
      count: queue.pendingOrders,
      short: "to confirm",
      href: "/admin/orders?status=pending",
      tone: "alert" as const,
    },
    {
      count: queue.awaitingDispatch,
      short: "to dispatch",
      href: "/admin/orders?status=confirmed",
      tone: "neutral" as const,
    },
    {
      count: queue.openReturns,
      short: "returns open",
      one: "return open",
      href: "/admin/returns?status=all",
      tone: "alert" as const,
    },
    {
      count: queue.outOfStock,
      short: "out of stock",
      href: "/admin/products",
      tone: "alert" as const,
    },
    {
      count: queue.unreadChats,
      short: "unread chats",
      one: "unread chat",
      href: "/admin/messages",
      tone: "neutral" as const,
    },
    {
      count: queue.unreadInquiries,
      short: "inquiries",
      one: "inquiry",
      href: "/admin/messages",
      tone: "neutral" as const,
    },
    {
      count: queue.unapprovedReviews,
      short: "reviews to approve",
      one: "review to approve",
      href: "/admin/reviews",
      tone: "neutral" as const,
    },
    {
      count: queue.interestedLeads,
      short: "leads to follow up",
      one: "lead to follow up",
      href: "/admin/leads",
      tone: "neutral" as const,
    },
  ].filter((r) => r.count > 0);

  return (
    <Workspace>
      <div className="space-y-5">
        {(report.degraded || queue.degraded || customers.degraded) && <Degraded />}

        {/* ---- What needs doing ------------------------------------------
            First, above the money. This is the only block on the page with an
            action behind it, and it is the question the admin is opened to
            answer. It is also the one thing here the range control does not
            touch — see the (i) on it. */}

        <WorkQueue rows={queueRows} />

        {/* ---- Headline --------------------------------------------------- */}

        {/* Each `sub` is a count or a rupee figure — never a clause. The
            scoping and the definitions that used to ride along here are in each
            tile's own (i), which is where a reader looks for them anyway. */}
        <TileGrid>
          <StatTile
            emphasis
            label="Net revenue"
            value={formatINR(revenue.netRevenue)}
            tip={METRIC.netRevenue}
            note={`Scoped to ${win.phrase}, and to when each order was placed. Booked, not collected — the cash tile beside it is the money actually in hand.`}
            delta={previous ? delta(revenue.netRevenue, previous.netRevenue) : undefined}
            deltaLabel={vs}
          />
          <StatTile
            label="Orders"
            value={formatCount(revenue.orders)}
            tip={METRIC.orders}
            note={METRIC.cancelled}
            delta={previous ? delta(revenue.orders, previous.orders) : undefined}
            deltaLabel={vs}
            sub={
              revenue.cancelledOrders > 0
                ? `${revenue.cancelledOrders} cancelled, excluded`
                : undefined
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
            label="Cash collected"
            value={formatINR(cash.collected)}
            tip={METRIC.collected}
            note={METRIC.outstanding}
            sub={
              cash.outstanding > 0
                ? `${formatINR(cash.outstanding)} outstanding`
                : undefined
            }
          />
        </TileGrid>

        {/* Five words and an (i), where three lines of prose used to explain
            why the deltas are missing. It only appears on All time. */}
        {!previous && (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            No comparison on All time
            <InfoTip term="Period comparison">
              A delta needs an equally long period immediately before this one
              to compare against, and All time has nothing before it. Pick 7, 30
              or 90 days and every tile above grows a change figure.
            </InfoTip>
          </p>
        )}

        {/* ---- Trend ------------------------------------------------------ */}

        <Panel
          title="Net revenue over time"
          tip={METRIC.netRevenue}
          note={
            <>
              One bar per {report.granularity}, by order date. {TIMEZONE_NOTE}{" "}
              Refunds are <strong className="font-medium text-foreground">not</strong>{" "}
              netted out of these bars — they are dated by when the money left,
              which is a different day from the order. Sales breaks the same
              series down month by month.
            </>
          }
          aside={<PanelLink href="/admin/finance/sales">Sales</PanelLink>}
        >
          {report.granularityForced && (
            <Caveat label={`Showing ${report.granularity}s, not ${report.granularityForced}s`}>
              You asked for one bar per {report.granularityForced}, which over
              this range would be more than 120 bars — too many to read at any
              width. The chart is showing {report.granularity}s instead.
            </Caveat>
          )}
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
            tableHead={[
              report.granularity === "month"
                ? "Month"
                : report.granularity === "week"
                  ? "Week of"
                  : "Day",
              "Net revenue",
              "Orders / units",
            ]}
          />
        </Panel>

        {/* ---- The shape of the business ---------------------------------
            Two panels of four tiles each, side by side: who is buying, and
            how fast the store gets their parcel out. They pair because they
            are the same shape and the same question asked from two ends —
            demand and delivery. */}

        <div className="grid gap-5 lg:grid-cols-2">
          {/* `bare` tiles: these sit inside a panel that is already a card, and
              a bordered box drawn inside a bordered box is chrome describing
              chrome. Values only — the scoping that used to ride under each one
              is in its (i) and in the panel's. */}
          <Panel
            title="Who is buying"
            tip={METRIC.newVsReturning}
            note={
              <>
                Customer identity comes from the same merge rule as Admin →
                Customers, so the two screens cannot disagree about who a
                shopper is. Repeat rate and lifetime value are{" "}
                <strong className="font-medium text-foreground">all-time</strong>{" "}
                and do not move with the range control; the two order counts do.
              </>
            }
            aside={<PanelLink href="/admin/finance/customers">Customers</PanelLink>}
          >
            {customers.buyers === 0 ? (
              <Empty>Nobody has placed an order yet.</Empty>
            ) : (
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <StatTile
                  bare
                  label="Repeat rate"
                  value={formatPercent(customers.repeatRate)}
                  tip={METRIC.repeatRate}
                  sub={`${customers.repeatBuyers} of ${customers.buyers} buyers`}
                />
                <StatTile
                  bare
                  label="Median lifetime value"
                  value={formatINR(customers.medianLtv)}
                  tip={METRIC.ltv}
                  good="none"
                  sub={`mean ${formatINR(customers.meanLtv)}`}
                />
                <StatTile
                  bare
                  label="Orders from new customers"
                  value={formatCount(customers.windowNewOrders)}
                  tip={METRIC.newVsReturning}
                  good="none"
                  sub={formatINR(customers.windowNewRevenue)}
                />
                <StatTile
                  bare
                  label="Orders from returning"
                  value={formatCount(customers.windowReturningOrders)}
                  tip={METRIC.newVsReturning}
                  good="none"
                  sub={formatINR(customers.windowReturningRevenue)}
                />
              </div>
            )}
          </Panel>

          <Panel
            title="Getting orders out"
            tip={METRIC.dispatchTime}
            note={
              <>
                Measured over orders placed in {win.phrase} that have actually
                shipped — an order still sitting unshipped is not in the
                denominator, which is why each figure prints its own count.
                Fulfilment has the distributions behind these medians, the
                courier split and the full returns breakdown.
              </>
            }
            aside={<PanelLink href="/admin/finance/fulfilment">Fulfilment</PanelLink>}
          >
            {nothing ? (
              <Empty>No orders placed in this period.</Empty>
            ) : (
              // Two up, not `TileGrid`: this panel is a half-width column, where
              // four tiles across would put "Median delivery" on three lines. It
              // matches "Who is buying" beside it.
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <StatTile
                  bare
                  label="Median dispatch"
                  value={formatHours(report.fulfilment.dispatch.medianHours)}
                  tip={METRIC.dispatchTime}
                  good="down"
                  sub={
                    report.fulfilment.dispatch.count > 0
                      ? `${report.fulfilment.dispatch.count} shipped`
                      : "none shipped yet"
                  }
                />
                <StatTile
                  bare
                  label="Median delivery"
                  value={formatHours(report.fulfilment.delivery.medianHours)}
                  tip={METRIC.deliveryTime}
                  good="down"
                  sub={
                    report.fulfilment.delivery.count > 0
                      ? `${report.fulfilment.delivery.count} delivered`
                      : "none delivered yet"
                  }
                />
                <StatTile
                  bare
                  label="In transit"
                  value={formatCount(report.fulfilment.inTransit)}
                  tip="Orders from this period currently marked shipped and not yet delivered."
                  good="none"
                />
                <StatTile
                  bare
                  label="Return rate"
                  value={formatPercent(report.returnRate.orderRate)}
                  tip={METRIC.returnRate}
                  good="down"
                  sub={`${report.returnRate.ordersWithReturn} of ${revenue.orders} orders`}
                />
              </div>
            )}
          </Panel>
        </div>

        {/* ---- The honest blank ------------------------------------------- */}

        <Panel
          title="What this dashboard cannot tell you"
          tip="Written down rather than left as a gap. Every row is something an e-commerce dashboard normally shows and this one deliberately does not, because the data to compute it does not exist in this database."
          note="A plausible-looking number with nothing behind it is worse than an empty space — a real decision gets made on it. Each row names the one change that would make the figure real."
        >
          <NotMeasured rows={NOT_MEASURED} />
        </Panel>
      </div>
    </Workspace>
  );
}
