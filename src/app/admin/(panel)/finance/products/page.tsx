import {
  getFinanceReport,
  highDemandLowStock,
  slowMovers,
  METRIC,
  notMeasuredFor,
} from "@/lib/analytics";
import { RankBars } from "@/components/admin/finance-chart";
import {
  Caveat,
  Empty,
  NotMeasured,
  PAGE_SIZE,
  Pager,
  Panel,
  PanelLink,
  StatTile,
  TileGrid,
  formatCount,
  formatINR,
  formatPercent,
  pageFrom,
} from "@/components/admin/finance-ui";
import {
  BarCell,
  DataTable,
  Num,
  ProductName,
  StockCell,
} from "@/components/admin/finance-table";
import { readClock } from "@/components/admin/dash-workspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard — Products" };

/**
 * Admin → Dashboard → Products.
 *
 * What sold, what is about to run out, what is sitting there, and — for a
 * clothing brand, the question that actually drives a reorder — which sizes
 * went.
 *
 * Every row comes out of `Order.items`, which is a **by-value snapshot**: the
 * name, the price and the chosen options are what the customer saw, frozen at
 * purchase. Resolving that back to the catalogue is the whole difficulty of
 * this screen, and it is done once in `lib/analytics` — a line is grouped by
 * its product id where it has one (so a renamed piece stays one row, under its
 * name today), by name where it does not, and a piece deleted since is kept
 * and badged rather than dropped, because the money it took was real.
 */
