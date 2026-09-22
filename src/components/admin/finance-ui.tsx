/**
 * finance-ui — the furniture of the Admin → Dashboard analytics workspace.
 *
 * **Server components.** Nothing here is interactive, so nothing here ships
 * JavaScript; the only client island on these screens is the section/filter bar
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
import {
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CheckCircle2,
  Minus,
} from "lucide-react";
import { InfoTip } from "@/components/store/info-tip";
import { Disclosure } from "@/components/store/disclosure";
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
 *
 * **There is no `subtitle`, on purpose.** Every panel used to print one, and on
 * Overview the trend chart's ran to three lines of prose about IST midnight and
 * refund dating *above the chart* — words competing with the figure they
 * describe, on every visit, forever. The prose is not gone: `note` puts it in
 * the same (i) as the definition, under a rule. One tap, nothing printed.
 */
export function Panel({
  title,
  tip,
  note,
  aside,
  children,
  className,
}: {
  title: string;
  /** The definition — what the figure in this panel actually measures. */
  tip?: React.ReactNode;
  /**
   * Scope, caveats and cross-references: what used to be the subtitle. Appended
   * to the same (i) bubble under a hairline, and never rendered on the page.
   */
  note?: React.ReactNode;
  /** Pinned right of the title — a badge, a `PanelLink`, a count. */
  aside?: React.ReactNode;
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
          {(tip || note) && (
            <InfoTip term={title}>
              {tip}
              {note && (
                // `span`, not `div` — InfoTip's body is a `<span>`, and a block
                // element inside it is invalid HTML that React will hydrate
                // differently from the server render.
                <span className={cn("block", tip && "mt-2 border-t border-border pt-2")}>
                  {note}
                </span>
              )}
            </InfoTip>
          )}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/**
 * The "view more" an owner asked for, as a panel's `aside`: one uppercase link
 * to the section that has the detail behind this panel's figures.
 *
 * It replaces the sentence that used to sit under several panels — "Customers
 * has the segments and the cohort retention behind these" — which was a
 * paragraph doing a link's job.
 */
export function PanelLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex min-h-8 shrink-0 items-center gap-1 rounded-lg text-[11px] font-medium uppercase tracking-wider text-accent transition-colors hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      )}
    >
      {children}
      <ArrowRight className="h-3 w-3 shrink-0" aria-hidden="true" />
    </Link>
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
  note,
  delta,
  deltaLabel,
  good = "up",
  sub,
  emphasis,
  bare,
}: {
  label: string;
  value: string;
  /** The metric's definition. Comes from `METRIC` — never written inline. */
  tip: React.ReactNode;
  /** Scope and caveats, appended to the same (i) under a rule. Never printed. */
  note?: React.ReactNode;
  /** Signed percent vs the previous window; `null` renders nothing. */
  delta?: number | null;
  /** Names the period being compared against, e.g. "vs previous 30 days". */
  deltaLabel?: string;
  good?: GoodDirection;
  /**
   * One short line under the value — a count behind the money, never a
   * sentence. Typed as `string` and rendered `truncate` on purpose: a row of
   * four tiles each carrying a wrapped clause is four small paragraphs, which
   * is what this row used to be. Anything longer belongs in `note`.
   */
  sub?: string;
  /** The one tile a view leads with. Exactly one per screen. */
  emphasis?: boolean;
  /**
   * No border, no surface, no padding — for tiles nested inside a `Panel`,
   * where a bordered card on a card is a box drawn around nothing.
   *
   * Named `bare`, not `flat`: `flat` is already taken below for a delta of
   * zero, and two meanings of one word inside forty lines is how a styling
   * prop ends up silently reading a statistic.
   */
  bare?: boolean;
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
        "min-w-0",
        !bare && "rounded-2xl border border-border bg-card p-4",
        // The headline number takes the full width of a two-column phone grid.
        // At 320px a tile is ~140px, and a figure like ₹12,34,567 set at 30px
        // does not fit in that — it would wrap mid-number, which is worse than
        // any layout problem it solves.
        emphasis && "col-span-2 lg:col-span-1"
      )}
    >
      <div className="flex items-start gap-1">
        <p className="eyebrow min-w-0 break-words">{label}</p>
        <InfoTip term={label}>
          {tip}
          {note && (
            <span className="mt-2 block border-t border-border pt-2">{note}</span>
          )}
        </InfoTip>
      </div>
      <p
        className={cn(
          "mt-1.5 font-medium leading-tight break-words",
          emphasis ? "text-3xl sm:text-4xl" : bare ? "text-xl" : "text-2xl"
        )}
      >
        {value}
      </p>
      {showDelta && (
        <p className={cn("mt-1 flex items-center gap-1 text-xs", tone)}>
          <Arrow className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="tabular-nums">{formatDelta(delta ?? null)}</span>
          {deltaLabel && <span className="truncate text-muted-foreground">{deltaLabel}</span>}
        </p>
      )}
      {sub && (
        // One line, clipped. `title` keeps the whole string reachable on hover
        // for the rare case where a count and its noun do not fit.
        <p className="mt-1 truncate text-xs text-muted-foreground" title={sub}>
          {sub}
        </p>
      )}
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
/*  Degraded banner                                                    */
/* ------------------------------------------------------------------ */

