import Link from "next/link";
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
import { ColumnChart } from "@/components/admin/finance-chart";
import {
  Caveat,
  Empty,
  NotMeasured,
  Panel,
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
        {(report.degraded || queue.degraded || customers.degraded) && (
          <p className="rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-xs text-danger">
            At least one query failed, so some panels below may read zero. This
            is a reporting failure, not a business one — check the database
            connection before acting on anything here.
          </p>
        )}

        {/* ---- What needs doing ------------------------------------------
            First, above the money. This is the only block on the page with an
            action behind it, and it is the question the admin is opened to
            answer. It is also the one thing here the range control does not
            touch — see the (i) on it. */}

        <WorkQueue rows={queueRows} />

        {/* ---- Headline --------------------------------------------------- */}

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
                ? `${revenue.cancelledOrders} cancelled excluded`
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
            label="Cash collected"
            value={formatINR(cash.collected)}
            tip={METRIC.collected}
            sub={
              cash.outstanding > 0
                ? `${formatINR(cash.outstanding)} billed and not yet in hand`
                : "nothing outstanding"
            }
          />
        </TileGrid>

        {!previous && (
          <p className="text-xs text-muted-foreground">
            No period-on-period comparison on All time — there is no equally
            long period before it to compare against. Pick 7, 30 or 90 days for
            deltas.
          </p>
        )}

        {/* ---- Trend ------------------------------------------------------ */}

        <Panel
          title="Net revenue over time"
          tip={METRIC.netRevenue}
          subtitle={
            <>
              One bar per {report.granularity}, by order date. {TIMEZONE_NOTE}{" "}
              Refunds are <strong className="font-medium text-foreground">not</strong>{" "}
              netted out of these bars — they are dated by when the money left,
              which is a different day from the order.{" "}
              <Link href="/admin/finance/sales" className="underline hover:text-accent">
                Sales
              </Link>{" "}
              breaks the same series down month by month.
            </>
          }
        >
          {report.granularityForced && (
            <Caveat>
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
          <Panel
            title="Who is buying"
            tip={METRIC.newVsReturning}
            subtitle={
              <>
                Customer identity comes from the same merge rule as{" "}
                <Link href="/admin/customers" className="underline hover:text-accent">
                  Admin → Customers
                </Link>
                , so the two screens cannot disagree about who a shopper is.
              </>
            }
          >
            {customers.buyers === 0 ? (
              <Empty>Nobody has placed an order yet.</Empty>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <StatTile
                  label="Repeat rate"
                  value={formatPercent(customers.repeatRate)}
                  tip={METRIC.repeatRate}
                  sub={`${customers.repeatBuyers} of ${customers.buyers} buyers have ordered more than once · all time`}
                />
                <StatTile
                  label="Median lifetime value"
                  value={formatINR(customers.medianLtv)}
                  tip={METRIC.ltv}
                  good="none"
                  sub={`mean ${formatINR(customers.meanLtv)} · billed, incl. shipping`}
                />
                <StatTile
                  label="Orders from new customers"
                  value={formatCount(customers.windowNewOrders)}
                  tip={METRIC.newVsReturning}
                  good="none"
                  sub={`${formatINR(customers.windowNewRevenue)} · ${win.label.toLowerCase()}`}
                />
                <StatTile
                  label="Orders from returning"
                  value={formatCount(customers.windowReturningOrders)}
                  tip={METRIC.newVsReturning}
                  good="none"
                  sub={`${formatINR(customers.windowReturningRevenue)} · ${win.label.toLowerCase()}`}
                />
              </div>
            )}
            <Caveat>
              Repeat rate and lifetime value are all-time and do not move with
              the range control; the two order counts do.{" "}
              <Link href="/admin/finance/customers" className="underline hover:text-accent">
                Customers
              </Link>{" "}
              has the segments and the cohort retention behind these.
            </Caveat>
          </Panel>

          <Panel
            title="Getting orders out"
            tip={METRIC.dispatchTime}
            subtitle={`Measured over orders placed in ${win.phrase} that have actually shipped.`}
          >
            {nothing ? (
              <Empty>No orders placed in this period.</Empty>
            ) : (
              // Two up, not `TileGrid`: this panel is now a half-width column,
              // where four tiles across would put "Median delivery" on three
              // lines. It matches "Who is buying" beside it.
              <div className="grid grid-cols-2 gap-3">
              <StatTile
                label="Median dispatch"
                value={formatHours(report.fulfilment.dispatch.medianHours)}
                tip={METRIC.dispatchTime}
                good="down"
                sub={
                  report.fulfilment.dispatch.count > 0
                    ? `over ${report.fulfilment.dispatch.count} shipped order${report.fulfilment.dispatch.count === 1 ? "" : "s"}`
                    : "nothing has shipped yet"
                }
              />
              <StatTile
                label="Median delivery"
                value={formatHours(report.fulfilment.delivery.medianHours)}
                tip={METRIC.deliveryTime}
                good="down"
                sub={
                  report.fulfilment.delivery.count > 0
                    ? `over ${report.fulfilment.delivery.count} delivered order${report.fulfilment.delivery.count === 1 ? "" : "s"}`
                    : "nothing delivered yet"
                }
              />
              <StatTile
                label="In transit"
                value={formatCount(report.fulfilment.inTransit)}
                tip="Orders from this period currently marked shipped and not yet delivered."
                good="none"
              />
              <StatTile
                label="Return rate"
                value={formatPercent(report.returnRate.orderRate)}
                tip={METRIC.returnRate}
                good="down"
                sub={`${report.returnRate.ordersWithReturn} of ${revenue.orders} orders`}
              />
              </div>
            )}
            <Caveat>
              <Link href="/admin/finance/fulfilment" className="underline hover:text-accent">
                Fulfilment
              </Link>{" "}
              has the distributions behind these medians, the courier split and
              the full returns breakdown.
            </Caveat>
          </Panel>
        </div>

        {/* ---- The honest blank ------------------------------------------- */}

        <Panel
          title="What this dashboard cannot tell you"
          tip="Written down rather than left as a gap. Every row is something an e-commerce dashboard normally shows and this one deliberately does not, because the data to compute it does not exist in this database."
          subtitle="A plausible-looking number with nothing behind it is worse than an empty space — a real decision gets made on it. Each row names the one change that would make the figure real."
        >
          <NotMeasured rows={NOT_MEASURED} />
        </Panel>
      </div>
    </Workspace>
  );
}
