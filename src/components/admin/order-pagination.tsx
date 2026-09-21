import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * URL-driven pagination for the admin lists.
 *
 * Same approach as the storefront's `components/store/pagination.tsx`: page
 * state lives in `?page=`, every control is a real `<Link>`, and page 1
 * renders as the bare URL so a shelf has one address rather than two. The
 * differences are deliberate and local to the admin:
 *
 * - **Every other filter is carried through.** An operator who has narrowed to
 *   "pending, COD, this week" and steps to page 2 must still be looking at
 *   pending COD orders from this week — losing the filters on a page change is
 *   the classic way an admin list becomes untrustworthy.
 * - **Denser controls** (36px on desktop) and a row count, because this sits
 *   under a table rather than a product grid. Still 44px tall on phones.
 *
 * Server component: no client JS, and it reads the same `searchParams` the
 * page already awaited.
 */

export type PageParams = Record<string, string | string[] | undefined>;

/** 25 rows: about one screen of the desktop table without scrolling twice. */
export const ORDERS_PAGE_SIZE = 25;

/** `?page=` → a 1-based integer. Junk, zero and negatives all mean page 1. */
export function parsePageParam(raw: string | string[] | undefined): number {
  const first = Array.isArray(raw) ? raw[0] : raw;
  const n = Number.parseInt(first ?? "", 10);
  return Number.isFinite(n) && n > 1 ? n : 1;
}

/** Rebuild the current query string with a new page, keeping every filter. */
function hrefFor(basePath: string, params: PageParams, page: number): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "page" || value == null) continue;
    if (Array.isArray(value)) {
      for (const one of value) if (one) sp.append(key, one);
    } else if (value) {
      sp.set(key, value);
    }
  }
  if (page > 1) sp.set("page", String(page));
  const qs = sp.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

/**
 * First, last, and the current page with a neighbour either side; gaps become
 * an ellipsis. Widened near the ends so the control keeps a stable width
 * instead of jumping as you move through the pages.
 */
function pageWindow(page: number, totalPages: number): (number | "gap")[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const wanted = new Set<number>([1, totalPages, page - 1, page, page + 1]);
  if (page <= 3) for (const n of [2, 3, 4]) wanted.add(n);
  if (page >= totalPages - 2) {
    for (const n of [totalPages - 3, totalPages - 2, totalPages - 1]) wanted.add(n);
  }

  const nums = [...wanted].filter((n) => n >= 1 && n <= totalPages).sort((a, b) => a - b);

  const out: (number | "gap")[] = [];
  let prev = 0;
  for (const n of nums) {
    if (prev && n - prev > 1) out.push("gap");
    out.push(n);
    prev = n;
  }
  return out;
}

const STEP =
  "inline-flex min-h-11 items-center justify-center gap-1 rounded-lg border px-3 text-[11px] font-medium uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:min-h-9";

const TILE =
  "grid h-9 min-w-9 place-items-center rounded-lg border px-1.5 text-xs font-medium tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function Step({
  href,
  rel,
  label,
  disabled,
}: {
  href: string;
  rel: "prev" | "next";
  label: string;
  disabled: boolean;
}) {
  const icon =
    rel === "prev" ? (
      <ChevronLeft className="h-3.5 w-3.5 shrink-0" aria-hidden />
    ) : (
      <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
    );

  // A dead control must not be a tab stop, so it degrades to a <span>.
  if (disabled) {
    return (
      <span
        aria-disabled="true"
        className={cn(STEP, "border-border/60 text-muted-foreground/50")}
      >
        {rel === "prev" && icon}
        {label}
        {rel === "next" && icon}
      </span>
    );
  }

  return (
    <Link
      href={href}
      rel={rel}
      aria-label={rel === "prev" ? "Go to previous page" : "Go to next page"}
      className={cn(STEP, "border-border text-foreground hover:border-accent hover:text-accent")}
    >
      {rel === "prev" && icon}
      {label}
      {rel === "next" && icon}
    </Link>
  );
}

export function OrderPagination({
  page,
  totalPages,
  total,
  pageSize,
  params,
  basePath = "/admin/orders",
}: {
  page: number;
  totalPages: number;
  /** Rows matching the current filters, across every page. */
  total: number;
  pageSize: number;
  params: PageParams;
  basePath?: string;
}) {
  if (totalPages <= 1) return null;

  const href = (n: number) => hrefFor(basePath, params, n);
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  return (
    <nav
      aria-label="Pagination"
      className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3"
    >
      <p className="text-[11px] text-muted-foreground tabular-nums">
        Showing <span className="font-medium text-foreground">{first}</span>–
        <span className="font-medium text-foreground">{last}</span> of{" "}
        <span className="font-medium text-foreground">{total}</span>
      </p>

      <div className="flex items-center gap-1.5">
        <Step href={href(page - 1)} rel="prev" label="Prev" disabled={page <= 1} />

        {/* Numbers would overflow at 320px, so phones get a counter instead. */}
        <span className="px-1 text-[11px] uppercase tracking-wider text-muted-foreground tabular-nums sm:hidden">
          {page} / {totalPages}
        </span>

        <ol className="hidden items-center gap-1 sm:flex">
          {pageWindow(page, totalPages).map((entry, i) =>
            entry === "gap" ? (
              <li key={`gap-${i}`} aria-hidden>
                <span className="grid h-9 w-5 place-items-center text-muted-foreground">
                  &hellip;
                </span>
              </li>
            ) : entry === page ? (
              <li key={entry}>
                <span
                  aria-current="page"
                  className={cn(TILE, "border-accent bg-accent text-accent-foreground")}
                >
                  {entry}
                </span>
              </li>
            ) : (
              <li key={entry}>
                <Link
                  href={href(entry)}
                  aria-label={`Go to page ${entry}`}
                  className={cn(
                    TILE,
                    "border-border text-foreground hover:border-accent hover:text-accent"
                  )}
                >
                  {entry}
                </Link>
              </li>
            )
          )}
        </ol>

        <Step href={href(page + 1)} rel="next" label="Next" disabled={page >= totalPages} />
      </div>
    </nav>
  );
}
