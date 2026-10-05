"use client";

/**
 * The stock list — every product, and every size under it.
 *
 * ## Grouped by product, sizes as chips
 *
 * 107 sizes today, more with every drop. A flat wall of SKUs makes the owner
 * scan three hundred numbers to answer "how is the Samurai tee doing?". So the
 * list is one row per product, and each row carries its sizes as small chips —
 * `S 10 · M 2 · L 0` — which answers that question without opening anything.
 * The chips show **available**, the number the shop can still sell; the
 * expanded row has on hand and reserved beside it.
 *
 * Each chip is a link to that size's own ledger, so the history of any number
 * on this screen is one click away (the brief's "entry bhi see kar sake").
 *
 * ## What needs a person comes first
 *
 * Rows are ordered oversold → out → low → fine → not tracked. Oversold is the
 * one state that needs someone to act — open orders that the shelf cannot
 * fill — so it also sorts to the top when the product is hidden: a hidden
 * product can still owe a customer a parcel.
 *
 * ## Filtering is local, the URL still says what you see
 *
 * Every product is already on the page (22 rows, and a few thousand sizes would
 * still be a small payload), so search and the quick filters run in the
 * browser with no round trip to Mumbai. They are written back with
 * `history.replaceState`, which Next keeps in step with its router — so a
 * filtered view is still a link, and the server renders `?show=oversold`
 * correctly on first paint.
 */

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ChevronDown, Search, X } from "lucide-react";
import type { StockState } from "@/lib/inventory-types";
import {
  STATE_INK,
  Tag,
  VariantTable,
  formatBalance,
  formatUnits,
  inventoryHref,
  type StockFilter,
} from "@/components/admin/inventory-ui";
import type { StockProduct } from "@/app/admin/(panel)/inventory/_lib/queries";
import { cn } from "@/lib/utils";

const RANK: Record<StockState, number> = { oversold: 0, out: 1, low: 2, ok: 3 };

function rankOf(p: StockProduct): number {
  if (!p.tracked) return 5;
  if (p.worst === "oversold") return 0;
  if (!p.isActive) return 4;
  return RANK[p.worst ?? "ok"];
}

/**
 * Which sizes of a product a search picks out.
 *
 * Returns `false` for no match, `null` when the whole product matches, or the
 * set of matching sizes. A word that **is** one of the product's option values
 * ("m", "xl", "red") must match the size itself — otherwise "samurai m" would
 * light every size, because "premium" contains an m. Every other word is looked
 * for in the product name and the SKU, so a pasted `L7-PT-SAMURAI-M` finds its
 * one size.
 */
function matchSizes(p: StockProduct, tokens: string[]): Set<string> | null | false {
  if (tokens.length === 0) return null;
  const name = p.name.toLowerCase();
  if (p.variants.length === 0) return tokens.every((t) => name.includes(t)) ? null : false;

  const values = new Set(p.variants.flatMap((v) => v.label.toLowerCase().split(" / ")));
  const hits = p.variants
    .filter((v) => {
      const parts = v.label.toLowerCase().split(" / ");
      const sku = v.sku.toLowerCase();
      return tokens.every((t) => (values.has(t) ? parts.includes(t) : name.includes(t) || sku.includes(t)));
    })
    .map((v) => v.id);

  if (hits.length === 0) return false;
  return hits.length === p.variants.length ? null : new Set(hits);
}

const CHIP_TONE: Record<StockState, string> = {
  oversold: "border-danger bg-danger/10",
  out: "border-danger/40",
  low: "border-orange-500/40",
  ok: "border-border",
};

const FILTER_LABEL: Record<StockFilter, string> = {
  all: "All",
  tracked: "Tracked",
  untracked: "Not tracked",
  oversold: "Oversold",
  out: "Out of stock",
  low: "Low stock",
};

