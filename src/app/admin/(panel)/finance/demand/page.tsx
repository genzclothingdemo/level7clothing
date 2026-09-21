import Link from "next/link";
import { getFinanceReport, METRIC, NOT_MEASURED } from "@/lib/analytics";
import { RankBars } from "@/components/admin/finance-chart";
import {
  Caveat,
  Empty,
  PAGE_SIZE,
  Pager,
  Panel,
  StatTile,
  TileGrid,
  formatCount,
  formatINR,
  pageFrom,
} from "@/components/admin/finance-ui";
import { DataTable, Num, ProductName } from "@/components/admin/finance-table";
import { LEAD_STATUS_LABEL, isLeadStatus } from "@/lib/leads";

export const dynamic = "force-dynamic";
export const metadata = { title: "Finance — Demand" };

/**
 * Admin → Finance → Demand.
 *
 * Interest against orders — and, just as deliberately, a written list of what
 * this store cannot measure.
 *
 * The temptation on a page like this is a four-stage funnel from "impressions"
 * down to "purchases". Three of those four stages do not exist in this
 * database: no analytics provider is wired up, nothing records a page view,
 * and an order carries no `visitorId`, so an add-to-cart event cannot be
 * matched to the order that followed it. A funnel drawn on top of that would
 * be a picture of numbers that were made up, and someone would make a real
 * decision on it.
 *
 * So: the two counts that DO exist are shown side by side, the ratio between
 * them is named for exactly what it is, and everything else is listed under
 * "What this cannot tell you" with the change it would take to measure it.
 */

async function readClock(): Promise<Date> {
  return new Date();
}

