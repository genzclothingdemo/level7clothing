import Link from "next/link";
import {
  getFinanceReport,
  highDemandLowStock,
  slowMovers,
  METRIC,
} from "@/lib/analytics";
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
import {
  BarCell,
  DataTable,
  Num,
  ProductName,
  StockCell,
} from "@/components/admin/finance-table";

export const dynamic = "force-dynamic";
export const metadata = { title: "Finance — Products" };

/**
 * Admin → Finance → Products.
 *
 * What sold, what is about to run out, and what is sitting there.
 *
 * Every row comes out of `Order.items`, which is a **by-value snapshot**: the
 * name and price are what the customer saw, frozen at purchase. Resolving
 * that back to the catalogue is the whole difficulty of this screen, and it
 * is done once in `lib/analytics` — a line is grouped by its product id where
 * it has one (so a renamed piece stays one row, under its name today), by
 * name where it does not, and a piece deleted since is kept and badged rather
 * than dropped, because the money it took was real.
 */

async function readClock(): Promise<Date> {
  return new Date();
}

export default async function FinanceProducts({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; p?: string; sp?: string }>;
}) {
  const sp = await searchParams;
  const now = await readClock();
  const report = await getFinanceReport(sp.range, now);

  const { products, catalogue, window: win } = report;

  // Already sorted by net revenue in the module; the units view re-sorts a copy.
  const sold = products.filter((p) => p.units > 0);
  const byUnits = [...sold].sort((a, b) => b.units - a.units || b.netRevenue - a.netRevenue);
  const restock = highDemandLowStock(products);
  const slow = slowMovers(products);

  const soldPage = pageFrom(sp.p, sold.length);
  const soldRows = sold.slice((soldPage - 1) * PAGE_SIZE, soldPage * PAGE_SIZE);
  const maxRevenue = sold[0]?.netRevenue ?? 0;

  const slowPage = pageFrom(sp.sp, slow.length);
  const slowRows = slow.slice((slowPage - 1) * PAGE_SIZE, slowPage * PAGE_SIZE);

  const pagerParams = { range: sp.range, p: sp.p, sp: sp.sp };

  return (
    <div className="space-y-5">
      {/* ---- Catalogue, right now ---------------------------------------- */}

      <TileGrid>
        <StatTile
          label="Pieces sold"
          value={formatCount(sold.length)}
          tip="Distinct products with at least one unit on a counted order in this period. Cancelled orders are excluded, so a piece that only appears on a cancelled order counts as unsold."
          sub={`of ${catalogue.active} active · ${win.label.toLowerCase()}`}
        />
        <StatTile
          label="Units sold"
          value={formatCount(report.revenue.units)}
          tip={METRIC.units}
        />
        <StatTile
          label="Units in stock"
          value={formatCount(catalogue.unitsInStock)}
          tip="Σ Product.stock across the whole catalogue, as it stands right now. Not a windowed figure — stock is a present-tense fact and does not have a period."
          good="none"
        />
        <StatTile
          label="Out of stock"
          value={formatCount(catalogue.outOfStock)}
          tip="Active products whose stock is zero or less. Still listed on the storefront, so every one of these is a live product page that cannot be bought."
          good="down"
          sub={catalogue.outOfStock > 0 ? "live pages that cannot be bought" : "nothing to fix"}
        />
      </TileGrid>

      {/* ---- Restock: the list that costs money --------------------------- */}

      <Panel
        title="High demand, low stock"
        tip={METRIC.daysOfCover}
        subtitle="Ranked by days of cover — the shortest first. A stockout on a piece that is selling is revenue that simply never happens, which is why this list sits above the rankings."
      >
        {win.days === null ? (
          <Empty>
            Days of cover needs a rate, and All time averages over the store&apos;s
            whole life. Pick 7, 30 or 90 days to see what is about to run out.
          </Empty>
        ) : restock.length === 0 ? (
          <Empty>
            Nothing is inside 30 days of cover at the rate measured over the{" "}
            {win.label.toLowerCase()}.
          </Empty>
        ) : (
          <>
            <DataTable
              caption={`Products with under 30 days of stock cover at the rate measured over the ${win.label.toLowerCase()}`}
              columns={[
                { key: "name", label: "Product", align: "left" },
                { key: "cover", label: "Days of cover", tip: METRIC.daysOfCover },
                { key: "stock", label: "In stock" },
                { key: "units", label: "Sold", tip: METRIC.units },
                { key: "rev", label: "Net revenue", tip: METRIC.productRevenue, secondary: true },
              ]}
            >
              {restock.map((p) => (
                <tr key={p.key}>
                  <ProductName product={p} />
                  <Num strong>
                    {p.daysOfCover !== null && p.daysOfCover < 1
                      ? "<1"
                      : p.daysOfCover?.toFixed(1)}
                  </Num>
                  <StockCell product={p} />
                  <Num muted>{p.units}</Num>
                  <Num muted secondary>
                    {formatINR(p.netRevenue)}
                  </Num>
                </tr>
              ))}
            </DataTable>
            <Caveat>
              Days of cover assumes the last {win.days} days repeat. It does not
              know about a drop you are planning, a festival week, or the fact
              that a piece only started selling three days ago — a product with
              one recent sale and one unit left reads as one day of cover, which
              is arithmetic, not a forecast.
            </Caveat>
          </>
        )}
      </Panel>

      {/* ---- Rankings ----------------------------------------------------- */}

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel
          title="Top sellers by units"
          tip={METRIC.units}
          subtitle="What moves. Bars share one zero-based scale."
        >
          <RankBars
            emptyText="Nothing sold in this period."
            rows={byUnits.slice(0, 8).map((p) => ({
              key: p.key,
              label: p.name,
              value: p.units,
              valueLabel: `${p.units} unit${p.units === 1 ? "" : "s"}`,
              sub: (
                <>
                  <span className="tabular-nums">{formatINR(p.netRevenue)}</span> across{" "}
                  {p.orders} order{p.orders === 1 ? "" : "s"}
                  {p.stock !== null && (
                    <> · {p.stock > 0 ? `${p.stock} left` : "out of stock"}</>
                  )}
                </>
              ),
            }))}
          />
        </Panel>

        <Panel
          title="Top sellers by revenue"
          tip={METRIC.productRevenue}
          subtitle="What pays. A different order from units whenever price varies across the catalogue."
        >
          <RankBars
            emptyText="Nothing sold in this period."
            rows={sold.slice(0, 8).map((p) => ({
              key: p.key,
              label: p.name,
              value: p.netRevenue,
              valueLabel: formatINR(p.netRevenue),
              sub: (
                <>
                  {p.units} unit{p.units === 1 ? "" : "s"} across {p.orders} order
                  {p.orders === 1 ? "" : "s"}
                </>
              ),
            }))}
          />
        </Panel>
      </div>

      {/* ---- Everything that sold ----------------------------------------- */}

      <Panel
        title="Everything that sold"
        tip={METRIC.productRevenue}
        subtitle={`Every product with at least one unit on a counted order in the ${win.label.toLowerCase()}, highest revenue first.`}
      >
        {sold.length === 0 ? (
          <Empty>Nothing sold in this period.</Empty>
        ) : (
          <>
            <DataTable
              caption={`All products sold in the ${win.label.toLowerCase()}, by net revenue`}
              columns={[
                { key: "name", label: "Product", align: "left" },
                { key: "bar", label: "", align: "left" },
                { key: "rev", label: "Net revenue", tip: METRIC.productRevenue },
                { key: "units", label: "Units", tip: METRIC.units },
                { key: "orders", label: "Orders", secondary: true },
                { key: "stock", label: "In stock", secondary: true },
                {
                  key: "adds",
                  label: "Cart adds",
                  tip: METRIC.cartAdds,
                  secondary: true,
                },
              ]}
            >
              {soldRows.map((p) => (
                <tr key={p.key}>
                  <ProductName product={p} />
                  <BarCell value={p.netRevenue} max={maxRevenue} />
                  <Num strong>{formatINR(p.netRevenue)}</Num>
                  <Num>{p.units}</Num>
                  <Num muted secondary>
                    {p.orders}
                  </Num>
                  <StockCell product={p} secondary />
                  <Num muted secondary>
                    {p.cartAdds || "—"}
                  </Num>
                </tr>
              ))}
            </DataTable>
            <Pager
              basePath="/admin/finance/products"
              params={pagerParams}
              param="p"
              page={soldPage}
              total={sold.length}
              noun="products"
            />
          </>
        )}
      </Panel>

      {/* ---- Slow movers ---------------------------------------------------- */}

      <Panel
        title="Slow movers"
        tip="Active catalogue pieces that sold nothing at all in this period. Ordered by the value of the stock tied up in them (stock × current price), because that is what the decision is actually about."
        subtitle="Deleted and unlinked rows are left out — there is nothing left to act on."
      >
        {slow.length === 0 ? (
          <Empty>
            Every active product sold at least one unit in the{" "}
            {win.label.toLowerCase()}.
          </Empty>
        ) : (
          <>
            <DataTable
              caption={`Active products with no sales in the ${win.label.toLowerCase()}`}
              columns={[
                { key: "name", label: "Product", align: "left" },
                { key: "tied", label: "Stock value" },
                { key: "stock", label: "In stock" },
                { key: "adds", label: "Cart adds", tip: METRIC.cartAdds },
                {
                  key: "wish",
                  label: "Wishlisted",
                  tip: METRIC.wishlistSaves,
                  secondary: true,
                },
              ]}
            >
              {slowRows.map((p) => (
                <tr key={p.key}>
                  <ProductName product={p} />
                  <Num strong>{formatINR((p.stock ?? 0) * (p.price ?? 0))}</Num>
                  <StockCell product={p} />
                  <Num muted>{p.cartAdds || "—"}</Num>
                  <Num muted secondary>
                    {p.wishlistSaves || "—"}
                  </Num>
                </tr>
              ))}
            </DataTable>
            <Pager
              basePath="/admin/finance/products"
              params={pagerParams}
              param="sp"
              page={slowPage}
              total={slow.length}
              noun="products"
            />
            <Caveat>
              A piece with cart adds but no sales is a different problem from one
              with neither: the first was wanted and something stopped it, the
              second was never picked up. Which of the two it is cannot be
              answered from this database —{" "}
              <Link href="/admin/finance/demand" className="underline hover:text-accent">
                see what is not measurable
              </Link>
              .
            </Caveat>
          </>
        )}
      </Panel>
    </div>
  );
}
