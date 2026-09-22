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
  ActionRow,
  Caveat,
  Empty,
  NotMeasured,
  Panel,
  StatTile,
  TileGrid,
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
 * The executive view, and the first of the workspace's six sections. It
 * answers three questions in the order an owner actually asks them: what did
 * the store take, where is it going, and what is waiting for me.
 *
 * Two deliberate scoping decisions, both stated on screen rather than only
 * here:
 *
 * - The tiles and the chart are scoped by the range control above them.
 * - **"Needs attention" is not.** An order that has been waiting a month to be
 *   confirmed is more urgent than one from this morning, so filtering that
 *   panel by the same window would hide precisely the rows that matter.
 *
 * The fourth panel is the list of things this workspace *cannot* compute. It
 * sits on Overview in full rather than tucked into a sub-page, because the
 * most expensive mistake available on a screen like this is believing a figure
 * exists when it does not — and every row doubles as the next thing to build.
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

  const queueRows = [
    {
      count: queue.pendingOrders,
      label: "orders waiting to be confirmed",
      detail: "Nothing reaches a courier until one of these is accepted.",
      href: "/admin/orders?status=pending",
      tone: "alert" as const,
    },
    {
      count: queue.awaitingDispatch,
      label: "confirmed orders with no AWB yet",
      detail:
        queue.draftStaged > 0
          ? `${queue.draftStaged} already ${queue.draftStaged === 1 ? "has" : "have"} a NimbusPost draft staged, waiting to be booked — that is the review gate, not a backlog.`
          : "None have a NimbusPost draft staged yet.",
      href: "/admin/orders?status=confirmed",
      tone: "neutral" as const,
    },
    {
      count: queue.openReturns,
      label: "return requests still open",
      detail: "Pending, approved, picked up or received — none of them finished.",
      href: "/admin/returns?status=all",
      tone: "alert" as const,
    },
    {
      count: queue.outOfStock,
      label: "live product pages that cannot be bought",
      detail: "Active on the storefront with no stock left.",
      href: "/admin/products",
      tone: "alert" as const,
    },
    {
      count: queue.unreadChats,
      label: "chats with an unread message",
      href: "/admin/messages",
      tone: "neutral" as const,
    },
    {
      count: queue.unreadInquiries,
      label: "unread contact-form inquiries",
      href: "/admin/messages",
      tone: "neutral" as const,
    },
    {
      count: queue.unapprovedReviews,
      label: "reviews awaiting moderation",
      detail: "Not visible on the storefront until approved.",
      href: "/admin/reviews",
      tone: "neutral" as const,
    },
    {
      count: queue.interestedLeads,
      label: "cart leads nobody has followed up",
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

        {/* ---- The queue + the shape of the business ---------------------- */}

        <div className="grid gap-5 lg:grid-cols-2">
          <Panel
            title="Needs attention"
            tip="Everything currently sitting in a queue, across the whole store. Deliberately NOT filtered by the time range above: an order that has been waiting a month to be confirmed is more urgent than one placed this morning, and scoping this panel to the last 30 days would hide it."
            subtitle="Right now, not this period. Every row links to the screen where you can clear it."
          >
            {queueRows.length === 0 ? (
              <Empty>Nothing is waiting. Every queue in the store is empty.</Empty>
            ) : (
              <ul className="-my-1">
                {queueRows.map((r) => (
                  <ActionRow
                    key={r.label}
                    count={formatCount(r.count)}
                    label={r.label}
                    detail={r.detail}
                    href={r.href}
                    tone={r.tone}
                  />
                ))}
              </ul>
            )}
          </Panel>

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
        </div>

        {/* ---- Operations at a glance ------------------------------------- */}

        <Panel
          title="Getting orders out"
          tip={METRIC.dispatchTime}
          subtitle={`Measured over orders placed in ${win.phrase} that have actually shipped.`}
        >
          {nothing ? (
            <Empty>No orders placed in this period.</Empty>
          ) : (
            <TileGrid>
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
            </TileGrid>
          )}
          <Caveat>
            <Link href="/admin/finance/fulfilment" className="underline hover:text-accent">
              Fulfilment
            </Link>{" "}
            has the distributions behind these medians, the courier split and
            the full returns breakdown.
          </Caveat>
        </Panel>

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
