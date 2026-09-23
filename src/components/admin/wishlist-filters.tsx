"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Btn } from "@/components/admin/order-ui";
import {
  WISHLIST_AVAILABILITIES,
  WISHLIST_AVAILABILITY_HELP,
  WISHLIST_AVAILABILITY_LABEL,
  WISHLIST_PIVOTS,
  WISHLIST_PIVOT_HELP,
  WISHLIST_PIVOT_LABEL,
  WISHLIST_SORTS,
  type WishlistPivot,
} from "@/lib/wishlist-insights";

/**
 * Two rows: the pivot, then the filters that apply to both halves of it.
 *
 * ── Why the pivot gets a row of its own ──────────────────────────────────────
 *
 * It is not a facet. Nothing on the second row changes *which* saves are on
 * screen depending on the pivot — the filters run on individual saves and the
 * grouping happens afterwards, so "out of stock" selects exactly the same set
 * either way. The pivot only decides how that set is arranged. Mixing it into
 * the filter strip would make it look like a fourth narrowing control.
 *
 * ── Why switching pivot keeps everything ─────────────────────────────────────
 *
 * The opposite rule to Admin → Customers, and for the opposite reason. There,
 * switching between Customers and Guests drops the status filter because a
 * status that exists on one side may not exist on the other. Here both sides
 * take the identical filter set by construction, so dropping anything would
 * silently widen the view the moment you looked at it from the other end —
 * which is the one thing a pivot must never do. Only `?page=` goes, because
 * the two groupings have different row counts.
 */

/** Typing shouldn't fire a query per keystroke: every load is a DB round trip. */
const SEARCH_DEBOUNCE_MS = 300;

export function WishlistFilters({
  pivot,
  counts,
  categories,
}: {
  pivot: WishlistPivot;
  /** Saves in each availability state, within the current search/category. */
  counts: Record<string, number>;
  categories: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const urlQ = params.get("q") ?? "";
  const availability = params.get("stock") ?? "all";
  const category = params.get("category") ?? "";
  const sort = params.get("sort") ?? "saves";

  const [q, setQ] = useState(urlQ);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    // Any change to what is listed resets the page — otherwise a narrowing
    // filter leaves the reader on page 3 of a list that is now one page long.
    next.delete("page");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  function onSearch(value: string) {
    setQ(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(
      () => setParam("q", value.trim() || null),
      SEARCH_DEBOUNCE_MS
    );
  }

  function clearAll() {
    if (timer.current) clearTimeout(timer.current);
    setQ("");
    // Stays on the pivot being looked at: "Clear" clears the filters, it does
    // not move you to a different view of the data.
    router.replace(pivot === "person" ? `${pathname}?by=person` : pathname);
  }

  const active =
    (urlQ ? 1 : 0) + (availability !== "all" ? 1 : 0) + (category ? 1 : 0);

  const chips = [
    {
      key: "all",
      label: "All",
      help: "Every save, whether or not the piece can be bought today.",
    },
    ...WISHLIST_AVAILABILITIES.map((a) => ({
      key: a,
      label: WISHLIST_AVAILABILITY_LABEL[a],
      help: WISHLIST_AVAILABILITY_HELP[a],
    })),
  ];

  return (
    <div className="rounded-lg border border-border bg-card p-2">
      {/* ---- The pivot ---- */}
      <div
        role="group"
        aria-label="Group saves by product or by person"
        className="flex flex-wrap items-center gap-2 border-b border-border pb-2"
      >
        {WISHLIST_PIVOTS.map((p) => {
          const on = pivot === p;
          return (
            <button
              key={p}
              type="button"
              title={WISHLIST_PIVOT_HELP[p]}
              aria-pressed={on}
              onClick={() => setParam("by", p === "product" ? null : p)}
              className={cn(
                "inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-3 text-[11px] font-medium uppercase tracking-wider transition-colors sm:min-h-9 sm:flex-none",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                on
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {WISHLIST_PIVOT_LABEL[p]}
            </button>
          );
        })}
        <p className="basis-full text-[11px] leading-relaxed text-muted-foreground sm:basis-auto sm:pl-1">
          {WISHLIST_PIVOT_HELP[pivot]}
        </p>
      </div>

      {/* ---- The filters, identical on both pivots ---- */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-full sm:basis-56">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Piece, category, or who saved it"
            aria-label="Search saves"
            className="input h-11 pl-8 text-xs sm:h-9"
          />
        </div>

        {chips.map((c) => {
          const on = availability === c.key;
          return (
            <button
              key={c.key}
              type="button"
              title={c.help}
              aria-pressed={on}
              onClick={() => setParam("stock", c.key === "all" ? null : c.key)}
              className={cn(
                "inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium uppercase tracking-wider transition-colors sm:min-h-9",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                on
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {c.label}
              <span
                className={cn(
                  "rounded px-1 text-[10px] tabular-nums",
                  on ? "bg-accent/20" : "bg-muted"
                )}
              >
                {counts[c.key] ?? 0}
              </span>
            </button>
          );
        })}

        {categories.length > 1 && (
          <label className="flex min-w-0 items-center gap-1.5">
            <span className="eyebrow shrink-0">Category</span>
            <select
              value={category}
              onChange={(e) => setParam("category", e.target.value || null)}
              className="input h-11 w-auto min-w-0 text-xs sm:h-9"
            >
              <option value="">All</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="ml-auto flex min-w-0 items-center gap-1.5">
          <span className="eyebrow shrink-0">Sort</span>
          <select
            value={sort}
            onChange={(e) =>
              setParam("sort", e.target.value === "saves" ? null : e.target.value)
            }
            className="input h-11 w-auto min-w-0 text-xs sm:h-9"
          >
            {WISHLIST_SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        {active > 0 && (
          <Btn tone="ghost" onClick={clearAll} title="Clear search and filters">
            <X className="h-3.5 w-3.5" /> Clear
          </Btn>
        )}
      </div>
    </div>
  );
}
