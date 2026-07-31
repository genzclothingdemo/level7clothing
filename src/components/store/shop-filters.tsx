"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useEffect } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

const SORTS = [
  { value: "newest", label: "Newest" },
  { value: "featured", label: "Featured" },
  { value: "price-asc", label: "Price: Low to High" },
  { value: "price-desc", label: "Price: High to Low" },
];

export function ShopFilters({ categories }: { categories: string[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const activeCat = params.get("category") ?? "All";
  const activeSort = params.get("sort") ?? "newest";
  const [q, setQ] = useState(params.get("q") ?? "");

  useEffect(() => {
    setQ(params.get("q") ?? "");
  }, [params]);

  function update(next: Record<string, string | null>) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (!v || v === "All") sp.delete(k);
      else sp.set(k, v);
    }
    router.push(`/shop?${sp.toString()}`);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 sm:gap-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            update({ q: q || null });
          }}
          className="relative min-w-0 flex-1 sm:max-w-xs"
        >
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search tees, hoodies…"
            className="h-11 w-full rounded-full border border-input bg-card pl-10 pr-4 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </form>

        <div className="flex shrink-0 items-center gap-2">
          <label className="hidden text-sm text-muted-foreground sm:block">
            Sort
          </label>
          <select
            value={activeSort}
            onChange={(e) => update({ sort: e.target.value })}
            aria-label="Sort products"
            className="h-11 max-w-[8.5rem] rounded-full border border-input bg-card px-4 text-sm outline-none focus:ring-2 focus:ring-ring cursor-pointer sm:max-w-none"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Category chips — single-line horizontal scroll on mobile, wrap on larger */}
      <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 sm:mx-0 sm:flex-wrap sm:px-0">
        {["All", ...categories].map((cat) => (
          <button
            key={cat}
            onClick={() => update({ category: cat })}
            className={cn(
              "shrink-0 rounded-full border px-3.5 py-1.5 text-sm transition-colors cursor-pointer sm:px-4 sm:py-2",
              activeCat === cat
                ? "border-foreground bg-foreground text-background"
                : "border-border hover:bg-muted"
            )}
          >
            {cat}
          </button>
        ))}
      </div>
    </div>
  );
}
