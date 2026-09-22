import Link from "next/link";
import {
  getCustomerAnalytics,
  resolveWindow,
  METRIC,
  RFM_MINIMUM,
  RFM_SEGMENT_LABEL,
  notMeasuredFor,
  type RfmSegmentKey,
} from "@/lib/analytics";
import { HeatGrid, RankBars } from "@/components/admin/finance-chart";
import {
  Caveat,
  Empty,
  NotMeasured,
  PAGE_SIZE,
  Pager,
  Panel,
  StatTile,
  TileGrid,
  formatCount,
  formatINR,
  formatPercent,
  pageFrom,
} from "@/components/admin/finance-ui";
import { DataTable, Num } from "@/components/admin/finance-table";
import { readClock } from "@/components/admin/dash-workspace";
import { Badge } from "@/components/admin/order-ui";
import { adminLink } from "@/lib/customers";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard — Customers" };

/**
 * Admin → Dashboard → Customers.
 *
 * Who buys, who buys again, and what happens to a month's worth of new
 * shoppers over the year that follows.
 *
 * **None of the identity work happens here.** Who counts as one person is a
 * merge rule over six tables — guest orders joined onto accounts by email,
 * family phone numbers deliberately not merged — and it lives in
 * `lib/customers.ts`. Re-deriving an approximation of it in this module is
 * exactly how two admin screens end up quoting different numbers for the same
 * shopper, so this page reads the same resolved directory that Admin →
 * Customers does, through the same React-cached call.
 *
 * Two clocks, kept visibly apart: the lifetime figures (repeat rate, LTV, RFM,
 * cohorts) are all-time and do NOT move with the range control, because a
 * "repeat rate over 7 days" measures the width of the window. New versus
 * returning is windowed, and says so.
 */

/** Which tone a segment wears. Only the two extremes get colour. */
const SEGMENT_TONE: Record<RfmSegmentKey, "success" | "danger" | "neutral"> = {
  champions: "success",
  loyal: "neutral",
  promising: "neutral",
  needsAttention: "neutral",
  atRisk: "danger",
  lost: "danger",
};

