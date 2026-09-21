/**
 * finance-table — the multi-column tables on the Products and Demand tabs.
 *
 * A bar list (`RankBars`) carries one measure well and two badly. Where the
 * reader has to weigh units *against* revenue *against* stock, the honest form
 * is a table, and the data-viz rule that applies is the one about more than
 * ~7 classes: past that, a table beats another chart.
 *
 * Mobile: every table sits in `TableScroll`, which scrolls inside its own box
 * with `overscroll-x-contain` so the page itself never moves sideways at
 * 320px and the browser's back gesture is not hijacked. The first column is
 * the row header and is allowed to wrap; the numeric columns are
 * `tabular-nums` and never wrap, because a column of figures only reads as a
 * column when the digits line up.
 */

import Link from "next/link";
import { AlertTriangle, ExternalLink, Unlink } from "lucide-react";
import { Badge } from "@/components/admin/order-ui";
import { TableScroll } from "@/components/admin/form-kit";
import { InfoTip } from "@/components/store/info-tip";
import { cn } from "@/lib/utils";
import type { ProductDemand } from "@/lib/analytics";

/* ------------------------------------------------------------------ */
/*  Shell                                                              */
/* ------------------------------------------------------------------ */

export type Column = {
  key: string;
  label: string;
  /** Right-aligned for numbers, left for text. Numbers default to right. */
  align?: "left" | "right";
  /** Definition behind an (i) in the header — the metric, not a hint. */
  tip?: React.ReactNode;
  /** Hidden below `sm`: the column is useful, not essential, on a phone. */
  secondary?: boolean;
};

export function DataTable({
  columns,
  caption,
  children,
}: {
  columns: Column[];
  /** Screen-reader caption naming what the table lists and over what period. */
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <TableScroll>
      <table className="w-full min-w-[34rem] text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-muted/40">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn(
                  "whitespace-nowrap px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground",
                  c.align === "left" ? "text-left" : "text-right",
                  c.secondary && "hidden sm:table-cell"
                )}
              >
                <span
                  className={cn(
                    "inline-flex items-center gap-0.5",
                    c.align !== "left" && "flex-row-reverse"
                  )}
                >
                  {c.label}
                  {c.tip && <InfoTip term={c.label}>{c.tip}</InfoTip>}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </TableScroll>
  );
}

/** A numeric cell. Always `tabular-nums`, always non-wrapping. */
export function Num({
  children,
  muted,
  secondary,
  strong,
}: {
  children: React.ReactNode;
  muted?: boolean;
  secondary?: boolean;
  strong?: boolean;
}) {
  return (
    <td
      className={cn(
        "whitespace-nowrap px-3 py-2 text-right tabular-nums",
        muted && "text-muted-foreground",
        strong && "font-medium",
        secondary && "hidden sm:table-cell"
      )}
    >
      {children}
    </td>
  );
}

/* ------------------------------------------------------------------ */
/*  Product name cell                                                  */
/* ------------------------------------------------------------------ */

/**
 * The name cell, and the one place the snapshot-versus-catalogue problem is
 * resolved on screen.
 *
 * `Order.items` records the product's name **by value** at the moment of
 * purchase, so three things can be true of a row and the reader has to be able
 * to tell which:
 *
 * - **In the catalogue** — the line's productId still resolves. The current
 *   name is shown and links to the editor. If the piece was renamed since, the
 *   old name is noted rather than shown as a separate product, because two
 *   rows for one thing is the failure this is guarding against.
 * - **Deleted** — the productId no longer exists. The snapshot name is all
 *   there is; it is badged so nobody goes looking for it in Products, and the
 *   sales stay counted, because the money was real.
 * - **Unlinked** — the line carried no productId at all (a legacy or
 *   hand-entered row). Grouped by name, which means a rename would split it,
 *   so it is badged too rather than quietly trusted.
 */
export function ProductName({ product }: { product: ProductDemand }) {
  const renamed =
    product.resolved === "catalogue" &&
    product.snapshotNames.some((n) => n !== product.name);

  return (
    <th scope="row" className="min-w-0 px-3 py-2 text-left font-normal">
      <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {product.productId && product.resolved === "catalogue" ? (
          <Link
            href={`/admin/products/${product.productId}/edit`}
            className="group inline-flex min-w-0 items-center gap-1 hover:text-accent"
          >
            <span className="min-w-0 break-words">{product.name}</span>
            <ExternalLink
              className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-60"
              aria-hidden="true"
            />
          </Link>
        ) : (
          <span className="min-w-0 break-words">{product.name}</span>
        )}

        {product.resolved === "deleted" && (
          <Badge tone="danger" title="This product has been deleted from the catalogue. Its past sales are still counted.">
            <AlertTriangle className="h-2.5 w-2.5" aria-hidden="true" /> Deleted
          </Badge>
        )}
        {product.resolved === "unlinked" && (
          <Badge tone="warn" title="These order lines carried no product id, so they are grouped by name.">
            <Unlink className="h-2.5 w-2.5" aria-hidden="true" /> Unlinked
          </Badge>
        )}
        {product.isActive === false && product.resolved === "catalogue" && (
          <Badge tone="neutral" title="Hidden from the storefront.">Inactive</Badge>
        )}
      </span>

      {renamed && (
        <span className="mt-0.5 block text-xs text-muted-foreground">
          Sold as {product.snapshotNames.filter((n) => n !== product.name).join(", ")}
        </span>
      )}
    </th>
  );
}

/* ------------------------------------------------------------------ */
/*  Stock cell                                                         */
/* ------------------------------------------------------------------ */

/**
 * Stock, with the one piece of colour on these tables.
 *
 * Zero stock on a piece that is still selling is the only genuinely
 * good/bad state in this dashboard, so it wears a status tone — and, per the
 * rule that status is never colour alone, it also says the word.
 */
export function StockCell({ product, secondary }: { product: ProductDemand; secondary?: boolean }) {
  if (product.stock === null) {
    return (
      <Num muted secondary={secondary}>
        —
      </Num>
    );
  }
  const out = product.stock <= 0;
  const low = !out && product.daysOfCover !== null && product.daysOfCover < 14;
  return (
    <td
      className={cn(
        "whitespace-nowrap px-3 py-2 text-right tabular-nums",
        secondary && "hidden sm:table-cell",
        out ? "text-danger" : low ? "text-foreground" : "text-muted-foreground"
      )}
    >
      {out ? (
        <span className="inline-flex items-center gap-1">
          <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
          None
        </span>
      ) : (
        product.stock
      )}
    </td>
  );
}

/* ------------------------------------------------------------------ */
/*  In-cell bar                                                        */
/* ------------------------------------------------------------------ */

/**
 * A bar inside a table row, sharing one zero-based scale with every other row
 * in the column. Purely a reading aid for the number beside it, so it is
 * hidden from assistive tech and from narrow screens, where the figure alone
 * is the better use of the width.
 */
export function BarCell({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <td className="hidden w-24 px-3 py-2 md:table-cell" aria-hidden="true">
      <span className="block h-1.5 w-full rounded-sm bg-muted">
        {value > 0 && (
          <span
            className="block h-1.5 rounded-r-[4px] bg-accent"
            style={{ width: `max(2px, ${pct}%)` }}
          />
        )}
      </span>
    </td>
  );
}
