/**
 * The oversold banner.
 *
 * Oversold — `available < 0` — is the one stock state that needs a person:
 * orders have been placed for units the shelf does not have, and at least one
 * customer will not get their parcel unless someone acts. So it is not a badge
 * on row forty; it is the first thing on the screen, in the one solid red the
 * section uses, and it names the orders holding the units so the next step is
 * a click, not a search.
 *
 * Rendered by the server (no directive, no hooks). The advice on what to do is
 * behind the (i): it is the same on every visit, and the list is what changes.
 */

import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { InfoTip } from "@/components/store/info-tip";
import { formatUnits, inventoryHref } from "@/components/admin/inventory-ui";

export type OversoldItem = {
  variantId: string;
  productId: string;
  productName: string;
  label: string;
  sku: string;
  onHand: number;
  reserved: number;
  holders: { orderNumber: string | null; qty: number }[];
};

/** How many rows the banner lists before it hands over to the filtered list. */
const LISTED = 5;

const link =
  "underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm";

export function OversoldBanner({
  items,
  showAllHref,
  showProduct = true,
}: {
  items: OversoldItem[];
  /** Where "show all" goes when there are more than the banner lists. */
  showAllHref?: string;
  /** Off on a product's own page, where every row is that product. */
  showProduct?: boolean;
}) {
  if (items.length === 0) return null;
  const listed = items.slice(0, LISTED);
  const more = items.length - listed.length;
  const n = items.length;

  return (
    <section
      aria-labelledby="oversold-heading"
      className="min-w-0 rounded-2xl border-2 border-danger bg-danger/5 p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2
          id="oversold-heading"
          className="flex min-w-0 items-start gap-1.5 text-sm font-semibold leading-snug text-danger"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0">
            {n === 1 ? "1 size is oversold" : `${n} sizes are oversold`} — open orders need more
            than is on the shelf
          </span>
          <InfoTip term="Oversold">
            Orders have been placed for more units than the store holds, so at least one of them
            cannot be filled from the shelf. Usually stock arrived and has not been recorded yet
            (record a stock in), the count is off (record a recount), or units were written off
            after these orders came in. If none of those, contact the customers below before their
            parcel is due — cancelling an order gives its units back.
          </InfoTip>
        </h2>
        {more > 0 && showAllHref && (
          <Link
            href={showAllHref}
            className="inline-flex min-h-11 items-center rounded-lg border border-danger px-3 text-[11px] font-medium uppercase tracking-wider text-danger transition-colors hover:bg-danger/10 sm:min-h-9"
          >
            Show all {n}
          </Link>
        )}
      </div>

      <ul className="mt-3 space-y-2">
        {listed.map((i) => {
          const short = i.reserved - i.onHand;
          return (
            <li key={i.variantId} className="min-w-0 text-sm leading-relaxed">
              <Link href={inventoryHref.product(i.productId)} className="font-medium underline-offset-2 hover:underline">
                {showProduct ? `${i.productName} · ${i.label}` : i.label}
              </Link>{" "}
              <span className="font-mono text-[11px] text-muted-foreground">{i.sku}</span>
              <span className="block text-xs text-muted-foreground">
                {formatUnits(i.onHand)} on hand, {formatUnits(i.reserved)} promised —{" "}
                <strong className="font-semibold text-danger">short by {formatUnits(short)}</strong>
                {i.holders.length > 0 && (
                  <>
                    {" "}
                    · held for{" "}
                    {i.holders.map((h, k) => (
                      <span key={k}>
                        {k > 0 && ", "}
                        {h.orderNumber ? (
                          <Link href={inventoryHref.order(h.orderNumber)} className={link}>
                            {h.orderNumber}
                          </Link>
                        ) : (
                          "a removed order"
                        )}
                        {h.qty > 1 && ` ×${h.qty}`}
                      </span>
                    ))}
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