export default async function CustomersSection({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; grain?: string; tp?: string }>;
}) {
  const sp = await searchParams;
  const now = await readClock();
  const win = resolveWindow(sp.range, now);
  const c = await getCustomerAnalytics(win, now);

  const topPage = pageFrom(sp.tp, c.top.length);
  const topRows = c.top.slice((topPage - 1) * PAGE_SIZE, topPage * PAGE_SIZE);

  const windowOrders = c.windowNewOrders + c.windowReturningOrders;

  /* -- cohort grid ------------------------------------------------------- */

  const cohortColumns = Array.from({ length: c.cohortWidth }, (_, i) =>
    i === 0 ? "Month 0" : `+${i}`
  );
  const cohortRows = c.cohorts.map((row) => ({
    key: row.key,
    label: row.label,
    sub: `(${row.size})`,
    cells: row.cells,
    details: row.counts.map((n, i) =>
      n === null ? null : `${n} of ${row.size} ordered in month ${i}`
    ),
  }));

  /* -- RFM grid ---------------------------------------------------------- */
  //
  // Rows run 3 → 1 so the best recency is at the top, which is the direction a
  // reader expects from a grid with "most recent" as an axis.

  const rfmRows =
    c.rfmGrid && c.rfmCutoffs
      ? [3, 2, 1].map((r) => ({
          key: `r${r}`,
          label:
            r === 3
              ? "Ordered recently"
              : r === 2
                ? "A while ago"
                : "A long time ago",
          sub:
            r === 3
              ? `≤ ${Math.round(c.rfmCutoffs!.recencyDays[0])}d`
              : r === 2
                ? `≤ ${Math.round(c.rfmCutoffs!.recencyDays[1])}d`
                : `> ${Math.round(c.rfmCutoffs!.recencyDays[1])}d`,
          cells: c.rfmGrid![r - 1].map((n) => n),
          details: c.rfmGrid![r - 1].map((n) => `${n} customer${n === 1 ? "" : "s"}`),
        }))
      : [];
  const rfmMax = c.rfmGrid ? Math.max(1, ...c.rfmGrid.flat()) : 1;

  return (
    <div className="space-y-5">
      {c.degraded && (
        <p className="rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-xs text-danger">
          The customer directory could not be read, so this section is empty.
          This is a reporting failure, not a business one.
        </p>
      )}

      {c.buyers === 0 ? (
        <Panel
          title="Customers"
          tip={METRIC.repeatRate}
        >
          <Empty>
            Nobody has placed a counted order yet, so there is nothing to
            segment. Cancelled orders do not make someone a customer.
          </Empty>
        </Panel>
      ) : (
        <>
          <TileGrid>
            <StatTile
              emphasis
              label="Repeat rate"
              value={formatPercent(c.repeatRate)}
              tip={METRIC.repeatRate}
              sub={`${c.repeatBuyers} of ${c.buyers} buyers have ordered more than once · all time, not filtered by the range`}
            />
            <StatTile
              label="Buyers"
              value={formatCount(c.buyers)}
              tip="Everyone who has ever placed a counted order, after the merge rule in lib/customers.ts has joined their guest orders and their account into one person."
              good="none"
              sub={`${c.newCustomers} first ordered in ${win.phrase}`}
            />
            <StatTile
              label="Median lifetime value"
              value={formatINR(c.medianLtv)}
              tip={METRIC.ltv}
              good="none"
              sub={`mean ${formatINR(c.meanLtv)}`}
            />
            <StatTile
              label="Revenue from returning"
              value={formatPercent(
                c.windowNewRevenue + c.windowReturningRevenue > 0
                  ? Math.round(
                      (c.windowReturningRevenue /
                        (c.windowNewRevenue + c.windowReturningRevenue)) *
                        1000
                    ) / 10
                  : null
              )}
              tip={METRIC.newVsReturning}
              good="none"
              sub={`${formatINR(c.windowReturningRevenue)} of ${formatINR(c.windowNewRevenue + c.windowReturningRevenue)} · ${win.label.toLowerCase()}`}
            />
          </TileGrid>

          <Caveat>
            The first three tiles are <strong className="font-medium text-foreground">all-time</strong>{" "}
            and do not move when you change the range — a repeat rate measured
            over seven days would mostly be measuring the seven days. Only the
            fourth tile, and the panel below it, are scoped to {win.phrase}.
          </Caveat>

          {/* ---- New vs returning ---------------------------------------- */}

          <Panel
            title="New against returning"
            tip={METRIC.newVsReturning}
            subtitle={`Every counted order placed in ${win.phrase}, split by whether it was that customer's first order ever.`}
          >
            {windowOrders === 0 ? (
              <Empty>No counted orders in this period.</Empty>
            ) : (
              <RankBars
                rows={[
                  {
                    key: "new",
                    label: "First-time orders",
                    value: c.windowNewOrders,
                    valueLabel: `${c.windowNewOrders} order${c.windowNewOrders === 1 ? "" : "s"}`,
                    sub: (
                      <>
                        <span className="tabular-nums">{formatINR(c.windowNewRevenue)}</span> ·{" "}
                        {formatPercent(
                          Math.round((c.windowNewOrders / windowOrders) * 1000) / 10
                        )}{" "}
                        of orders this period
                      </>
                    ),
                  },
                  {
                    key: "returning",
                    label: "Repeat orders",
                    value: c.windowReturningOrders,
                    valueLabel: `${c.windowReturningOrders} order${c.windowReturningOrders === 1 ? "" : "s"}`,
                    sub: (
                      <>
                        <span className="tabular-nums">
                          {formatINR(c.windowReturningRevenue)}
                        </span>{" "}
                        ·{" "}
                        {formatPercent(
                          Math.round((c.windowReturningOrders / windowOrders) * 1000) / 10
                        )}{" "}
                        of orders this period
                      </>
                    ),
                  },
                ]}
              />
            )}
            <Caveat>
              &ldquo;First&rdquo; means first counted order ever, not first in
              this period — so a customer who ordered last year and again today
              counts as repeat, which is the only reading that does not reset
              every time the range changes. Revenue here is net of discount and
              excludes shipping, the same definition the headline uses; the
              lifetime-value tile above uses order <em>total</em> instead,
              because that is what Admin → Customers shows per person.
            </Caveat>
          </Panel>

          {/* ---- RFM ------------------------------------------------------ */}

          <Panel
            title="Recency and frequency"
            tip={METRIC.rfmScore}
            subtitle="Every buyer placed in a 3 × 3 grid: how recently they last ordered, against how often they have ordered. All-time, and scored against this store's own customers rather than an industry benchmark."
          >
            {!c.rfmGrid || !c.rfmCutoffs ? (
              <Empty>
                {c.buyers} buyer{c.buyers === 1 ? "" : "s"} is not enough to cut
                into terciles — it needs at least {RFM_MINIMUM}. Below that the
                cut-points are noise, and one person would land in
                &ldquo;Champions&rdquo; purely for having ordered most recently.
                Top buyers by spend are listed further down and do not need a
                segmentation to be useful.
              </Empty>
            ) : (
              <>
                <HeatGrid
                  rows={rfmRows}
                  columns={["Once", "A few times", "Often"]}
                  rowHeader="Last ordered"
                  format={(n) => formatCount(n)}
                  max={rfmMax}
                  caption="Buyers by recency tercile against frequency tercile"
                  nullLabel="0"
                />
                <Caveat>
                  Cut-points are this store&apos;s own 33rd and 67th percentiles:
                  recent means within{" "}
                  {Math.round(c.rfmCutoffs.recencyDays[0])} days, often means{" "}
                  {c.rfmCutoffs.frequency[1]} orders or more. They are a rank
                  against your other customers and mean nothing next to another
                  store&apos;s. Spend is scored the same way but is not on this
                  grid — two axes is all a grid can carry, and it rides in the
                  table below instead.
                </Caveat>
              </>
            )}
          </Panel>

          {c.segments.length > 0 && (
            <Panel
              title="Segments"
              tip={METRIC.rfmSegment}
              subtitle="A name for each cell of the grid above, not a sum of the two scores — adding them would make “ordered once yesterday” and “ordered five times a year ago” the same customer."
            >
              <RankBars
                rows={c.segments.map((s) => ({
                  key: s.key,
                  label: s.label,
                  value: s.customers,
                  valueLabel: `${s.customers} customer${s.customers === 1 ? "" : "s"}`,
                  sub: (
                    <>
                      <span className="tabular-nums">{formatINR(s.spend)}</span> of
                      lifetime spend between them
                    </>
                  ),
                }))}
              />
            </Panel>
          )}

          {/* ---- Cohorts --------------------------------------------------- */}

          <Panel
            title="Cohort retention"
            tip={METRIC.cohortRetention}
            subtitle="Customers grouped by the month of their first order. Each column is the share of that group who ordered again that many months later. All-time, and not filtered by the range."
          >
            {c.cohorts.length === 0 ? (
              <Empty>No counted orders yet, so there are no cohorts.</Empty>
            ) : (
              <>
                <HeatGrid
                  rows={cohortRows}
                  columns={cohortColumns}
                  rowHeader="First ordered"
                  format={(n) => formatPercent(n)}
                  max={100}
                  caption="Share of each first-order month's customers ordering again, by months since"
                  nullLabel="—"
                />
                <Caveat>
                  The number in brackets after each month is how many customers
                  started in it — read that before the colour. A retention
                  percentage over three people moves 33 points when one of them
                  orders. Month 0 is 100% by definition: it is the group&apos;s
                  own definition, kept as the baseline everything to its right
                  is read against. An empty cell is a month that has not
                  happened yet for that group, never a zero.
                </Caveat>
              </>
            )}
          </Panel>

          {/* ---- Top buyers ------------------------------------------------ */}

          <Panel
            title="Biggest customers"
            tip={METRIC.ltv}
            subtitle="By lifetime spend, all-time. Every name links to their full record."
          >
            {c.top.length === 0 ? (
              <Empty>Nobody has placed a counted order yet.</Empty>
            ) : (
              <>
                <DataTable
                  caption="Customers by lifetime spend"
                  columns={[
                    { key: "name", label: "Customer", align: "left" },
                    { key: "spend", label: "Lifetime spend", tip: METRIC.ltv },
                    { key: "orders", label: "Orders" },
                    { key: "last", label: "Last order", secondary: true },
                    { key: "seg", label: "Segment", tip: METRIC.rfmSegment, secondary: true },
                  ]}
                >
                  {topRows.map((row) => (
                    <tr key={row.id}>
                      <th scope="row" className="min-w-0 px-3 py-2 text-left font-normal">
                        <Link
                          href={adminLink.customer(row.id)}
                          className="break-words hover:text-accent"
                        >
                          {row.name}
                        </Link>
                      </th>
                      <Num strong>{formatINR(row.spend)}</Num>
                      <Num>{row.orders}</Num>
                      <Num muted secondary>
                        {row.daysSinceLastOrder === 0
                          ? "today"
                          : `${row.daysSinceLastOrder}d ago`}
                      </Num>
                      <td className="hidden whitespace-nowrap px-3 py-2 text-right sm:table-cell">
                        {row.recency > 0 ? (
                          <Badge tone={SEGMENT_TONE[row.segment]}>
                            {RFM_SEGMENT_LABEL[row.segment]}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </DataTable>
                <Pager
                  basePath="/admin/finance/customers"
                  params={{ range: sp.range, grain: sp.grain, tp: sp.tp }}
                  param="tp"
                  page={topPage}
                  total={c.top.length}
                  noun="customers"
                />
                <Caveat>
                  Lifetime spend is Σ order total over non-cancelled orders —
                  what the customer was billed, shipping included. It is the
                  same figure{" "}
                  <Link href="/admin/customers" className="underline hover:text-accent">
                    Admin → Customers
                  </Link>{" "}
                  shows on each person, which is why it is slightly higher than
                  net revenue elsewhere in this workspace.
                  {!c.rfm && " Segments are blank because there are too few buyers to score."}
                </Caveat>
              </>
            )}
          </Panel>
        </>
      )}

      {/* ---- The honest blank ------------------------------------------------ */}

      <Panel
        title="What this section cannot tell you"
        tip="The absences that belong to the customer view specifically. The full list is on Overview."
      >
        <NotMeasured rows={notMeasuredFor("customers")} />
      </Panel>
    </div>
  );
}
