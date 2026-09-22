"use client";

/**
 * The /admin/products list.
 *
 * Split out of the page so it can hold a selection: the page stays a server
 * component that queries and filters, and hands this plain rows.
 *
 * Products was the largest list in the admin and the only one with **no**
 * multi-select at all — hiding nine pieces for a season meant nine trips
 * through a row menu. Selection is the shared primitive
 * (`admin/selection`), so it behaves exactly like Portfolio and Media:
 * click toggles, shift-click takes a range, and dragging down the checkbox
 * column sweeps.
 *
 * Two rules it inherits from that primitive, both of which matter here more
 * than anywhere else because this list can delete:
 *
 * 1. **The selection is intersected with what the filters are showing.**
 *    Narrowing a filter narrows what a bulk action can hit. Selecting thirty
 *    products, filtering to three and pressing Delete must not remove thirty.
 * 2. **The drag surface is the checkbox column, not the row.** Every row here
 *    carries four controls (hide, duplicate, edit, delete) plus a copyable id,
 *    and a `pointerdown` listener on the row fires for all of them.
 */

import { useMemo, useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ExternalLink, Eye, EyeOff, Star, Trash2 } from "lucide-react";
import { bulkProductAction, type ProductBulkAction } from "@/app/actions/admin";
import { ProductRowActions } from "@/components/admin/product-row-actions";
import { CopyableId } from "@/components/admin/copy-id";
import { MiniButton } from "@/components/admin/form-kit";
import {
  SelectCheckbox,
  SelectHandle,
  useMultiSelect,
} from "@/components/admin/selection";
import { formatINR } from "@/lib/utils";
import { cn } from "@/lib/utils";

/** Plain serialisable data — nothing but strings, numbers and booleans. */
export type ProductRow = {
  id: string;
  name: string;
  /** Storefront slug, for the "view live" link. */
  slug: string;
  image: string | null;
  category: string;
  subcategoryName: string | null;
  price: number;
  stock: number;
  isActive: boolean;
  isFeatured: boolean;
};