const rail =
  "inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-[11px] font-medium uppercase tracking-wider transition-colors sm:min-h-9 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const smallButton =
  "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-[11px] font-medium uppercase tracking-widest transition-colors hover:bg-muted sm:min-h-9 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function InventoryStockTable({
  products,
  initialQuery,
  initialShow,
}: {
  products: StockProduct[];
  initialQuery: string;
  initialShow: StockFilter;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [show, setShow] = useState<StockFilter>(initialShow);
  /** Rows the reader opened or closed by hand. Everything else follows the filter. */
  const [opened, setOpened] = useState<Record<string, boolean>>({});

  /** Write the view back into the address bar — no navigation, no refetch. */
  function syncUrl(q: string, s: StockFilter) {
    const qs = new URLSearchParams(window.location.search);
    if (q.trim()) qs.set("q", q.trim());
    else qs.delete("q");
    if (s !== "all") qs.set("show", s);
    else qs.delete("show");
    const next = qs.toString();
    window.history.replaceState(null, "", next ? `${window.location.pathname}?${next}` : window.location.pathname);
  }

  function changeQuery(q: string) {
    setQuery(q);
    setOpened({});
    syncUrl(q, show);
  }

  function changeShow(s: StockFilter) {
    setShow(s);
    setOpened({});
    syncUrl(query, s);
  }

  function showEverything() {
    setQuery("");
    setShow("all");
    setOpened({});
    syncUrl("", "all");
  }

  /** Health of the whole catalogue — the chips count everything, not the search. */
  const counts = useMemo(() => {
    const c: Record<StockFilter, number> = { all: products.length, tracked: 0, untracked: 0, oversold: 0, out: 0, low: 0 };
    for (const p of products) {
      c[p.tracked ? "tracked" : "untracked"] += 1;
      for (const v of p.variants) {
        if (v.state === "oversold" || v.state === "out" || v.state === "low") c[v.state] += 1;
      }
    }
    return c;
  }, [products]);

  const visible = useMemo(() => {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const rows: { p: StockProduct; lit: Set<string> | null }[] = [];

    for (const p of products) {
      if (show === "tracked" && !p.tracked) continue;
      if (show === "untracked" && p.tracked) continue;

      let lit: Set<string> | null = null;
      if (show === "oversold" || show === "out" || show === "low") {
        const ids = p.variants.filter((v) => v.state === show).map((v) => v.id);
        if (ids.length === 0) continue;
        lit = new Set(ids);
      }

      const matched = matchSizes(p, tokens);
      if (matched === false) continue;
      if (matched) {
        lit = lit ? new Set([...lit].filter((id) => matched.has(id))) : matched;
        if (lit.size === 0) continue;
      }
      rows.push({ p, lit });
    }

    // Stable: the server sent them A→Z, so ties keep that order.
    return rows.sort((a, b) => rankOf(a.p) - rankOf(b.p));
  }, [products, query, show]);

  const isOpen = (p: StockProduct, lit: Set<string> | null) =>
    p.tracked && (opened[p.id] ?? lit !== null);

  const trackedShown = visible.filter((r) => r.p.tracked);
  const allOpen = trackedShown.length > 0 && trackedShown.every((r) => isOpen(r.p, r.lit));

  function setAll(open: boolean) {
    setOpened(Object.fromEntries(trackedShown.map((r) => [r.p.id, open])));
  }

  const filtered = show !== "all" || query.trim() !== "";

  return (
    <div className="min-w-0 space-y-3">
      {/* ---- Search and the quick filters ---- */}
      <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-2.5">
        <div className="relative min-w-0 flex-1 basis-60">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            value={query}
            onChange={(e) => changeQuery(e.target.value)}
            aria-label="Search products, sizes or SKUs"
            placeholder="Search a product, size or SKU…"
            className="input h-11 pl-9 pr-10 sm:h-10"
          />
          {query && (
            <button
              type="button"
              onClick={() => changeQuery("")}
              aria-label="Clear search"
              className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 cursor-pointer place-items-center rounded-lg text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>

        <div
          role="radiogroup"
          aria-label="Show"
          className="no-scrollbar flex min-w-0 max-w-full gap-1 overflow-x-auto"
        >
          {(["all", "tracked", "untracked", "oversold", "out", "low"] as const)
            // A filter that would show nothing is absent — unless it is the one
            // switched on, which must stay visible so it can be switched off.
            .filter((f) => f === "all" || counts[f] > 0 || f === show)
            .map((f) => {
              const on = show === f;
              const alarm = f === "oversold" && counts.oversold > 0;
              return (
                <button
                  key={f}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => changeShow(f)}
                  className={cn(
                    rail,
                    on
                      ? alarm
                        ? "border-danger bg-danger text-background"
                        : "border-accent bg-accent/10 text-accent"
                      : alarm
                        ? "border-danger text-danger hover:bg-danger/10"
                        : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  {FILTER_LABEL[f]}
                  <span
                    className={cn(
                      "rounded px-1 text-[10px] tabular-nums",
                      on ? "bg-background/20" : "bg-muted text-foreground"
                    )}
                  >
                    {counts[f]}
                  </span>
                </button>
              );
            })}
        </div>
      </div>

      {/* ---- What the list is showing ---- */}
      <div className="flex min-h-8 flex-wrap items-center justify-between gap-2 px-1">
        <p className="text-xs text-muted-foreground">
          {filtered
            ? `${visible.length} of ${products.length} products`
            : `${products.length} products`}
          {(show === "oversold" || show === "out" || show === "low") &&
            ` · ${counts[show]} size${counts[show] === 1 ? "" : "s"} ${FILTER_LABEL[show].toLowerCase()}`}
        </p>
        {trackedShown.length > 0 && (
          <button
            type="button"
            onClick={() => setAll(!allOpen)}
            className="min-h-11 cursor-pointer rounded-lg px-2 text-[11px] font-medium uppercase tracking-widest text-muted-foreground hover:text-foreground sm:min-h-8"
          >
            {allOpen ? "Collapse all" : "Show every size"}
          </button>
        )}
      </div>

      {/* ---- The list ---- */}
      {visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center">
          <p className="font-serif text-lg">
            {show === "oversold" && !query.trim() ? "Nothing is oversold" : "Nothing matches"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {show === "oversold" && !query.trim()
              ? "Every open order can be filled from the shelf."
              : "Try a shorter search, or show everything."}
          </p>
          <button type="button" onClick={showEverything} className={cn(smallButton, "mt-4")}>
            Show everything
          </button>
        </div>
      ) : (
        <ul className="min-w-0 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {visible.map(({ p, lit }) => (
            <ProductRow
              key={p.id}
              p={p}
              lit={lit}
              open={isOpen(p, lit)}
              onToggle={() => setOpened((prev) => ({ ...prev, [p.id]: !isOpen(p, lit) }))}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  One product                                                        */
/* ------------------------------------------------------------------ */

function ProductRow({
  p,
  lit,
  open,
  onToggle,
}: {
  p: StockProduct;
  lit: Set<string> | null;
  open: boolean;
  onToggle: () => void;
}) {
  const panelId = `sizes-${p.id}`;

  return (
    <li className={cn("min-w-0", p.worst === "oversold" && "bg-danger/[0.03]")}>
      <div className="flex items-start gap-3 p-3 sm:px-4">
        <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-muted">
          {p.image && <Image src={p.image} alt="" fill sizes="44px" className="object-cover" />}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Link
                href={inventoryHref.product(p.id)}
                className="line-clamp-2 text-sm font-medium underline-offset-2 hover:underline"
              >
                {p.name}
              </Link>
              {(!p.isActive || !p.tracked) && (
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  {!p.isActive && <Tag>Hidden</Tag>}
                  {!p.tracked && (
                    <span>
                      Not tracked · one count of {formatUnits(p.legacyStock)} for all sizes
                    </span>
                  )}
                </p>
              )}
            </div>

            {p.tracked ? (
              <div className="shrink-0 text-right">
                <p className="text-lg font-medium leading-tight tabular-nums">{formatUnits(p.available)}</p>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">available</p>
              </div>
            ) : (
              <Link href={inventoryHref.product(p.id)} className={cn(smallButton, "hidden sm:inline-flex")}>
                Start tracking
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            )}
          </div>

          {p.tracked && p.variants.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1" aria-label={`Available per size of ${p.name}`}>
              {p.variants.map((v) => {
                const state = v.state ?? "ok";
                return (
                  <li key={v.id}>
                    <Link
                      href={inventoryHref.ledger({ variant: v.id })}
                      title={`${v.label} · ${v.sku} — ${formatBalance(v.available)} available (${formatUnits(v.onHand)} on hand, ${formatUnits(v.reserved)} reserved). Open its history.`}
                      className={cn(
                        "inline-flex min-h-8 items-center gap-1.5 rounded-md border px-2 text-[11px] transition-colors hover:bg-muted",
                        CHIP_TONE[state],
                        lit && (lit.has(v.id) ? "ring-2 ring-accent ring-offset-1 ring-offset-card" : "opacity-50")
                      )}
                    >
                      <span className="text-muted-foreground">{v.label}</span>
                      <span className={cn("font-semibold tabular-nums", STATE_INK[state])}>
                        {formatBalance(v.available)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          {!p.tracked && (
            <Link href={inventoryHref.product(p.id)} className={cn(smallButton, "mt-2 sm:hidden")}>
              Start tracking
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          )}
        </div>

        {p.tracked && (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={open ? `Hide the sizes of ${p.name}` : `Show every size of ${p.name}`}
            className="-mr-1 grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:h-9 sm:w-9"
          >
            <ChevronDown
              className={cn("h-4 w-4 transition-transform duration-200 motion-reduce:transition-none", open && "rotate-180")}
              aria-hidden="true"
            />
          </button>
        )}
      </div>

      {/* Mounted only while open — never parked with a transform. */}
      {open && (
        <div id={panelId} className="animate-[fadeIn_0.15s_ease-out_both] border-t border-border bg-background/40 motion-reduce:animate-none">
          <VariantTable variants={p.variants} highlight={lit} />
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2">
            <p className="text-[11px] tabular-nums text-muted-foreground">
              {formatUnits(p.onHand)} on hand · {formatUnits(p.reserved)} reserved
            </p>
            <div className="flex flex-wrap gap-1">
              <Link href={inventoryHref.ledger({ product: p.id })} className={smallButton}>
                Ledger
              </Link>
              <Link href={inventoryHref.product(p.id)} className={cn(smallButton, "border-foreground bg-foreground text-background hover:bg-foreground/85")}>
                Record an entry
              </Link>
            </div>
          </div>
        </div>
      )}
    </li>
  );
}
