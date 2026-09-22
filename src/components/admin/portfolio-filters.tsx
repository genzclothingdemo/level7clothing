"use client";

/**
 * One compact row above the portfolio list.
 *
 * Same shape and rules as `coupon-filters.tsx`: filters apply on change with
 * no Apply button, they live in the URL so a filtered view survives the
 * `router.refresh()` that hiding or featuring a piece triggers, and a select
 * that is narrowing the list is tinted violet.
 *
 * The list's reorder buttons switch off while any of these is set — a
 * position is only meaningful against the whole list. See the note in
 * `portfolio-table.tsx`.
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { MiniButton } from "@/components/admin/form-kit";
import { cn } from "@/lib/utils";

export function PortfolioFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const q = params.get("q") ?? "";
  const kind = params.get("kind") ?? "";
  const status = params.get("status") ?? "";
  const section = params.get("section") ?? "";

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  const narrowing = !!(q || kind || status || section);

  const select = (live: boolean) =>
    cn(
      "input h-11 w-full min-w-0 sm:h-10 sm:w-auto sm:max-w-[12rem]",
      live && "border-accent text-accent"
    );

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-card p-2.5">
      <div className="relative min-w-[9rem] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          defaultValue={q}
          onChange={(e) => setParam("q", e.target.value.trim())}
          aria-label="Search titles, tags and links"
          placeholder="Search titles, tags…"
          className="input h-11 pl-9 sm:h-10"
        />
      </div>

      <select
        value={kind}
        onChange={(e) => setParam("kind", e.target.value)}
        aria-label="Filter by kind"
        className={select(!!kind)}
      >
        <option value="">Any kind</option>
        <option value="instagram">Instagram</option>
        <option value="video">Video</option>
        <option value="image">Image</option>
        <option value="link">Link</option>
      </select>

      <select
        value={status}
        onChange={(e) => setParam("status", e.target.value)}
        aria-label="Filter by whether it is showing"
        className={select(!!status)}
      >
        <option value="">Any status</option>
        <option value="active">Showing</option>
        <option value="hidden">Hidden</option>
        <option value="featured">Featured</option>
      </select>

      {/* The shelf on /portfolio, not the tab that used to exist. The values
          match `PORTFOLIO_SECTIONS`; they are repeated here rather than
          imported because `lib/portfolio.ts` pulls in Prisma and this is a
          client component. */}
      <select
        value={section}
        onChange={(e) => setParam("section", e.target.value)}
        aria-label="Filter by portfolio section"
        className={select(!!section)}
      >
        <option value="">Any section</option>
        <option value="story">Who we are</option>
        <option value="milestones">Milestones</option>
        <option value="reels">Reels &amp; films</option>
        <option value="customers">Happy customers</option>
        <option value="collabs">Collaborations</option>
        <option value="bulk">Bulk &amp; custom work</option>
      </select>

      {narrowing && (
        <MiniButton onClick={() => router.replace(pathname)} className="h-11 sm:h-10">
          <X className="h-3.5 w-3.5" /> Clear
        </MiniButton>
      )}
    </div>
  );
}
