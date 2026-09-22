import {
  getFinanceReport,
  monthOnMonth,
  delta,
  METRIC,
  TIMEZONE_NOTE,
  notMeasuredFor,
} from "@/lib/analytics";
import { ColumnChart, RankBars } from "@/components/admin/finance-chart";
import {
  Caveat,
  Degraded,
  Empty,
  NotMeasured,
  PAGE_SIZE,
  Pager,
  Panel,
  PanelLink,
  StatTile,
  TileGrid,
  formatCount,
  formatDelta,
  formatINR,
  formatPercent,
  pageFrom,
} from "@/components/admin/finance-ui";
import { DataTable, Num } from "@/components/admin/finance-table";
import { readClock } from "@/components/admin/dash-workspace";
import { TableScroll } from "@/components/admin/form-kit";
import { Badge } from "@/components/admin/order-ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard — Sales" };

/**
 * Admin → Dashboard → Sales.
 *
 * What was sold, how it moved, and where it went. The order of the page is the
 * order the questions get asked: the shape over time, then month against
 * month, then the three ways the same set of orders can be cut — how they were
 * paid for, where they are in the pipeline, and which part of the country they
 * went to.
 *
 * The money *composition* — gross to net, cash collected, refunds — lives on
 * Finance rather than here, because those are questions about the bank
 * balance and these are questions about the shop.
 */
