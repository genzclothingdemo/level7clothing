import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { LinkPendingOverlay } from "@/components/store/link-pending";
import { cn } from "@/lib/utils";

/**
 * Server-rendered pagination for the shop listings.
 *
 * Every control is a real <Link>, so each page is a crawlable URL and the
 * whole catalogue stays reachable without JavaScript. Page state lives in
 * `?page=`, which makes a position in the grid shareable.
 *
 * Page 1 deliberately renders as the bare URL (no `?page=1`) so the first
 * page of a shelf has exactly one address rather than two.
 */

/** Matches the awaited `searchParams` object a page hands down. */
export type PageParams = Record<string, string | string[] | undefined>;

/**
 * 12 = three full rows of the 4-up desktop grid and six rows of the 2-up
 * phone grid, so a page never ends on a ragged half-row.
 */
export const PAGE_SIZE = 12;

/** `?page=` → a 1-based integer. Junk, zero and negatives all mean page 1. */
export function parsePageParam(raw: string | string[] | undefined): number {
  const first = Array.isArray(raw) ? raw[0] : raw;
  const n = Number.parseInt(first ?? "", 10);
  return Number.isFinite(n) && n > 1 ? n : 1;
}

export type Paged<T> = {
  items: T[];
  /** Clamped into range, so an out-of-range `?page=` never renders empty. */
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
};

/**
 * Slice an already-loaded list.
 *
 * The listings fold subcategories into tiles in memory (see `lib/catalog.ts`),
 * so the total is only known after the rows are in hand — a DB-level
 * skip/take would page the wrong thing. Slicing here still pays off: only the
 * visible tiles are serialised into the RSC payload and only their ids go into
 * the grouped review query.
 */
export function paginate<T>(
  items: T[],
  rawPage: string | string[] | undefined,
  pageSize: number = PAGE_SIZE
): Paged<T> {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(parsePageParam(rawPage), totalPages);
  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    page,
    totalPages,
    total,
    pageSize,
  };
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
    for (const n of [totalPages - 3, totalPages - 2, totalPages - 1]) {
      wanted.add(n);
    }
  }

  const nums = [...wanted]
    .filter((n) => n >= 1 && n <= totalPages)
    .sort((a, b) => a - b);

  const out: (number | "gap")[] = [];
  let prev = 0;
  for (const n of nums) {
    if (prev && n - prev > 1) out.push("gap");
    out.push(n);
    prev = n;
  }
  return out;
}

/* Squared, uppercase, wide-tracked; hover changes colour only — no lift,
   no shadow, no ambient motion.
 *
 * The `!` on every border colour is load-bearing. `globals.css` sets
 * `* { border-color: var(--border) }` outside any cascade layer, and unlayered
 * rules outrank Tailwind's `@layer utilities` — so a plain `border-accent`
 * silently renders as the default hairline. Marking it important is the only
 * way to colour a border from here without editing that global rule. */
const CONTROL =
  "relative overflow-hidden inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border px-3 text-[11px] font-medium uppercase tracking-[0.14em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:px-4";

const CONTROL_ON =
  "border-border text-foreground hover:border-accent! hover:text-accent";
const CONTROL_OFF = "border-border/60! text-muted-foreground/50";

const TILE =
  "relative overflow-hidden grid h-10 w-10 place-items-center rounded-lg border text-xs font-medium tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function Step({
  href,
  rel,
  label,
  icon,
  disabled,
}: {
  href: string;
  rel: "prev" | "next";
  label: string;
  icon: ReactNode;
  disabled: boolean;
}) {
  // A dead control must not be a tab stop, so it degrades to a <span> rather
  // than a link with a disabled look.
  if (disabled) {
    return (
      <span aria-disabled="true" className={cn(CONTROL, CONTROL_OFF)}>
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
      className={cn(CONTROL, CONTROL_ON)}
    >
      {rel === "prev" && icon}
      {label}
      {rel === "next" && icon}
      <LinkPendingOverlay />
    </Link>
  );
}

export function Pagination({
  page,
  totalPages,
  params,
  basePath = "/shop",
}: {
  page: number;
  totalPages: number;
  params: PageParams;
  basePath?: string;
}) {
  if (totalPages <= 1) return null;

  const href = (n: number) => hrefFor(basePath, params, n);
  const chevron = "h-3.5 w-3.5 shrink-0";

  return (
    <nav
      aria-label="Pagination"
      className="mt-10 flex items-center justify-between gap-2 border-t border-border pt-8 sm:mt-14 sm:justify-center sm:gap-2"
    >
      <Step
        href={href(page - 1)}
        rel="prev"
        label="Prev"
        icon={<ChevronLeft className={chevron} aria-hidden />}
        disabled={page <= 1}
      />

      {/* Phones get a compact counter — numbers would overflow at 320px. */}
      <span className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground tabular-nums sm:hidden">
        Page {page} of {totalPages}
      </span>

      <ol className="hidden items-center gap-1.5 sm:flex">
        {pageWindow(page, totalPages).map((entry, i) =>
          entry === "gap" ? (
            <li key={`gap-${i}`} aria-hidden>
              <span className="grid h-10 w-6 place-items-center text-muted-foreground">
                &hellip;
              </span>
            </li>
          ) : entry === page ? (
            <li key={entry}>
              <span
                aria-current="page"
                className={cn(
                  TILE,
                  "border-accent! bg-accent text-accent-foreground"
                )}
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
                  "border-border text-foreground hover:border-accent! hover:text-accent"
                )}
              >
                {entry}
                <LinkPendingOverlay />
              </Link>
            </li>
          )
        )}
      </ol>

      <Step
        href={href(page + 1)}
        rel="next"
        label="Next"
        icon={<ChevronRight className={chevron} aria-hidden />}
        disabled={page >= totalPages}
      />
    </nav>
  );
}