export default async function ProductsSection({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; grain?: string; p?: string; sp?: string; ip?: string }>;
}) {
  const sp = await searchParams;
  const now = await readClock();
  const report = await getFinanceReport(sp.range, now, sp.grain);

  const { products, catalogue, optionMix, funnel, window: win } = report;

  // Already sorted by net revenue in the module; the units view re-sorts a copy.
  const sold = products.filter((p) => p.units > 0);
  const byUnits = [...sold].sort((a, b) => b.units - a.units || b.netRevenue - a.netRevenue);
  const restock = highDemandLowStock(products);
  const slow = slowMovers(products);
  const returned = sold
    .filter((p) => p.unitsReturned > 0)
    .sort((a, b) => (b.returnRate ?? 0) - (a.returnRate ?? 0) || b.unitsReturned - a.unitsReturned);

  const interest = products
    .filter((p) => p.cartAdds > 0 || p.wishlistSaves > 0 || p.units > 0)
    .sort((a, b) => b.cartAdds - a.cartAdds || b.units - a.units);

  const soldPage = pageFrom(sp.p, sold.length);
  const soldRows = sold.slice((soldPage - 1) * PAGE_SIZE, soldPage * PAGE_SIZE);
  const maxRevenue = sold[0]?.netRevenue ?? 0;

  const slowPage = pageFrom(sp.sp, slow.length);
  const slowRows = slow.slice((slowPage - 1) * PAGE_SIZE, slowPage * PAGE_SIZE);

  const interestPage = pageFrom(sp.ip, interest.length);
  const interestRows = interest.slice(
    (interestPage - 1) * PAGE_SIZE,
    interestPage * PAGE_SIZE
  );

  const pagerParams = { range: sp.range, grain: sp.grain, p: sp.p, sp: sp.sp, ip: sp.ip };

  /** Cart-add events per unit sold. Deliberately not called a conversion rate. */
  const addsPerUnit = (adds: number, units: number): string => {
    if (adds === 0) return "—";
    if (units === 0) return "no sales";
    return `${(adds / units).toFixed(1)}×`;
  };

  return (
    <div className="space-y-5">
      {/* ---- Catalogue, right now ---------------------------------------- */}

      <TileGrid>
        <StatTile
          label="Pieces sold"
          value={formatCount(sold.length)}
          tip="Distinct products with at least one unit on a counted order in this period. Cancelled orders are excluded, so a piece that only appears on a cancelled order counts as unsold."
          sub={`of ${catalogue.active} active`}
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
          sub={catalogue.outOfStock > 0 ? "live pages, unbuyable" : undefined}
        />
      </TileGrid>

      {/* ---- Restock: the list that costs money --------------------------- */}

      <Panel
        title="High demand, low stock"
        tip={METRIC.daysOfCover}
        note="Ranked by days of cover — the shortest first. A stockout on a piece that is selling is revenue that simply never happens, which is why this list sits above the rankings."
        aside={<PanelLink href="/admin/products">Products</PanelLink>}
      >
        {win.days === null ? (
          <Empty>
            Days of cover needs a rate, and All time averages over the store&apos;s
            whole life. Pick 7, 30 or 90 days to see what is about to run out.
          </Empty>
        ) : restock.length === 0 ? (
          <Empty>
            Nothing is inside 30 days of cover at the rate measured over {win.phrase}.
          </Empty>
        ) : (
          <>
            <DataTable
              caption={`Products with under 30 days of stock cover at the rate measured over ${win.phrase}`}
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
            <Caveat label="What days of cover assumes">
              Days of cover assumes the last {win.days} days repeat. It does not
              know about a drop you are planning, a festival week, or the fact
              that a piece only started selling three days ago — a product with
              one recent sale and one unit left reads as one day of cover, which
              is arithmetic, not a forecast.
            </Caveat>
          </>
        )}
      </Panel>

      {/* ---- Variant mix --------------------------------------------------- */}

      {optionMix.length === 0 ? (
        <Panel
          title="Size and colour mix"
          tip={METRIC.optionMix}
        >
          <Empty>
            No counted order line in this period recorded a chosen option.
          </Empty>
          <Caveat label="Why this can be empty">
            Sizes are read from each order line&apos;s own options snapshot. If
            this is empty while the catalogue offers sizes, the orders in this
            period predate the option being added to those products.
          </Caveat>
        </Panel>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {optionMix.map((dim) => (
            <Panel
              key={dim.key}
              title={`${dim.label} mix`}
              tip={METRIC.optionMix}
              note={`${formatCount(dim.units)} of ${formatCount(dim.units + dim.unitsWithout)} units sold in ${win.phrase} recorded a ${dim.label.toLowerCase()}.`}
            >
              <RankBars
                rows={dim.values.map((v) => ({
                  key: v.key,
                  label: v.label,
                  value: v.units,
                  valueLabel: `${v.units} unit${v.units === 1 ? "" : "s"}`,
                  sub: (
                    <>
                      {formatPercent(
                        dim.units > 0 ? Math.round((v.units / dim.units) * 1000) / 10 : null
                      )}{" "}
                      of this mix ·{" "}
                      <span className="tabular-nums">{formatINR(v.netRevenue)}</span> across{" "}
                      {v.products} product{v.products === 1 ? "" : "s"}
                    </>
                  ),
                }))}
              />
              {dim.unitsWithout > 0 && (
                <Caveat
                  label={`${formatCount(dim.unitsWithout)} unit${dim.unitsWithout === 1 ? "" : "s"} outside these percentages`}
                >
                  {formatCount(dim.unitsWithout)} unit
                  {dim.unitsWithout === 1 ? "" : "s"} sold in this period carried
                  no {dim.label.toLowerCase()} at all — a product that does not
                  offer it, or a line saved before it existed. Those units are
                  outside the percentages above, which is why the denominator is
                  stated rather than implied.
                </Caveat>
              )}
            </Panel>
          ))}

          {/*
            The panel a reader of a clothing dashboard goes looking for, and
            the reason it is empty. It sits beside Size rather than being
            omitted, because an absent panel reads as an oversight while a
            panel that explains itself reads as an answer — and the answer here
            is a real fact about this catalogue, not a missing feature.
          */}
          {optionMix.every((d) => d.key !== "colour" && d.key !== "color") && (
            <Panel
              title="Colour mix"
              tip="Colour would be split exactly like size, from each order line's own options snapshot — if colour were an option a shopper picks. On this catalogue it is not."
            >
              <Empty>
                There is no colour split, and there cannot be one.
              </Empty>
              <Caveat label="Why there cannot be one">
                Colour is part of the piece itself here, not a choice made at
                checkout — &ldquo;Bottle Green&rdquo; and &ldquo;Wine&rdquo; are
                different products rather than different options of one. A
                colour chart would therefore be the product ranking below under
                another name, which is worse than no chart: it would look like a
                second, independent measurement. Add a Colour option to a
                product and its own panel appears here automatically, beside
                Size.
              </Caveat>
            </Panel>
          )}
        </div>
      )}

      {/* ---- Rankings ----------------------------------------------------- */}

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel
          title="Top sellers by units"
          tip={METRIC.units}
          note="What moves. Bars share one zero-based scale."
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
          note="What pays. A different order from units whenever price varies across the catalogue."
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
        note={`Every product with at least one unit on a counted order in ${win.phrase}, highest revenue first.`}
      >
        {sold.length === 0 ? (
          <Empty>Nothing sold in this period.</Empty>
        ) : (
          <>
            <DataTable
              caption={`All products sold in ${win.phrase}, by net revenue`}
              columns={[
                { key: "name", label: "Product", align: "left" },
                { key: "bar", label: "", align: "left" },
                { key: "rev", label: "Net revenue", tip: METRIC.productRevenue },
                { key: "units", label: "Units", tip: METRIC.units },
                { key: "orders", label: "Orders", secondary: true },
                { key: "stock", label: "In stock", secondary: true },
                { key: "ret", label: "Returned", tip: METRIC.unitReturnRate, secondary: true },
                { key: "adds", label: "Cart adds", tip: METRIC.cartAdds, secondary: true },
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
                    {p.unitsReturned > 0 ? `${p.unitsReturned} (${formatPercent(p.returnRate)})` : "—"}
                  </Num>
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

      {/* ---- Returns by product -------------------------------------------- */}

      <Panel
        title="Coming back"
        tip={METRIC.unitReturnRate}
        note="Products with at least one return raised against an order placed in this period, worst rate first. On a clothing store a high return rate on one piece is usually a sizing problem, not a quality one — check it against the size mix above."
      >
        {returned.length === 0 ? (
          <Empty>
            Nothing sold in {win.phrase} has been returned.
          </Empty>
        ) : (
          <DataTable
            caption={`Products returned from orders placed in ${win.phrase}`}
            columns={[
              { key: "name", label: "Product", align: "left" },
              { key: "rate", label: "Return rate", tip: METRIC.unitReturnRate },
              { key: "ret", label: "Units back" },
              { key: "units", label: "Units sold", tip: METRIC.units },
            ]}
          >
            {returned.map((p) => (
              <tr key={p.key}>
                <ProductName product={p} />
                <Num strong>{formatPercent(p.returnRate)}</Num>
                <Num>{p.unitsReturned}</Num>
                <Num muted>{p.units}</Num>
              </tr>
            ))}
          </DataTable>
        )}
        <Caveat label="Why a short range reads low">
          Both numbers come from the same set of orders — those placed in this
          period — so the rate is a real fraction rather than two counts on two
          clocks. It is right-censored: a piece sold yesterday has had one day
          to come back, so a short range always reads low.
        </Caveat>
      </Panel>

      {/* ---- Slow movers ---------------------------------------------------- */}

      <Panel
        title="Slow movers"
        tip="Active catalogue pieces that sold nothing at all in this period. Ordered by the value of the stock tied up in them (stock × current price), because that is what the decision is actually about."
        note="Deleted and unlinked rows are left out — there is nothing left to act on."
      >
        {slow.length === 0 ? (
          <Empty>
            Every active product sold at least one unit in {win.phrase}.
          </Empty>
        ) : (
          <>
            <DataTable
              caption={`Active products with no sales in ${win.phrase}`}
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
            <Caveat label="What stock value is, and is not">
              Stock value is stock × the current selling price, which is what
              the shelf might fetch — not what it cost, because there is no cost
              price on a product. It ranks the list correctly and should not be
              read as money tied up.
            </Caveat>
          </>
        )}
      </Panel>

      {/* ---- Interest against orders ---------------------------------------- */}

      <Panel
        title="Interest against orders"
        tip="Three counts that all exist in the database, on one zero-based scale. They count different things — cart-add events, wishlist saves, and units on orders — so the gap between them is a difference in volume, not a measured drop-off."
        note={`Over ${win.phrase}.`}
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
        <Caveat label="This is not a funnel">
          <strong className="font-medium text-foreground">
            The ratio between these bars is not a conversion rate.
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

      <Panel
        title="Interest by product"
        tip={METRIC.cartAdds}
        note="Where interest and sales disagree. A piece with many cart adds and no sales was wanted and something stopped it; a piece with neither was never picked up at all."
        aside={<PanelLink href="/admin/leads">Interested customers</PanelLink>}
      >
        {interest.length === 0 ? (
          <Empty>No cart activity, wishlist saves or sales in this period.</Empty>
        ) : (
          <>
            <DataTable
              caption={`Products by cart-add events in ${win.phrase}, against units sold`}
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
              {interestRows.map((p) => (
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
              basePath="/admin/finance/products"
              params={pagerParams}
              param="ip"
              page={interestPage}
              total={interest.length}
              noun="products"
            />
            <Caveat label="How adds and saves are matched">
              Cart adds are matched to a product by its id, and wishlist saves by
              its slug — so a piece deleted since shows its sales but no wishlist
              figure, and both columns read &ldquo;—&rdquo; rather than zero when
              there is nothing to report. Interested customers has the
              individual leads behind these counts.
            </Caveat>
          </>
        )}
      </Panel>

      {/* ---- The honest blank ------------------------------------------------ */}

      <Panel
        title="What this section cannot tell you"
        tip="The absences that belong to the product view specifically. The full list is on Overview."
      >
        <NotMeasured rows={notMeasuredFor("products")} />
      </Panel>
    </div>
  );
}