export default async function SalesSection({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; grain?: string; cp?: string }>;
}) {
  const sp = await searchParams;
  const now = await readClock();
  const report = await getFinanceReport(sp.range, now, sp.grain);

  const { revenue, previous, window: win, places } = report;
  const vs = previous ? `vs ${previous.label}` : undefined;
  const nothing = revenue.orders === 0 && revenue.cancelledOrders === 0;

  const mom = monthOnMonth(report.months, now);

  const cityPage = pageFrom(sp.cp, places.cities.length);
  const cityRows = places.cities.slice((cityPage - 1) * PAGE_SIZE, cityPage * PAGE_SIZE);

  return (
    <div className="space-y-5">
      {report.degraded && <Degraded />}

      <TileGrid>
        <StatTile
          emphasis
          label="Net revenue"
          value={formatINR(revenue.netRevenue)}
          tip={METRIC.netRevenue}
          note={`Scoped to ${win.phrase}. Booked at placement, not collected — Finance has the cash position.`}
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
              ? `${revenue.cancelledOrders} cancelled · ${formatINR(revenue.cancelledValue)}`
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
          label="Units sold"
          value={formatCount(revenue.units)}
          tip={METRIC.units}
          delta={previous ? delta(revenue.units, previous.units) : undefined}
          deltaLabel={vs}
          sub={
            revenue.orders > 0
              ? `${Math.round((revenue.units / revenue.orders) * 10) / 10} per order`
              : undefined
          }
        />
      </TileGrid>

      {/* ---- Trend --------------------------------------------------------- */}

      <Panel
        title="Net revenue over time"
        tip={METRIC.netRevenue}
        note={
          <>
            One bar per {report.granularity}, by order date. {TIMEZONE_NOTE}{" "}
            {win.days !== null && (
              <>
                The window is a rolling one ending now, so the first and last
                bars cover part of a {report.granularity} and will read low.
                They are kept rather than trimmed, because dropping them would
                take real orders out of the total to tidy the axis.
              </>
            )}
          </>
        }
      >
        {report.granularityForced && (
          <Caveat label={`Showing ${report.granularity}s, not ${report.granularityForced}s`}>
            You asked for one bar per {report.granularityForced}, which over
            this range would be more than 120 bars. The chart is showing{" "}
            {report.granularity}s instead.
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

      {/* ---- Month on month ------------------------------------------------ */}

      <Panel
        title="Month on month"
        tip="Net revenue bucketed by calendar month, whatever bucket size the chart above is using, with each month's change against the one before it. Calendar months, not rolling 30-day blocks — a rolling comparison drifts across month boundaries and stops matching anything anyone else counts."
        note="Only months with at least one order in the selected range appear."
      >
        {mom.length === 0 ? (
          <Empty>No orders in this period.</Empty>
        ) : (
          <>
            <DataTable
              caption={`Net revenue by calendar month across ${win.phrase}, with month-on-month change`}
              columns={[
                { key: "month", label: "Month", align: "left" },
                { key: "rev", label: "Net revenue", tip: METRIC.netRevenue },
                { key: "mom", label: "Change" },
                { key: "orders", label: "Orders", secondary: true },
                { key: "aov", label: "AOV", tip: METRIC.aov, secondary: true },
              ]}
            >
              {mom.map((m) => (
                <tr key={m.point.key}>
                  <th scope="row" className="px-3 py-2 text-left font-normal">
                    <span className="flex flex-wrap items-center gap-1.5">
                      {m.point.label}
                      {m.partial && (
                        <Badge
                          tone="neutral"
                          title="This month is still running, so its total is a part month and its change compares part of a month against a whole one."
                        >
                          Part month
                        </Badge>
                      )}
                    </span>
                  </th>
                  <Num strong>{formatINR(m.point.netRevenue)}</Num>
                  <Num muted>{m.change === null ? "—" : formatDelta(m.change)}</Num>
                  <Num muted secondary>
                    {m.point.orders}
                  </Num>
                  <Num muted secondary>
                    {m.point.orders > 0
                      ? formatINR(Math.round(m.point.netRevenue / m.point.orders))
                      : "—"}
                  </Num>
                </tr>
              ))}
            </DataTable>
            <Caveat label="Blank changes and part months">
              The first row has no change because there is nothing before it
              inside the range — widen the range to compare it against an
              earlier month. A month marked <em>part month</em> is still
              running; its change is not a like-for-like comparison and is shown
              only so the current month is not missing from the table.
            </Caveat>
          </>
        )}
      </Panel>

      {/* ---- Splits -------------------------------------------------------- */}

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
          note="Cancelled orders are excluded from every money figure on this page, so they do not appear here."
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
                      · <span className="tabular-nums">{formatINR(s.outstanding)}</span> not
                      yet collected
                    </>
                  )}
                </>
              ),
            }))}
          />
          {revenue.cancelledOrders > 0 && (
            <Caveat label={`${revenue.cancelledOrders} cancelled, not counted`}>
              {revenue.cancelledOrders} cancelled order
              {revenue.cancelledOrders === 1 ? "" : "s"} worth{" "}
              {formatINR(revenue.cancelledValue)}{" "}
              {revenue.cancelledOrders === 1 ? "was" : "were"} placed in this
              period and left out of every figure above.
            </Caveat>
          )}
        </Panel>
      </div>

      {/* ---- Where it went -------------------------------------------------- */}

      <Panel
        title="Where the orders went"
        tip={METRIC.place}
        note="From the shipping address on each counted order."
      >
        {places.states.length === 0 ? (
          <Empty>No counted order in this period named a state.</Empty>
        ) : (
          <RankBars
            rows={places.states.slice(0, 8).map((s) => ({
              key: s.key,
              label: s.label,
              value: s.orders,
              valueLabel: `${s.orders} order${s.orders === 1 ? "" : "s"}`,
              sub: (
                <>
                  <span className="tabular-nums">{formatINR(s.netRevenue)}</span> ·{" "}
                  {s.units} unit{s.units === 1 ? "" : "s"}
                  {s.spellings.length > 1 && (
                    <> · typed {s.spellings.length} different ways: {s.spellings.join(", ")}</>
                  )}
                </>
              ),
            }))}
          />
        )}
        <Caveat label="City and state are free text">
          City and state are free text the customer typed — there is no dropdown
          behind either field. Rows are folded on case and stray spaces only, so{" "}
          <em>gujarat</em> and <em>Gujarat</em> are one row and a misspelling
          stays its own. Correcting spellings would need a place list and a
          guess, and a wrong guess silently welds two real places into a number
          nobody can unpick.
          {places.missingState > 0 && (
            <>
              {" "}
              {places.missingState} counted order
              {places.missingState === 1 ? "" : "s"} left the state blank and
              {places.missingState === 1 ? " is" : " are"} not in the list above.
            </>
          )}
        </Caveat>
      </Panel>

      <Panel
        title="By city"
        tip={METRIC.place}
        note={`Every city named on a counted order in ${win.phrase}, busiest first.`}
      >
        {places.cities.length === 0 ? (
          <Empty>No counted order in this period named a city.</Empty>
        ) : (
          <>
            <TableScroll>
              <table className="w-full min-w-[26rem] text-sm">
                <caption className="sr-only">
                  Counted orders by city in {win.phrase}
                </caption>
                <thead className="bg-muted/40">
                  <tr>
                    <th
                      scope="col"
                      className="px-3 py-2 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
                    >
                      City
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-2 text-right text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
                    >
                      Orders
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-2 text-right text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
                    >
                      Units
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-2 text-right text-[10px] font-medium uppercase tracking-wider text-muted-foreground"
                    >
                      Net revenue
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {cityRows.map((c) => (
                    <tr key={c.key}>
                      <th scope="row" className="px-3 py-2 text-left font-normal">
                        <span className="break-words">{c.label}</span>
                        {c.spellings.length > 1 && (
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            Also typed {c.spellings.filter((s) => s !== c.label).join(", ")}
                          </span>
                        )}
                      </th>
                      <Num>{c.orders}</Num>
                      <Num muted>{c.units}</Num>
                      <Num strong>{formatINR(c.netRevenue)}</Num>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
            <Pager
              basePath="/admin/finance/sales"
              params={{ range: sp.range, grain: sp.grain, cp: sp.cp }}
              param="cp"
              page={cityPage}
              total={places.cities.length}
              noun="cities"
            />
          </>
        )}
      </Panel>

      {/* ---- Coupons -------------------------------------------------------- */}

      <Panel
        title="Coupons redeemed"
        tip={METRIC.couponUse}
        note="From the redemption ledger, which records a use even if the order is later cancelled — so this can exceed the discount inside net revenue above."
      >
        {report.coupons.length === 0 ? (
          <Empty>No coupons redeemed in this period.</Empty>
        ) : (
          <>
            <DataTable
              caption={`Coupons redeemed in ${win.phrase}, by discount given`}
              columns={[
                { key: "code", label: "Code", align: "left" },
                { key: "uses", label: "Uses" },
                { key: "discount", label: "Discount given", tip: METRIC.discounts },
              ]}
            >
              {report.coupons.map((c) => (
                <tr key={c.code}>
                  <th scope="row" className="px-3 py-2 text-left font-normal">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{c.code}</code>
                      {!c.isActive && <Badge tone="neutral">Off</Badge>}
                    </span>
                  </th>
                  <Num muted>{c.uses}</Num>
                  <Num strong>{formatINR(c.discount)}</Num>
                </tr>
              ))}
            </DataTable>
            {/* Stays printed: it is a measured share and a pair of counts, not
                a standing explanation. */}
            <p className="mt-3 text-xs text-muted-foreground">
              <span className="tabular-nums text-foreground">
                {formatPercent(
                  revenue.grossGoods > 0
                    ? Math.round((revenue.discounts / revenue.grossGoods) * 1000) / 10
                    : null
                )}
              </span>{" "}
              of goods value discounted · {revenue.couponOrders} of {revenue.orders}{" "}
              orders
            </p>
          </>
        )}
      </Panel>

      {/* ---- The honest blank ------------------------------------------------ */}

      <Panel
        title="What this section cannot tell you"
        tip="The absences that belong to sales specifically. The full list is on Overview."
        note="Overview carries the complete list, including the ones that belong to other sections."
        aside={<PanelLink href="/admin">Full list</PanelLink>}
      >
        <NotMeasured rows={notMeasuredFor("sales")} />
      </Panel>

      {nothing && (
        <p className="text-xs text-muted-foreground">
          Nothing was placed in {win.phrase}. Widen the range
          to see earlier activity.
        </p>
      )}
    </div>
  );
}
