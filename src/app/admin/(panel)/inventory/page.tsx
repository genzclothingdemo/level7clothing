import { inventoryValuation } from "@/lib/inventory";
import { formatINR } from "@/lib/utils";
import { InfoTip } from "@/components/store/info-tip";
import { StatTile, TileGrid } from "@/components/admin/finance-ui";
import { InventoryStockTable } from "@/components/admin/inventory-stock-table";
import { OversoldBanner, type OversoldItem } from "@/components/admin/inventory-oversold";
import { formatUnits, inventoryHref, isStockFilter } from "@/components/admin/inventory-ui";
import { loadStockCatalogue, reservationHolders } from "./_lib/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inventory" };

/**
 * Admin → Inventory → Stock.
 *
 * Read in this order, which is the order the page is built in:
 *
 * 1. **Is anything wrong?** Oversold sizes, named, with the orders holding
 *    them. Absent when nothing is — a banner that is always there stops being
 *    read.
 * 2. **How much is there?** Four figures: on hand, reserved, available, and
 *    what it is worth at cost — with units that have no cost price counted
 *    separately, never valued at zero.
 * 3. **Where is it?** Every product, its sizes as chips, what needs a person
 *    first.
 *
 * Before anything is tracked, (2) would be four zeros that look like an empty
 * warehouse. It is replaced by the one thing to do next — start a stocktake —
 * rather than a row of numbers that mean nothing yet.
 */
export default async function InventoryStockPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; show?: string | string[] }>;
}) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const show = isStockFilter(sp.show) ? sp.show : "all";

  const [{ products }, valuation] = await Promise.all([loadStockCatalogue(), inventoryValuation()]);

  const tracked = products.filter((p) => p.tracked);

  const oversoldSizes = tracked.flatMap((p) =>
    p.variants.filter((v) => v.state === "oversold").map((v) => ({ p, v }))
  );
  const holders = await reservationHolders(oversoldSizes.map((o) => o.v.id));
  const oversold: OversoldItem[] = oversoldSizes.map(({ p, v }) => ({
    variantId: v.id,
    productId: p.id,
    productName: p.name,
    label: v.label,
    sku: v.sku,
    onHand: v.onHand,
    reserved: v.reserved,
    holders: holders.get(v.id) ?? [],
  }));

  const reserved = tracked.reduce((n, p) => n + p.reserved, 0);
  const available = tracked.reduce((n, p) => n + p.available, 0);

  return (
    <div className="min-w-0 space-y-4">
      <OversoldBanner items={oversold} showAllHref={inventoryHref.stock("oversold")} />

      {tracked.length === 0 ? (
        <section className="min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-5">
          <p className="eyebrow">First step</p>
          <h2 className="mt-2 flex items-center gap-1 font-serif text-lg leading-snug">
            No product is tracked yet
            <InfoTip term="Start tracking">
              Right now every product sells from one number for all of its sizes, so the shop
              cannot tell a medium from an XL, and a size that has run out can still be bought.
              Tracking a product starts with a count of each size — the old number cannot be split
              honestly. From then on orders, returns and your own entries keep every size&apos;s
              count, checkout refuses a size that has run out, and each change is a line in the
              ledger. Start with one product; the rest can follow at your own pace.
            </InfoTip>
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Pick a product below and count each size to start.
          </p>
        </section>
      ) : (
        <TileGrid>
          <StatTile
            label="On hand"
            value={formatUnits(valuation.units)}
            good="none"
            tip="Units physically in the store, for every product you track. Products that are not tracked yet are left out — one number for all sizes cannot say what is on the shelf."
            sub={`${tracked.length} of ${products.length} products tracked`}
          />
          <StatTile
            label="Reserved"
            value={formatUnits(reserved)}
            good="none"
            tip="Units promised to orders that have been placed but not shipped. They are still on the shelf, and the shop will not sell them again. They come off the shelf when the order ships, or free up if it is cancelled."
          />
          <StatTile
            label="Available"
            value={formatUnits(available)}
            good="none"
            tip="What the shop can still sell: on hand minus reserved, size by size. An oversold size counts as zero here rather than as a negative, so it cannot hide another size's stock."
          />
          <StatTile
            label="Value at cost"
            value={valuation.valuedUnits > 0 ? formatINR(valuation.value) : "—"}
            good="none"
            tip="What the units on hand cost the store, using each size's cost price, or the product's when a size has none. Units with no cost price anywhere are counted but not valued, so an unknown cost never reads as zero."
            note="Cost prices are set in the product editor. The unit cost typed on a stock-in stays on that entry, as a record of what was paid for that delivery."
            sub={
              valuation.unvaluedUnits > 0
                ? valuation.unvaluedUnits === 1
                  ? "1 unit has no cost price"
                  : `${formatUnits(valuation.unvaluedUnits)} units have no cost price`
                : valuation.units > 0
                  ? "Every unit valued"
                  : undefined
            }
          />
        </TileGrid>
      )}

      <InventoryStockTable products={products} initialQuery={q} initialShow={show} />
    </div>
  );
}