export function ProductsTable({ rows }: { rows: ProductRow[] }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);

  const visibleIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const selection = useMultiSelect(visibleIds);

  function runBulk(action: ProductBulkAction, label: string) {
    const ids = selection.ids;
    if (ids.length === 0) return;

    if (
      action === "delete" &&
      !confirm(
        `Delete ${ids.length} product${ids.length === 1 ? "" : "s"}?\n\n` +
          "This can't be undone. Anything referenced by an order or a review is kept."
      )
    ) {
      return;
    }

    setPendingLabel(label);
    startTransition(async () => {
      const res = await bulkProductAction(ids, action);
      setPendingLabel(null);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      // A partial delete is a success with a caveat, not a failure — the rows
      // that went are gone and saying "couldn't delete" about all of them
      // would be wrong.
      if (res.error) toast.warning(`${res.count} deleted. ${res.error}`);
      else toast.success(`${res.count} updated`);
      selection.clear();
      router.refresh();
    });
  }

  return (
    <div className="mt-6 space-y-3">
      {selection.count > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-accent/5 p-2">
          <p className="text-xs font-medium">
            {selection.count} of {selection.visibleCount} product
            {selection.visibleCount === 1 ? "" : "s"} selected
          </p>
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            <MiniButton onClick={() => runBulk("activate", "show")} disabled={busy}>
              <Eye className="h-3.5 w-3.5" /> Show
            </MiniButton>
            <MiniButton onClick={() => runBulk("deactivate", "hide")} disabled={busy}>
              <EyeOff className="h-3.5 w-3.5" /> Hide
            </MiniButton>
            <MiniButton onClick={() => runBulk("feature", "feature")} disabled={busy}>
              <Star className="h-3.5 w-3.5" /> Feature
            </MiniButton>
            <MiniButton onClick={() => runBulk("unfeature", "unfeature")} disabled={busy}>
              Unfeature
            </MiniButton>
            <MiniButton
              onClick={() => runBulk("delete", "delete")}
              disabled={busy}
              className="border-danger/40! text-danger hover:bg-danger/10"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </MiniButton>
            <button
              type="button"
              onClick={selection.clear}
              className="min-h-11 cursor-pointer rounded-lg px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground sm:min-h-9"
            >
              Clear
            </button>
          </div>
          {pendingLabel && (
            <p className="w-full text-[11px] text-muted-foreground">
              Applying “{pendingLabel}” to {selection.count}…
            </p>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                <th className="w-11 px-1 py-3">
                  <SelectCheckbox
                    checked={selection.allVisibleSelected}
                    indeterminate={selection.someVisibleSelected}
                    onChange={selection.toggleAll}
                    label={
                      selection.allVisibleSelected
                        ? "Clear selection"
                        : "Select every product shown"
                    }
                  />
                </th>
                <th className="px-4 py-3 font-medium">Product</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Subcategory</th>
                <th className="px-4 py-3 font-medium">Price</th>
                <th className="px-4 py-3 font-medium">Stock</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((p) => {
                const isSelected = selection.isSelected(p.id);
                return (
                  <tr
                    key={p.id}
                    className={cn(
                      "transition-colors",
                      isSelected ? "bg-accent/5" : "hover:bg-muted/40"
                    )}
                  >
                    <td className="px-1 py-3">
                      <SelectHandle
                        selection={selection}
                        id={p.id}
                        label={`Select ${p.name}`}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-muted">
                          {p.image && (
                            <Image
                              src={p.image}
                              alt={p.name}
                              fill
                              sizes="44px"
                              className="object-cover"
                            />
                          )}
                        </div>
                        <div className="min-w-0">
                          <Link
                            href={`/admin/products/${p.id}/edit`}
                            className="block truncate font-medium underline-offset-2 hover:underline"
                          >
                            {p.name}
                          </Link>
                          {p.isFeatured && (
                            <span className="block text-[11px] gold-text">★ Featured</span>
                          )}
                          {/* Same ID shown on order line items, so one copied
                              off an order can be matched back to here. */}
                          <span className="mt-1 block">
                            <CopyableId id={p.id} />
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{p.category}</td>
                    <td className="px-4 py-3">
                      {p.subcategoryName ? (
                        <span className="rounded-full bg-accent/10 px-2.5 py-1 text-xs text-foreground">
                          {p.subcategoryName}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">{formatINR(p.price)}</td>
                    <td className="px-4 py-3">
                      <span className={p.stock <= 0 ? "text-danger" : ""}>{p.stock}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "rounded-full px-2.5 py-1 text-xs",
                          p.isActive
                            ? "bg-success/15 text-success"
                            : "bg-muted text-muted-foreground"
                        )}
                      >
                        {p.isActive ? "Active" : "Hidden"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {/* View on the storefront. A hidden product has no live
                            page (the route calls notFound() on !isActive), so
                            there is nothing to link to — the slot is held open
                            rather than linked, which keeps the four icons in
                            the same column on every row. */}
                        {p.isActive ? (
                          <a
                            href={`/product/${p.slug}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={`View ${p.name} on the storefront`}
                            aria-label={`View ${p.name} on the storefront — opens in a new tab`}
                            className="grid h-9 w-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        ) : (
                          <span
                            className="grid h-9 w-9 place-items-center text-muted-foreground/30"
                            title="Hidden from the shop — no live page"
                            aria-hidden
                          >
                            <ExternalLink className="h-4 w-4" />
                          </span>
                        )}
                        <ProductRowActions id={p.id} isActive={p.isActive} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="px-1 text-[11px] text-muted-foreground">
        Shift-click takes a range, and you can drag down the tick boxes to sweep.
        A bulk action only ever reaches the products these filters are showing.
      </p>
    </div>
  );
}
