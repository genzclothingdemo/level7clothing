"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";

const SORTS = [
  { value: "newest",     label: "Newest" },
  { value: "featured",   label: "Best Selling" },
  { value: "price-asc",  label: "Price: Low to High" },
  { value: "price-desc", label: "Price: High to Low" },
  { value: "alpha",      label: "Alphabetical" },
];

export function ShopFilters({ categories }: { categories: string[] }) {
  const router       = useRouter();
  const params       = useSearchParams();
  const activeCat    = params.get("category") ?? "All";
  const activeSort   = params.get("sort")     ?? "newest";
  const [q, setQ]    = useState(params.get("q") ?? "");
  const railRef      = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setQ(params.get("q") ?? "");
  }, [params]);

  // Keep the active chip centred on the mobile rail after navigation.
  useEffect(() => {
    const rail   = railRef.current;
    const active = rail?.querySelector<HTMLElement>("[data-active='true']");
    active?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [activeCat]);

  function update(next: Record<string, string | null>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (!v || v === "All") sp.delete(k);
      else sp.set(k, v);
    }
    if ("category" in next || "q" in next) sp.delete("sub");
    // Any change to the filters reshuffles the result set, so page 3 of the
    // old listing is meaningless against the new one — always land on page 1.
    sp.delete("page");
    router.push(`/shop?${sp.toString()}`);
  }

  return (
    /* Sticky wrapper. Offsets must track the navbar exactly: it is h-14 (56px)
       and md:h-20 (80px). The old `sm:top-16` pinned this at 64px, so from
       768px up the 80px navbar painted over its top 16px, and between 640–767px
       it left an 8px gap that products scrolled through. */
    <div className="sticky top-14 z-20 -mx-5 bg-background/90 px-5 pb-3 pt-2 backdrop-blur-md sm:mx-0 sm:px-0 md:top-20">
      {/* ── Search + Sort row ── */}
      <div className="flex items-center gap-2 sm:gap-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            update({ q: q || null });
          }}
          className="group relative min-w-0 flex-1 sm:max-w-xs"
        >
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-accent" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search products…"
            aria-label="Search products"
            className="h-10 w-full rounded-full border border-input bg-card pl-10 pr-9 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ring sm:h-11"
          />
          <AnimatePresence>
            {q && (
              <motion.button
                type="button"
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.6 }}
                onClick={() => {
                  setQ("");
                  if (params.get("q")) update({ q: null });
                }}
                aria-label="Clear search"
                className="absolute right-3 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </motion.button>
            )}
          </AnimatePresence>
        </form>

        {/* Sort select */}
        <div className="flex shrink-0 items-center gap-1.5">
          <SlidersHorizontal className="h-4 w-4 shrink-0 text-muted-foreground" />
          <select
            value={activeSort}
            onChange={(e) => update({ sort: e.target.value })}
            aria-label="Sort products"
            className="h-10 max-w-[7.5rem] cursor-pointer rounded-full border border-input bg-card px-3.5 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ring sm:h-11 sm:max-w-none sm:px-4"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Category chips — always single-row horizontal scroll ── */}
      <div
        ref={railRef}
        className="no-scrollbar -mx-5 mt-2.5 flex gap-2 overflow-x-auto px-5 sm:mx-0 sm:px-0"
      >
        {["All", ...categories].map((cat) => {
          const isActive = activeCat === cat;
          return (
            <motion.button
              key={cat}
              data-active={isActive}
              onClick={() => update({ category: cat })}
              whileTap={{ scale: 0.93 }}
              className={cn(
                "relative shrink-0 cursor-pointer rounded-full border px-3 py-1 text-xs transition-colors sm:px-3.5 sm:py-1.5 sm:text-sm",
                isActive
                  ? "border-foreground text-background"
                  : "border-border hover:bg-muted"
              )}
            >
              {isActive && (
                <motion.span
                  layoutId="cat-pill"
                  className="absolute inset-0 rounded-full bg-foreground"
                  transition={{ type: "spring", stiffness: 420, damping: 36 }}
                />
              )}
              <span className="relative z-10 whitespace-nowrap">{cat}</span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