/**
 * "A query failed, so a figure you are about to act on may be wrong."
 *
 * One line, because it is a banner and not an essay — the distinction between a
 * reporting failure and a business one is the whole message and it is behind
 * the (i). It lived as a near-identical three-line paragraph in five of the six
 * sections, which is five chances for the wording to drift.
 */
export function Degraded() {
  return (
    <p className="flex flex-wrap items-center gap-x-1 rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-xs text-danger">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="font-medium">A query failed — some figures may read zero.</span>
      <InfoTip term="Query failed">
        This is a reporting failure, not a business one: the database could not
        be reached for at least one panel, and a panel that fails reads as zero
        rather than as an error. Check the database connection before acting on
        anything on this screen — in particular, do not read an empty chart as a
        quiet week.
      </InfoTip>
    </p>
  );
}

/* ------------------------------------------------------------------ */
/*  Caveat                                                             */
/* ------------------------------------------------------------------ */

/**
 * A stated limitation — kept in full, and closed.
 *
 * It used to print three or four lines of prose at the foot of a panel. Every
 * one of them is true on the first visit and on the four-hundredth, so on an
 * operational screen they are permanent furniture: the reader stops seeing
 * them, and meanwhile they are the tallest thing under several panels.
 *
 * So the text is unchanged and the default is closed. One 44px row states that
 * there is a caveat and names what kind; the sentences are one tap away. This
 * is the same trade `NotMeasured` already makes, for the same reason.
 *
 * Deliberately still not an admonition box with an icon and a colour: none of
 * these is an error, and dressing a measurement note in danger red teaches the
 * reader to dismiss it.
 */