export default async function FinanceDemand({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; ip?: string }>;
}) {
  const sp = await searchParams;
  const now = await readClock();
  const report = await getFinanceReport(sp.range, now);

  const { funnel, products, window: win } = report;

  // Anything anyone showed interest in, or bought. Sorted by interest, because
  // the question this table answers is "what is being picked up and put down".
  const interest = products
    .filter((p) => p.cartAdds > 0 || p.wishlistSaves > 0 || p.units > 0)
    .sort((a, b) => b.cartAdds - a.cartAdds || b.units - a.units);

  const page = pageFrom(sp.ip, interest.length);
  const rows = interest.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  /** Cart-add events per unit sold. Deliberately not called a conversion rate. */
  const addsPerUnit = (adds: number, units: number): string => {
    if (adds === 0) return "—";
    if (units === 0) return "no sales";
    return `${(adds / units).toFixed(1)}×`;
  };

  return (
    <div className="space-y-5">
      <TileGrid>
        <StatTile
          label="Add-to-cart events"
          value={formatCount(funnel.cartAdds)}
          tip={METRIC.cartAdds}
          sub={`${formatCount(funnel.cartAddUnits)} units put in carts`}
          good="none"
        />
        <StatTile
          label="Browsers adding"
          value={formatCount(funnel.cartBrowsers)}
          tip={METRIC.cartBrowsers}
          sub="browsers, not people"
          good="none"
        />
        <StatTile
          label="Wishlist saves"
          value={formatCount(funnel.wishlistSaves)}
          tip={METRIC.wishlistSaves}
          sub="signed-in accounts only"
          good="none"
        />
        <StatTile
          label="Orders placed"
          value={formatCount(funnel.orders)}
          tip={METRIC.orders}
          sub={`${formatCount(funnel.units)} units sold`}
        />
      </TileGrid>

      {/* ---- Interest against orders -------------------------------------- */}

      <Panel
        title="Interest against orders"
        tip="Two counts that both exist in the database, shown on one zero-based scale. They are counts of different things — cart-add events, and units on orders — so the gap between them is a difference in volume, not a measured drop-off."
        subtitle={`Over the ${win.label.toLowerCase()}.`}
      >
        {funnel.cartAdds === 0 && funnel.units === 0 ? (
          <Empty>No cart activity and no orders in this period.</Empty>
        ) : (
          <RankBars
            rows={[
              {
                key: "adds",
                label: "Units added to carts",
                value: funnel.cartAddUnits,
                valueLabel: formatCount(funnel.cartAddUnits),
                sub: `across ${funnel.cartAdds} add-to-cart event${funnel.cartAdds === 1 ? "" : "s"} from ${funnel.cartBrowsers} browser${funnel.cartBrowsers === 1 ? "" : "s"}`,
              },
              {
                key: "wish",
                label: "Wishlist saves",
                value: funnel.wishlistSaves,
                valueLabel: formatCount(funnel.wishlistSaves),
                sub: "signed-in accounts only — a guest wishlist never reaches the database",
              },
              {
                key: "units",
                label: "Units ordered",
                value: funnel.units,
                valueLabel: formatCount(funnel.units),
                sub: `across ${funnel.orders} order${funnel.orders === 1 ? "" : "s"}, cancelled ones excluded`,
              },
            ]}
          />
        )}
        <Caveat>
          <strong className="font-medium text-foreground">
            This is not a funnel, and the ratio between these bars is not a
            conversion rate.
          </strong>{" "}
          A cart-add row is written when something goes into a cart and is never
          deleted when it comes back out or when it is bought, and an order
          carries no visitor id — so the same shopper&apos;s add and purchase
          cannot be linked, and neither can their abandonment. These are three
          independent counts over the same period. Making them into a funnel
          would need one column: the cart&apos;s visitor id copied onto the
          order at checkout.
        </Caveat>
      </Panel>

      {/* ---- Per product --------------------------------------------------- */}

      <Panel
        title="Interest by product"
        tip={METRIC.cartAdds}
        subtitle="Where interest and sales disagree. A piece with many cart adds and no sales was wanted and something stopped it; a piece with neither was never picked up at all."
      >
        {interest.length === 0 ? (
          <Empty>No cart activity, wishlist saves or sales in this period.</Empty>
        ) : (
          <>
            <DataTable
              caption={`Products by cart-add events in the ${win.label.toLowerCase()}, against units sold`}
              columns={[
                { key: "name", label: "Product", align: "left" },
                { key: "adds", label: "Cart adds", tip: METRIC.cartAdds },
                { key: "units", label: "Units sold", tip: METRIC.units },
                {
                  key: "ratio",
                  label: "Adds per unit",
                  tip: "Cart-add events ÷ units sold, for this product, in this period. A count of one thing over a count of another — the two cannot be attributed to the same shoppers, so this is a rough signal of interest that is not converting, NOT a conversion rate.",
                },
                {
                  key: "wish",
                  label: "Wishlisted",
                  tip: METRIC.wishlistSaves,
                  secondary: true,
                },
                {
                  key: "rev",
                  label: "Net revenue",
                  tip: METRIC.productRevenue,
                  secondary: true,
                },
              ]}
            >
              {rows.map((p) => (
                <tr key={p.key}>
                  <ProductName product={p} />
                  <Num strong>{p.cartAdds || "—"}</Num>
                  <Num>{p.units || "—"}</Num>
                  <Num muted>{addsPerUnit(p.cartAdds, p.units)}</Num>
                  <Num muted secondary>
                    {p.wishlistSaves || "—"}
                  </Num>
                  <Num muted secondary>
                    {p.netRevenue > 0 ? formatINR(p.netRevenue) : "—"}
                  </Num>
                </tr>
              ))}
            </DataTable>
            <Pager
              basePath="/admin/finance/demand"
              params={{ range: sp.range, ip: sp.ip }}
              param="ip"
              page={page}
              total={interest.length}
              noun="products"
            />
            <Caveat>
              Cart adds are matched to a product by its id, and wishlist saves by
              its slug — so a piece deleted since shows its sales but no
              wishlist figure, and both columns read &ldquo;—&rdquo; rather than
              zero when there is nothing to report.
            </Caveat>
          </>
        )}
      </Panel>

      {/* ---- Lead pipeline -------------------------------------------------- */}

      <Panel
        title="Cart leads by follow-up status"
        tip="The status an admin set on each cart lead in Interested customers. It is a record of what a human did about the lead, not something the store measured — an untouched lead stays 'interested' forever."
      >
        {funnel.leadsByStatus.length === 0 ? (
          <Empty>No cart leads in this period.</Empty>
        ) : (
          <>
            <RankBars
              rows={funnel.leadsByStatus.map((s) => ({
                key: s.status,
                label: isLeadStatus(s.status) ? LEAD_STATUS_LABEL[s.status] : s.status,
                value: s.count,
                valueLabel: formatCount(s.count),
              }))}
            />
            <div className="mt-3 text-xs text-muted-foreground">
              {funnel.anonymousCartAdds > 0 && (
                <>
                  {funnel.anonymousCartAdds} of {funnel.cartAdds} left no email and
                  no phone, so there is nobody to follow up.{" "}
                </>
              )}
              <Link href="/admin/leads" className="underline hover:text-accent">
                Open interested customers
              </Link>
            </div>
          </>
        )}
      </Panel>

      {/* ---- The honest blank ------------------------------------------------ */}

      <Panel
        title="What this cannot tell you"
        tip="Written down rather than left as a gap. Every row is something an e-commerce dashboard normally shows and this one deliberately does not, because the data to compute it does not exist in this database."
        subtitle="A plausible-looking number with nothing behind it is worse than an empty space — a real decision gets made on it."
      >
        <ul className="divide-y divide-border">
          {NOT_MEASURED.map((row) => (
            <li key={row.metric} className="py-3 first:pt-0 last:pb-0">
              <p className="text-sm font-medium">{row.metric}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{row.why}</p>
              <p className="mt-1.5 text-xs leading-relaxed">
                <span className="eyebrow">To measure it</span>{" "}
                <span className="text-muted-foreground">{row.toGetIt}</span>
              </p>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
