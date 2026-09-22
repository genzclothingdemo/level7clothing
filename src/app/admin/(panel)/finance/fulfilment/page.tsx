import Link from "next/link";
import {
  getFinanceReport,
  METRIC,
  notMeasuredFor,
  formatHours,
} from "@/lib/analytics";
import { RankBars } from "@/components/admin/finance-chart";
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
import { DataTable, Num } from "@/components/admin/finance-table";
import { readClock } from "@/components/admin/dash-workspace";
import { RETURN_STATUS_LABEL, isReturnStatus } from "@/lib/returns";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard — Fulfilment" };

/**
 * Admin → Dashboard → Fulfilment.
 *
 * How long a parcel takes to leave, how long it takes to arrive, who carried
 * it, and how much of it came back.
 *
 * Every duration on this page is measured from the order's own
 * `statusHistory`, which is the only record of *when* an order moved — the
 * columns on `Order` say only where it is now. That has one consequence worth
 * stating plainly and repeating on screen: **only orders that reached a
 * milestone are in that milestone's denominator.** An order still sitting
 * unshipped does not appear as a fast dispatch; it is simply not counted, and
 * the count is printed beside every median so the reader can see how thin the
 * evidence is.
 */
export default async function FulfilmentSection({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; grain?: string }>;
}) {
  const sp = await searchParams;
  const now = await readClock();
  const report = await getFinanceReport(sp.range, now, sp.grain);

  const { fulfilment: f, returnRate, revenue, refunds, window: win } = report;
  const nothing = revenue.orders === 0 && revenue.cancelledOrders === 0;

  const pipeline = [
    {
      key: "pending",
      label: "Waiting to be confirmed",
      value: f.awaitingConfirmation,
      href: "/admin/orders?status=pending",
    },
    {
      key: "confirmed",
      label: "Confirmed, not yet booked",
      value: f.awaitingDispatch,
      href: "/admin/orders?status=confirmed",
    },
    {
      key: "shipped",
      label: "In transit",
      value: f.inTransit,
      href: "/admin/orders?status=shipped",
    },
    {
      key: "delivered",
      label: "Delivered",
      value: f.delivered,
      href: "/admin/orders?status=delivered",
    },
    {
      key: "cancelled",
      label: "Cancelled",
      value: f.cancelled,
      href: "/admin/orders?status=cancelled",
    },
  ];

  const durations = [
    {
      key: "dispatch",
      title: "Placed → shipped",
      d: f.dispatch,
      tip: METRIC.dispatchTime,
    },
    {
      key: "delivery",
      title: "Shipped → delivered",
      d: f.delivery,
      tip: METRIC.deliveryTime,
    },
    {
      key: "endToEnd",
      title: "Placed → delivered",
      d: f.endToEnd,
      tip: METRIC.endToEndTime,
    },
  ];

  return (
    <div className="space-y-5">
      {report.degraded && <Degraded />}

      <TileGrid>
        <StatTile
          emphasis
          label="Median dispatch"
          value={formatHours(f.dispatch.medianHours)}
          tip={METRIC.dispatchTime}
          good="down"
          note={METRIC.medianVsMean}
          sub={
            f.dispatch.count > 0
              ? `${f.dispatch.count} shipped · mean ${formatHours(f.dispatch.meanHours)}`
              : "none shipped yet"
          }
        />
        <StatTile
          label="Median delivery"
          value={formatHours(f.delivery.medianHours)}
          tip={METRIC.deliveryTime}
          good="down"
          note={METRIC.medianVsMean}
          sub={
            f.delivery.count > 0
              ? `${f.delivery.count} delivered · mean ${formatHours(f.delivery.meanHours)}`
              : "none delivered yet"
          }
        />
        <StatTile
          label="Awaiting dispatch"
          value={formatCount(f.awaitingDispatch)}
          tip={METRIC.awaitingDispatch}
          good="down"
          sub={f.draftStaged > 0 ? `${f.draftStaged} drafts staged` : undefined}
        />
        <StatTile
          label="Return rate"
          value={formatPercent(returnRate.orderRate)}
          tip={METRIC.returnRate}
          good="down"
          sub={`${returnRate.ordersWithReturn} of ${revenue.orders} order${revenue.orders === 1 ? "" : "s"}`}
        />
      </TileGrid>

      {/* ---- Pipeline ------------------------------------------------------ */}

      <Panel
        title="Where orders are"
        tip="Counted orders placed in this period, by the status they are in right now. Kept in lifecycle order rather than sorted by size — sorting would scramble the one thing this answers, which is where orders are piling up."
        note={`Placed in ${win.phrase}. Cancelled orders are shown here for completeness and are excluded from every money figure in this workspace.`}
      >
        {nothing ? (
          <Empty>No orders placed in this period.</Empty>
        ) : (
          <>
            <RankBars
              rows={pipeline.map((s) => ({
                key: s.key,
                label: s.label,
                value: s.value,
                valueLabel: `${s.value} order${s.value === 1 ? "" : "s"}`,
              }))}
            />
            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span>Open in Orders:</span>
              {pipeline
                .filter((s) => s.value > 0)
                .map((s) => (
                  <Link
                    key={s.key}
                    href={s.href}
                    className="underline capitalize hover:text-accent"
                  >
                    {s.key}
                  </Link>
                ))}
            </div>
          </>
        )}
        {f.rto > 0 && (
          <Caveat label={`${f.rto} with a courier RTO status`}>
            {f.rto} order{f.rto === 1 ? "" : "s"} from this period{" "}
            {f.rto === 1 ? "has" : "have"} a courier status mentioning RTO
            (return to origin). There is no RTO order status — a completed RTO
            maps to cancelled — so this is read off the raw status the courier
            last reported, and it only sees orders NimbusPost is tracking.
          </Caveat>
        )}
      </Panel>

      {/* ---- Durations ------------------------------------------------------ */}

      <div className="grid gap-5 lg:grid-cols-3">
        {durations.map((row) => (
          <Panel key={row.key} title={row.title} tip={row.tip}>
            {row.d.count === 0 ? (
              <Empty>No order from this period has reached that point yet.</Empty>
            ) : (
              <>
                <div className="mb-3">
                  <DefRow
                    label="Median"
                    value={formatHours(row.d.medianHours)}
                    tip={METRIC.medianVsMean}
                    strong
                  />
                  <DefRow
                    label="Mean"
                    value={formatHours(row.d.meanHours)}
                    tip={METRIC.medianVsMean}
                  />
                  <DefRow
                    label="Orders measured"
                    value={formatCount(row.d.count)}
                    tip="Orders from this period that actually reached both ends of this leg. An order still in the earlier state is not in the denominator — it is neither fast nor slow yet."
                  />
                </div>
                <RankBars
                  rows={row.d.buckets.map((b) => ({
                    key: b.key,
                    label: b.label,
                    value: b.count,
                    valueLabel: `${b.count}`,
                  }))}
                />
              </>
            )}
          </Panel>
        ))}
      </div>

      {/* ---- Couriers -------------------------------------------------------- */}

      <Panel
        title="Couriers"
        tip={METRIC.courierSplit}
        note="Who actually carried the parcel. NimbusPost allocates the carrier at booking, which is not always the one picked while reviewing rates."
      >
        {f.couriers.length === 0 ? (
          <Empty>
            No order from this period has a courier recorded yet.
          </Empty>
        ) : (
          <RankBars
            rows={f.couriers.map((c) => ({
              key: c.key,
              label: c.label,
              value: c.orders,
              valueLabel: `${c.orders} parcel${c.orders === 1 ? "" : "s"}`,
              sub: `${c.delivered} delivered so far`,
            }))}
          />
        )}
        {f.courierUnknown > 0 && (
          <Caveat label={`${f.courierUnknown} with no courier recorded`}>
            {f.courierUnknown} shipped or delivered order
            {f.courierUnknown === 1 ? "" : "s"} from this period{" "}
            {f.courierUnknown === 1 ? "has" : "have"} no courier name recorded —
            marked shipped by hand rather than booked through NimbusPost. They
            are left out of the bars above rather than lumped into an
            &ldquo;Other&rdquo; carrier that does not exist.
          </Caveat>
        )}
      </Panel>

      {/* ---- Returns --------------------------------------------------------- */}

      <Panel
        title="What came back"
        tip={METRIC.returnRate}
        note={`Return requests raised against orders PLACED in ${win.phrase} — the same set of orders every other figure on this page counts.`}
        aside={<PanelLink href="/admin/returns?status=all">Open returns</PanelLink>}
      >
        {returnRate.ordersWithReturn === 0 ? (
          <Empty>
            Nothing from {win.phrase} has been sent back.
          </Empty>
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <DefRow
                label="Orders with a return"
                value={`${returnRate.ordersWithReturn} of ${revenue.orders}`}
                tip={METRIC.returnRate}
              />
              <DefRow
                label="Order return rate"
                value={formatPercent(returnRate.orderRate)}
                tip={METRIC.returnRate}
                strong
              />
              <DefRow
                label="Units returned"
                value={`${returnRate.unitsReturned} of ${revenue.units}`}
                tip={METRIC.unitReturnRate}
              />
              <DefRow
                label="Unit return rate"
                value={formatPercent(returnRate.unitRate)}
                tip={METRIC.unitReturnRate}
                strong
              />
              <div className="mt-4 border-t border-dashed border-border pt-2">
                <DefRow
                  label="Refunds paid out this period"
                  value={formatINR(refunds.net)}
                  tip={METRIC.refundsPaid}
                />
                {refunds.pendingCount > 0 && (
                  <DefRow
                    label="Approved, not yet paid"
                    value={formatINR(refunds.pendingValue)}
                    tip={METRIC.refundPending}
                  />
                )}
              </div>
            </div>
            <div className="space-y-4">
              {returnRate.byReason.length > 0 && (
                <div>
                  <p className="eyebrow mb-2">Why</p>
                  <RankBars
                    rows={returnRate.byReason.map((r) => ({
                      key: r.reason,
                      label: r.reason,
                      value: r.count,
                      valueLabel: `${r.count} request${r.count === 1 ? "" : "s"}`,
                      sub: `${r.units} unit${r.units === 1 ? "" : "s"}`,
                    }))}
                  />
                </div>
              )}
              {returnRate.byStatus.length > 0 && (
                <DataTable
                  caption="Return requests by status"
                  columns={[
                    { key: "status", label: "Status", align: "left" },
                    { key: "n", label: "Requests" },
                  ]}
                >
                  {returnRate.byStatus.map((s) => (
                    <tr key={s.status}>
                      <th scope="row" className="px-3 py-2 text-left font-normal">
                        {isReturnStatus(s.status) ? RETURN_STATUS_LABEL[s.status] : s.status}
                      </th>
                      <Num>{s.count}</Num>
                    </tr>
                  ))}
                </DataTable>
              )}
            </div>
          </div>
        )}
        <Caveat label="Why a narrow range reads low">
          Numerator and denominator are the same set of orders, which is what
          makes this a rate rather than two counts on two clocks divided by each
          other. It is right-censored: an order placed yesterday has had one day
          to come back, so a narrow range always reads low. The refund figures
          beside it are the exception — those are dated by when the money left,
          so they can belong to orders from an earlier period.{" "}
          <Link href="/admin/finance/products" className="underline hover:text-accent">
            Return rate per product
          </Link>
        </Caveat>
      </Panel>

      {/* ---- The honest blank ------------------------------------------------ */}

      <Panel
        title="What this section cannot tell you"
        tip="The absences that belong to fulfilment specifically. The full list is on Overview."
      >
        <NotMeasured rows={notMeasuredFor("fulfilment")} />
      </Panel>
    </div>
  );
}
