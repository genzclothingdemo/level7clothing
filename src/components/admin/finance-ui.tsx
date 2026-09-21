/**
 * finance-ui — the furniture of Admin → Finance.
 *
 * **Server components.** Nothing here is interactive, so nothing here ships
 * JavaScript; the only client island on these screens is the filter row
 * (`finance-nav`) and the `InfoTip` bubbles, both of which genuinely need it.
 *
 * Two house rules from the data-viz method are baked in rather than left to
 * each caller:
 *
 * 1. **Every figure carries its definition.** `StatTile` and `Panel` take a
 *    required-in-practice `tip`, and the text comes from `METRIC` in
 *    `lib/analytics.ts` — the same module that computes the number. A figure
 *    whose explanation lives somewhere else is a figure that will eventually
 *    contradict itself.
 * 2. **Values are proportional figures, not `tabular-nums`.** Equal-width
 *    digits make a large standalone number look loose; `tabular-nums` is
 *    reserved for columns of numbers that must line up vertically — table
 *    rows and axis ticks, where it is applied explicitly.
 *
 * The value face is the body sans (Inter), not the `font-serif` display face
 * (Space Grotesk — see CLAUDE.md, the name lies). Headings keep the display
 * face like the rest of the admin; the numbers do not, because a display face
 * on a figure reads as decoration rather than data. Admin → Dashboard already
 * sets values in the body sans, so this matches what is there.
 */

import Link from "next/link";
import { ArrowDown, ArrowRight, ArrowUp, Minus } from "lucide-react";
import { InfoTip } from "@/components/store/info-tip";
import { cn, formatINR } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Number formatting                                                  */
/* ------------------------------------------------------------------ */

/**
 * Indian-grouped integers (1,23,456) — the grouping the owner reads prices in
 * everywhere else on this site.
 */
export function formatCount(n: number): string {
  return new Intl.NumberFormat("en-IN").format(n);
}

/** `+12.4%` / `−8%` / `—`. Minus is U+2212, which lines up with digits. */
export function formatDelta(pct: number | null): string {
  if (pct === null) return "—";
  if (pct === 0) return "0%";
  const abs = Math.abs(pct);
  const shown = abs >= 100 ? Math.round(abs) : abs;
  return `${pct > 0 ? "+" : "−"}${shown}%`;
}

/* ------------------------------------------------------------------ */
/*  Panel                                                              */
/* ------------------------------------------------------------------ */

/**
 * One titled section. `min-w-0` because a panel is almost always a grid item,
 * and a grid item's automatic minimum size is its content — one wide table
 * would otherwise widen the column and take the page with it at 320px.
 */
export function Panel({
  title,
  tip,
  aside,
  subtitle,
  children,
  className,
}: {
  title: string;
  tip?: React.ReactNode;
  aside?: React.ReactNode;
  /** One line under the title — scope or caveat, never an explanation. */
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn("min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-5", className)}
    >
      <div className="mb-3 flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 className="flex items-center gap-1 font-serif text-lg leading-none">
          {title}
          {tip && <InfoTip term={title}>{tip}</InfoTip>}
        </h2>
        {aside}
      </div>
      {subtitle && (
        <p className="-mt-1 mb-3 text-xs leading-relaxed text-muted-foreground">{subtitle}</p>
      )}
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Stat tile                                                          */
/* ------------------------------------------------------------------ */

/**
 * Which way is up. Revenue rising is good; refunds rising is not; a count that
 * is neither (units in stock) takes `none` and wears the muted ink, because
 * colouring a neutral movement green is the dashboard equivalent of cheering.
 */
export type GoodDirection = "up" | "down" | "none";

export function StatTile({
  label,
  value,
  tip,
  delta,
  deltaLabel,
  good = "up",
  sub,
  emphasis,
}: {
  label: string;
  value: string;
  /** The metric's definition. Comes from `METRIC` — never written inline. */
  tip: React.ReactNode;
  /** Signed percent vs the previous window; `null` renders nothing. */
  delta?: number | null;
  /** Names the period being compared against, e.g. "vs previous 30 days". */
  deltaLabel?: string;
  good?: GoodDirection;
  /** A second, smaller line — a count behind the money, a caveat. */
  sub?: React.ReactNode;
  /** The one tile a view leads with. Exactly one per screen. */
  emphasis?: boolean;
}) {
  const showDelta = delta !== undefined && delta !== null;
  const rising = (delta ?? 0) > 0;
  const flat = (delta ?? 0) === 0;
  // Colour is direction × whether up is good, and never colour alone: the
  // arrow icon carries the same information for a reader who cannot see it.
  const tone =
    good === "none" || flat
      ? "text-muted-foreground"
      : rising === (good === "up")
        ? "text-success"
        : "text-danger";
  const Arrow = flat ? Minus : rising ? ArrowUp : ArrowDown;

  return (
    <div
      className={cn(
        "min-w-0 rounded-2xl border border-border bg-card p-4",
        // The headline number takes the full width of a two-column phone grid.
        // At 320px a tile is ~140px, and a figure like ₹12,34,567 set at 30px
        // does not fit in that — it would wrap mid-number, which is worse than
        // any layout problem it solves.
        emphasis && "col-span-2 lg:col-span-1"
      )}
    >
      <div className="flex items-start gap-1">
        <p className="eyebrow min-w-0 break-words">{label}</p>
        <InfoTip term={label}>{tip}</InfoTip>
      </div>
      <p
        className={cn(
          "mt-2 font-medium leading-tight break-words",
          emphasis ? "text-3xl sm:text-4xl" : "text-2xl"
        )}
      >
        {value}
      </p>
      {showDelta && (
        <p className={cn("mt-1.5 flex items-center gap-1 text-xs", tone)}>
          <Arrow className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="tabular-nums">{formatDelta(delta ?? null)}</span>
          {deltaLabel && <span className="truncate text-muted-foreground">{deltaLabel}</span>}
        </p>
      )}
      {sub && <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{sub}</p>}
    </div>
  );
}

/** The grid stat tiles live in. Two up at 320px, never one. */
export function TileGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>
  );
}

