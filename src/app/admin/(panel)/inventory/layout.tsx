import { InfoTip } from "@/components/store/info-tip";
import { InventoryNav } from "@/components/admin/inventory-nav";

export const dynamic = "force-dynamic";

/**
 * Admin → Inventory.
 *
 * The heading and the Stock / Ledger switch are a **layout**, so moving
 * between the two views — or into one product and back — re-renders only the
 * view underneath and leaves the switch where it was.
 *
 * The (i) carries the model once, for the whole section: what on hand,
 * reserved and available mean, and which entries write themselves. It is the
 * explanation every screen here assumes, and printing it on each would be the
 * same paragraph three times.
 */
export default function InventoryLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-1.5 font-serif text-2xl">
          Inventory
          <InfoTip term="Inventory">
            Stock is counted per size. On hand is what is in the store. Reserved is promised to
            orders that have not shipped yet. Available is on hand minus reserved — what the shop
            can still sell. Orders reserve units when they are placed and take them off the shelf
            when they ship; a cancellation gives them back, and returns and failed deliveries put
            them back on the shelf. You record the rest: stock in, damaged, personal use and
            recounts. Every change is one line in the ledger, and nothing in it is ever edited or
            deleted — a mistake is corrected by a further entry.
          </InfoTip>
        </h1>
        <InventoryNav />
      </div>
      {children}
    </div>
  );
}
