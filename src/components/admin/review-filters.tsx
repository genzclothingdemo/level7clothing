"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Search, X, Star } from "lucide-react";
import { REVIEW_FILTERS, REVIEW_FILTER_LABEL } from "@/lib/reviews";

/**
 * Tabs + search + rating/product narrowing for the review queue. State lives in
 * the URL so a filtered view can be bookmarked and survives the page refresh
 * that a moderation action triggers.
 */
export function ReviewFilters({
  counts,
  products,
}: {
  counts: Record<string, number>;
  products: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const view = params.get("view") || "all";
  const q = params.get("q") || "";
  const rating = params.get("rating") || "";
  const productId = params.get("product") || "";

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}?${next.toString()}`);
  }

  const hasNarrowing = !!(q || rating || productId);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {REVIEW_FILTERS.map((key) => {
          const active = view === key;
          return (
            <button
              key={key}
              onClick={() => setParam("view", key === "all" ? null : key)}
              className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm transition-colors ${
                active
                  ? "bg-foreground text-background"
                  : "border border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              {REVIEW_FILTER_LABEL[key]}
              <span
                className={`rounded-full px-1.5 text-xs ${
                  active ? "bg-background/20" : "bg-muted"
                }`}
              >
                {counts[key] ?? 0}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[16rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            defaultValue={q}
            onChange={(e) => setParam("q", e.target.value.trim() || null)}
            placeholder="Search reviewer, title, or review text…"
            className="input h-10 pl-9 pr-9"
          />
          {q && (
            <button
              onClick={() => setParam("q", null)}
              className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:bg-muted"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <select
          value={rating}
          onChange={(e) => setParam("rating", e.target.value || null)}
          className="input h-10 w-auto min-w-[9rem]"
          aria-label="Filter by rating"
        >
          <option value="">Any rating</option>
          {[5, 4, 3, 2, 1].map((r) => (
            <option key={r} value={String(r)}>
              {r} star{r === 1 ? "" : "s"}
            </option>
          ))}
          <option value="low">Critical (1–2★)</option>
        </select>

        <select
          value={productId}
          onChange={(e) => setParam("product", e.target.value || null)}
          className="input h-10 w-auto min-w-[12rem] max-w-[16rem]"
          aria-label="Filter by product"
        >
          <option value="">All products</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        {hasNarrowing && (
          <button
            onClick={() => router.replace(pathname + (view === "all" ? "" : `?view=${view}`))}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-2 text-xs text-muted-foreground hover:bg-muted"
          >
            <X className="h-3.5 w-3.5" /> Clear filters
          </button>
        )}
      </div>

      {rating === "low" && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Star className="h-3 w-3 fill-danger text-danger" />
          Showing critical reviews — worth replying to before publishing.
        </p>
      )}
    </div>
  );
}
