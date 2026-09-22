"use client";

/**
 * The /admin/portfolio list: select, reorder, toggle, delete.
 *
 * Four decisions worth keeping:
 *
 * 1. **One responsive row list, not a phone view plus a table.** Most admin
 *    lists here duplicate their markup (`md:hidden` cards + `hidden md:block`
 *    table) because their columns are text. These rows are photo-led, so a
 *    single flex row reads correctly from 320px up and there is no second
 *    copy to forget when a column is added.
 *
 * 2. **Selection is the shared primitive** (`admin/selection`), not a local
 *    copy. That is where the rule lives that select-all only ever covers the
 *    rows on screen and the selection is intersected with them — so narrowing
 *    the filter narrows what a bulk action hits, instead of silently acting on
 *    rows the admin can no longer see. Adopting it also gave this list
 *    shift-click ranges and a drag sweep down the checkbox column, neither of
 *    which the hand-rolled version had.
 *
 * 3. **Reorder is up/down buttons and is disabled while filtered.** No drag:
 *    the owner does this on a phone and HTML5 drag events don't fire on
 *    touch (see `reason-list-editor.tsx`). And positions are only meaningful
 *    against the whole list — renumbering a filtered subset would shuffle it
 *    against rows that aren't visible, which is a change nobody asked for and
 *    nobody can see.
 *
 * 4. **Pending order is derived, never copied in an effect.** The local order
 *    is reconciled against the server's rows during render, so a
 *    `router.refresh()` can't strand a stale array and there is no
 *    `set-state-in-effect` to add to the pile CLAUDE.md already notes.
 */

import { useMemo, useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  ImageOff,
  Pencil,
  Star,
  Trash2,
} from "lucide-react";
import { CountBadge, MiniButton, Toolbar } from "@/components/admin/form-kit";
import {
  SelectCheckbox,
  SelectHandle,
  useMultiSelect,
} from "@/components/admin/selection";
import {
  bulkPortfolioAction,
  deletePortfolioItem,
  reorderPortfolio,
  setPortfolioFlag,
  type PortfolioBulkAction,
} from "@/app/actions/portfolio";
import type { PortfolioKind } from "@/lib/portfolio";
import { cn } from "@/lib/utils";

/** Plain serialisable data — nothing but strings, numbers and booleans cross
 *  the server/client boundary. */
export type PortfolioRow = {
  id: string;
  kind: PortfolioKind;
  title: string;
  url: string | null;
  thumbnail: string | null;
  /** Decided on the server: `next/image` can only serve allow-listed hosts. */
  thumbnailOptimisable: boolean;
  /** Which shelf on /portfolio, resolved by `sectionOf` on the server. */
  section: string;
  /** That shelf's label, resolved server-side — `lib/portfolio` imports Prisma. */
  sectionLabel: string;
  productName: string | null;
  productSlug: string | null;
  /** Set when `productId` points at a product that no longer exists. */
  danglingProduct: boolean;
  tags: string[];
  sortOrder: number;
  isFeatured: boolean;
  isActive: boolean;
};

const KIND_LABEL: Record<PortfolioKind, string> = {
  instagram: "Instagram",
  link: "Link",
  image: "Image",
  video: "Video",
};

const ICON_BTN =
  "grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-lg text-muted-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-40 sm:h-9 sm:w-9";