export function Caveat({
  label = "How to read this",
  children,
}: {
  /** Names the kind of caveat, so a closed row is still informative. */
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-2 border-t border-border/60">
      <Disclosure label={label}>
        <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>
      </Disclosure>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Percentages                                                        */
/* ------------------------------------------------------------------ */

/**
 * `12.4%` / `—`. One decimal below 10, whole numbers above, because the extra
 * digit on "47.3%" implies a precision that a denominator of nineteen orders
 * does not have.
 */
export function formatPercent(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  return `${abs < 10 ? Math.round(v * 10) / 10 : Math.round(v)}%`;
}

/* ------------------------------------------------------------------ */
/*  What this cannot tell you                                          */
/* ------------------------------------------------------------------ */

/**
 * The honest blank, rendered from `NOT_MEASURED` in `lib/analytics`.
 *
 * It is a list of *absences*, so it is deliberately plain text rather than a
 * warning box: none of these is an error, and dressing them in danger red
 * would train the reader to dismiss the panel that is doing the most useful
 * work on the screen. Each row names the one change that would make the figure
 * real, which is what turns the list into a roadmap rather than an apology.
 */
export function NotMeasured({
  rows,
}: {
  rows: { metric: string; why: string; toGetIt: string }[];
}) {
  if (rows.length === 0) return null;
  return (
    // Collapsed by default. The content is worth keeping in full — it is the
    // panel doing the most useful work here — but it is read ONCE and then
    // never changes, and expanded it ran to roughly 950 words on Overview:
    // longer than every live figure on the screen put together, sitting under
    // numbers that change every day. A closed row states how many absences
    // there are, which is the part worth seeing on every visit.
    <Disclosure
      label={`${rows.length} figure${rows.length === 1 ? "" : "s"} this screen deliberately does not show`}
      summary="Read why"
    >
      <ul className="divide-y divide-border">
        {rows.map((row) => (
          <li key={row.metric} className="py-3 first:pt-0 last:pb-0">
            <p className="text-sm font-medium">{row.metric}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{row.why}</p>
            <p className="mt-1.5 text-xs leading-relaxed">
              <span className="eyebrow">To measure it</span>{" "}
              <span className="text-muted-foreground">{row.toGetIt}</span>
            </p>
          </li>
        ))}
      </ul>
    </Disclosure>
  );
}

/* ------------------------------------------------------------------ */
/*  Work queue                                                         */
/* ------------------------------------------------------------------ */

/**
 * The Overview's work queue, as a strip at the top of the page.
 *
 * It used to be a half-width panel of eight two-line rows, sitting below the
 * headline tiles and a full-width trend chart — roughly 1,100px down. That is
 * the wrong order. Revenue is a report you *consult*; this is work you
 * *clear*, and it is the only thing on the screen with an action behind it.
 * An owner opening the admin at nine in the morning is asking "what do I have
 * to do today", and the answer was below the fold.
 *
 * Each row is now a chip: the count, a two-word noun, and a link. The
 * "why it matters" sentences that used to sit under every row are gone rather
 * than moved — they are onboarding text, true on every visit forever, and the
 * screen each chip links to explains itself far better than a sentence here
 * can. What is NOT dropped is the count and the destination, which is the
 * whole job of this strip.
 */
export function WorkQueue({
  rows,
}: {
  rows: {
    count: number;
    short: string;
    /** Singular form, where the plural would read as "1 reviews to approve". */
    one?: string;
    href: string;
    tone?: "neutral" | "alert";
  }[];
}) {
  if (rows.length === 0) {
    return (
      <p className="flex min-h-11 items-center gap-2 rounded-2xl border border-success/40 bg-success/5 px-4 text-sm text-success">
        <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
        Nothing is waiting — every queue in the store is empty.
      </p>
    );
  }

  const total = rows.reduce((n, r) => n + r.count, 0);

  return (
    <section className="rounded-2xl border border-border bg-card p-3 sm:p-4">
      <div className="mb-2.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h2 className="flex items-center gap-1 font-serif text-lg leading-none">
          Needs attention
          <InfoTip term="Needs attention">
            Everything currently sitting in a queue, across the whole store.
            Deliberately <strong className="font-medium">not</strong> filtered
            by the time range above: an order that has been waiting a month to
            be confirmed is more urgent than one placed this morning, and
            scoping this to the last 30 days would hide exactly the rows that
            matter. Each chip links to the screen where you can clear it.
          </InfoTip>
        </h2>
        <p className="text-xs text-muted-foreground">
          {formatCount(total)} item{total === 1 ? "" : "s"} across{" "}
          {rows.length} queue{rows.length === 1 ? "" : "s"} · right now, not this period
        </p>
      </div>
      <ul className="flex flex-wrap gap-2">
        {rows.map((r) => (
          <li key={r.short}>
            <Link
              href={r.href}
              className={cn(
                "flex min-h-11 items-center gap-1.5 rounded-lg border px-3 transition-colors",
                r.tone === "alert"
                  ? "border-danger/40 bg-danger/5 text-danger hover:bg-danger/10"
                  : "border-border hover:bg-muted"
              )}
            >
              <span className="text-base font-medium leading-none tabular-nums">
                {formatCount(r.count)}
              </span>
              <span className="text-xs leading-none">
                {r.count === 1 && r.one ? r.one : r.short}
              </span>
              <ArrowRight className="h-3 w-3 shrink-0 opacity-50" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
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