/* ------------------------------------------------------------------ */
/*  Definition list                                                    */
/* ------------------------------------------------------------------ */

/**
 * A label/value line with its own (i). Used for the arithmetic breakdowns
 * where a chart would be a one-bar bar chart — the number *is* the chart.
 */
export function DefRow({
  label,
  value,
  tip,
  tone = "default",
  strong,
}: {
  label: string;
  value: string;
  tip?: React.ReactNode;
  /** `deduction` prints a leading minus and mutes the value. */
  tone?: "default" | "deduction" | "total";
  strong?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-3 py-1.5 text-sm",
        tone === "total" && "mt-1 border-t border-border pt-2.5"
      )}
    >
      <span className="flex min-w-0 items-center gap-1 text-muted-foreground">
        <span className="min-w-0 break-words">{label}</span>
        {tip && <InfoTip term={label}>{tip}</InfoTip>}
      </span>
      <span
        className={cn(
          "shrink-0 tabular-nums",
          tone === "deduction" ? "text-muted-foreground" : "text-foreground",
          (strong || tone === "total") && "font-medium"
        )}
      >
        {tone === "deduction" ? `− ${value}` : value}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Empty state                                                        */
/* ------------------------------------------------------------------ */

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

/* ------------------------------------------------------------------ */
/*  Caveat                                                             */
/* ------------------------------------------------------------------ */

/**
 * A stated limitation, in the flow of the page rather than in a footnote
 * nobody scrolls to. Deliberately plain — an admonition box with an icon and
 * a colour would read as an error, and none of these are errors.
 */
export function Caveat({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 border-l-2 border-border pl-3 text-xs leading-relaxed text-muted-foreground">
      {children}
    </p>
  );
}

/* ------------------------------------------------------------------ */
/*  Pagination                                                         */
/* ------------------------------------------------------------------ */

export const PAGE_SIZE = 10;

/** Clamp a `?p=` value to a real page. Anything unparseable is page 1. */
export function pageFrom(raw: string | undefined, total: number, size = PAGE_SIZE): number {
  const pages = Math.max(1, Math.ceil(total / size));
  const n = Number.parseInt(raw ?? "1", 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, pages);
}

/**
 * Previous/next links that carry every other query parameter through, so
 * paging a table never silently resets the time range. Rendered as links
 * rather than buttons because each page genuinely is its own URL — the whole
 * point of keeping the view in the address bar.
 */
export function Pager({
  basePath,
  params,
  param,
  page,
  total,
  size = PAGE_SIZE,
  noun,
}: {
  basePath: string;
  /** The page's current search params, minus the one being changed. */
  params: Record<string, string | undefined>;
  /** Which query key this pager owns — two tables on one page need two. */
  param: string;
  page: number;
  total: number;
  size?: number;
  noun: string;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  if (pages <= 1) return null;

  const href = (p: number) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v && k !== param) qs.set(k, v);
    }
    if (p > 1) qs.set(param, String(p));
    const s = qs.toString();
    return s ? `${basePath}?${s}` : basePath;
  };

  const first = (page - 1) * size + 1;
  const last = Math.min(total, page * size);

  const linkClass =
    "inline-flex min-h-11 items-center gap-1 rounded-lg border border-border px-3 text-[11px] font-medium uppercase tracking-wider transition-colors hover:bg-muted sm:min-h-9";
  const deadClass =
    "inline-flex min-h-11 items-center gap-1 rounded-lg border border-border px-3 text-[11px] font-medium uppercase tracking-wider opacity-40 sm:min-h-9";

  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs tabular-nums text-muted-foreground">
        {first}–{last} of {formatCount(total)} {noun}
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link href={href(page - 1)} className={linkClass} rel="prev" scroll={false}>
            <ArrowRight className="h-3.5 w-3.5 rotate-180" aria-hidden="true" /> Prev
          </Link>
        ) : (
          <span className={deadClass} aria-hidden="true">
            <ArrowRight className="h-3.5 w-3.5 rotate-180" /> Prev
          </span>
        )}
        {page < pages ? (
          <Link href={href(page + 1)} className={linkClass} rel="next" scroll={false}>
            Next <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        ) : (
          <span className={deadClass} aria-hidden="true">
            Next <ArrowRight className="h-3.5 w-3.5" />
          </span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Money                                                              */
/* ------------------------------------------------------------------ */

export { formatINR };