export function PortfolioTable({
  rows,
  canReorder,
  filtered,
}: {
  rows: PortfolioRow[];
  /** False while a filter is on — positions only mean something list-wide. */
  canReorder: boolean;
  /** True when the list is narrowed, so the empty state can say so. */
  filtered: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  /** Local order while unsaved. `null` means "whatever the server sent". */
  const [draftOrder, setDraftOrder] = useState<string[] | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);

  const serverIds = useMemo(() => rows.map((r) => r.id), [rows]);

  /**
   * Reconcile the draft against the server's rows *during render*: keep the
   * dragged-to positions for rows that still exist, and put anything new at
   * the end. No effect, so a refresh can never leave a stale array behind.
   */
  const orderedRows = useMemo(() => {
    if (!draftOrder) return rows;
    const byId = new Map(rows.map((r) => [r.id, r]));
    const kept = draftOrder.filter((id) => byId.has(id));
    const added = serverIds.filter((id) => !kept.includes(id));
    return [...kept, ...added].map((id) => byId.get(id)!).filter(Boolean);
  }, [draftOrder, rows, serverIds]);

  const visibleIds = useMemo(() => orderedRows.map((r) => r.id), [orderedRows]);

  /**
   * Selection comes from the shared primitive now (`admin/selection`), which
   * is where the intersect-with-visible rule of note 2 lives — along with
   * shift-range and the drag sweep this list used to lack. The hand-rolled
   * version here was one of the four near-identical copies it replaced.
   */
  const selection = useMultiSelect(visibleIds);
  const selectedIds = selection.ids;
  const dirtyOrder = draftOrder !== null;

  /* ---------------- reorder ---------------- */

  function move(index: number, delta: number) {
    const to = index + delta;
    if (to < 0 || to >= orderedRows.length) return;
    const next = orderedRows.map((r) => r.id);
    [next[index], next[to]] = [next[to], next[index]];
    setDraftOrder(next);
  }

  async function saveOrder() {
    if (!draftOrder) return;
    setSavingOrder(true);
    const res = await reorderPortfolio(orderedRows.map((r) => r.id));
    setSavingOrder(false);
    if (res.success) {
      setDraftOrder(null);
      toast.success("Order saved");
      router.refresh();
    } else {
      toast.error(res.error ?? "Couldn't save the order.");
    }
  }

  /* ---------------- row actions ---------------- */

  function toggleFlag(row: PortfolioRow, field: "isActive" | "isFeatured") {
    const next = field === "isActive" ? !row.isActive : !row.isFeatured;
    startTransition(async () => {
      const res = await setPortfolioFlag(row.id, field, next);
      if (res.success) {
        toast.success(
          field === "isActive"
            ? next
              ? "Showing on the site"
              : "Hidden from the site"
            : next
              ? "Featured"
              : "No longer featured"
        );
        router.refresh();
      } else {
        toast.error(res.error ?? "Couldn't update this piece.");
      }
    });
  }

  async function removeOne(row: PortfolioRow) {
    if (!confirm(`Delete "${row.title}"?\n\nThis can't be undone.`)) return;
    const res = await deletePortfolioItem(row.id);
    if (res.success) {
      toast.success("Deleted");
      router.refresh();
    } else {
      toast.error(res.error ?? "Couldn't delete this piece.");
    }
  }

  /* ---------------- bulk ---------------- */

  async function runBulk(action: PortfolioBulkAction) {
    if (selectedIds.length === 0) return;
    if (
      action === "delete" &&
      !confirm(
        `Delete ${selectedIds.length} piece${selectedIds.length === 1 ? "" : "s"}?\n\n` +
          "This can't be undone."
      )
    ) {
      return;
    }

    const res = await bulkPortfolioAction(selectedIds, action);
    if (res.success) {
      toast.success(`${res.count ?? selectedIds.length} updated`);
      selection.clear();
      router.refresh();
    } else {
      toast.error(res.error ?? "Couldn't apply that to the selection.");
    }
  }

  /* ---------------- render ---------------- */

  if (orderedRows.length === 0) {
    return (
      <div className="mt-6 rounded-2xl border border-dashed border-border p-10 text-center sm:p-12">
        <ImageOff className="mx-auto h-10 w-10 text-muted-foreground" />
        <p className="mt-4 font-serif text-xl">
          {filtered ? "Nothing matches those filters" : "No portfolio pieces yet"}
        </p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
          {filtered
            ? "Clear a filter to see the rest of the list."
            : "Add a reel, a milestone, a customer’s words, a collaboration or a bulk-order job. Pick its section on the piece, or let the tags decide."}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-6 min-w-0 space-y-3">
      {/* ---- Toolbar: select-all, bulk actions, save order ---- */}
      <Toolbar>
        <SelectCheckbox
          checked={selection.allVisibleSelected}
          indeterminate={selection.someVisibleSelected}
          onChange={selection.toggleAll}
          label={
            selection.allVisibleSelected
              ? "Clear selection"
              : "Select every piece shown"
          }
        />
        <span className="text-xs text-muted-foreground">
          {selectedIds.length > 0 ? (
            <>
              {selectedIds.length} of {visibleIds.length} selected
            </>
          ) : (
            <>
              {visibleIds.length} piece{visibleIds.length === 1 ? "" : "s"}
              {filtered ? " shown" : ""}
            </>
          )}
        </span>

        {selectedIds.length > 0 && (
          <span className="ml-auto flex flex-wrap items-center gap-2">
            <MiniButton onClick={() => runBulk("activate")}>
              <Eye className="h-3.5 w-3.5" /> Show
            </MiniButton>
            <MiniButton onClick={() => runBulk("deactivate")}>
              <EyeOff className="h-3.5 w-3.5" /> Hide
            </MiniButton>
            <MiniButton onClick={() => runBulk("feature")}>
              <Star className="h-3.5 w-3.5" /> Feature
            </MiniButton>
            <MiniButton onClick={() => runBulk("unfeature")}>Unfeature</MiniButton>
            <MiniButton
              onClick={() => runBulk("delete")}
              className="border-danger/40! text-danger hover:bg-danger/10"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </MiniButton>
            <MiniButton onClick={selection.clear}>Clear</MiniButton>
          </span>
        )}
      </Toolbar>

      {dirtyOrder && (
        <Toolbar className="border-accent! bg-accent/10">
          <span className="text-xs">Order changed but not saved.</span>
          <span className="ml-auto flex items-center gap-2">
            <MiniButton onClick={() => setDraftOrder(null)} disabled={savingOrder}>
              Undo
            </MiniButton>
            <MiniButton
              onClick={saveOrder}
              disabled={savingOrder}
              active
            >
              {savingOrder ? "Saving…" : "Save order"}
            </MiniButton>
          </span>
        </Toolbar>
      )}

      {!canReorder && (
        <p className="px-1 text-xs text-muted-foreground">
          Clear the filters to change the order — positions only mean something
          against the whole list.
        </p>
      )}

      {/* ---- Rows ---- */}
      <ul className="min-w-0 space-y-2">
        {orderedRows.map((row, i) => {
          const isSelected = selection.isSelected(row.id);
          return (
            <li
              key={row.id}
              /*
               * Wraps on phones: the controls drop to their own full-width
               * row rather than squeezing the title into nothing. Six 44px
               * buttons are 264px, which still fits inside a 320px screen's
               * content box, so nothing is ever pushed off the edge.
               */
              className={cn(
                "flex min-w-0 flex-wrap items-start gap-2 rounded-2xl border bg-card p-2 sm:flex-nowrap sm:items-center sm:gap-3 sm:p-3",
                isSelected ? "border-accent!" : "border-border",
                !row.isActive && "opacity-60"
              )}
            >
              {/* The handle is the drag surface, not the whole row — this row
                  carries six controls, and a press on Delete must not sweep. */}
              <SelectHandle
                selection={selection}
                id={row.id}
                label={`Select ${row.title}`}
              />

              {/* Admin thumbs stay square — CLAUDE.md. */}
              <span className="relative grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted sm:h-16 sm:w-16">
                {row.thumbnail ? (
                  row.thumbnailOptimisable ? (
                    <Image
                      src={decodeURI(row.thumbnail)}
                      alt=""
                      fill
                      sizes="64px"
                      className="object-cover"
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element -- host
                    // isn't in next.config.ts remotePatterns; the optimiser 400s.
                    <img
                      src={row.thumbnail}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  )
                ) : (
                  <ImageOff className="h-5 w-5 text-muted-foreground" aria-hidden />
                )}
              </span>

              <div className="min-w-0 flex-1 basis-32">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="min-w-0 break-words font-medium">{row.title}</span>
                  {row.isFeatured && <CountBadge>★</CountBadge>}
                  {!row.isActive && (
                    <span className="rounded-full border border-border px-1.5 text-[10px] uppercase tracking-widest text-muted-foreground">
                      Hidden
                    </span>
                  )}
                </p>

                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  {/* The shelf is the first thing to know about a piece now —
                      it is what the storefront groups on. */}
                  <span className="text-accent">{row.sectionLabel}</span>
                  <span aria-hidden>·</span>
                  <span>{KIND_LABEL[row.kind]}</span>
                  <span aria-hidden>·</span>
                  <span className="tabular-nums">#{row.sortOrder}</span>
                  {row.productSlug && (
                    <>
                      <span aria-hidden>·</span>
                      <Link
                        href={`/product/${row.productSlug}`}
                        target="_blank"
                        className="truncate text-accent hover:underline"
                      >
                        {row.productName}
                      </Link>
                    </>
                  )}
                  {row.danglingProduct && (
                    <>
                      <span aria-hidden>·</span>
                      <span className="text-danger">
                        linked product is gone or hidden
                      </span>
                    </>
                  )}
                </p>

                {row.url && (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground/70">
                    {row.url}
                  </p>
                )}
              </div>

              {/* ---- Reorder + row actions ----
                   One strip, all on the 44px tap-target floor. It takes the
                   whole width on a phone (the `<li>` wraps) and sits inline
                   from `sm` up. */}
              <span className="flex w-full shrink-0 flex-wrap items-center justify-end gap-0.5 sm:w-auto">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={!canReorder || i === 0}
                  aria-label={`Move ${row.title} up`}
                  title={canReorder ? "Move up" : "Clear filters to reorder"}
                  className={cn(ICON_BTN, "hover:bg-muted hover:text-foreground")}
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={!canReorder || i === orderedRows.length - 1}
                  aria-label={`Move ${row.title} down`}
                  title={canReorder ? "Move down" : "Clear filters to reorder"}
                  className={cn(ICON_BTN, "hover:bg-muted hover:text-foreground")}
                >
                  <ArrowDown className="h-4 w-4" />
                </button>

                <button
                  type="button"
                  onClick={() => toggleFlag(row, "isFeatured")}
                  disabled={pending}
                  aria-label={
                    row.isFeatured ? `Unfeature ${row.title}` : `Feature ${row.title}`
                  }
                  title={row.isFeatured ? "Featured" : "Feature this"}
                  className={cn(
                    ICON_BTN,
                    row.isFeatured
                      ? "text-accent hover:bg-accent/10"
                      : "hover:bg-muted hover:text-foreground"
                  )}
                >
                  <Star
                    className="h-4 w-4"
                    fill={row.isFeatured ? "currentColor" : "none"}
                  />
                </button>

                <button
                  type="button"
                  onClick={() => toggleFlag(row, "isActive")}
                  disabled={pending}
                  aria-label={row.isActive ? `Hide ${row.title}` : `Show ${row.title}`}
                  title={row.isActive ? "Hide from the site" : "Show on the site"}
                  className={cn(ICON_BTN, "hover:bg-muted hover:text-foreground")}
                >
                  {row.isActive ? (
                    <Eye className="h-4 w-4" />
                  ) : (
                    <EyeOff className="h-4 w-4" />
                  )}
                </button>

                <Link
                  href={`/admin/portfolio/${row.id}/edit`}
                  aria-label={`Edit ${row.title}`}
                  title="Edit"
                  className={cn(ICON_BTN, "hover:bg-muted hover:text-foreground")}
                >
                  <Pencil className="h-4 w-4" />
                </Link>

                <button
                  type="button"
                  onClick={() => removeOne(row)}
                  aria-label={`Delete ${row.title}`}
                  title="Delete"
                  className={cn(ICON_BTN, "hover:bg-danger/10 hover:text-danger")}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
