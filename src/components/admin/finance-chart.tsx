/**
 * finance-chart — the three chart forms this dashboard needs, in plain HTML.
 *
 * ── Why no chart library, and no SVG ─────────────────────────────────────────
 *
 * Every chart here is a magnitude comparison against a zero baseline, which
 * HTML and CSS draw natively. Two consequences that matter more than elegance:
 *
 * - **It renders on the server.** No hydration, no bundle, nothing to wait for
 *   on an admin screen that is already one database round trip from Mumbai.
 * - **Text stays text.** An SVG scaled to fit a 320px phone scales its labels
 *   with it; CSS type does not, so a bar chart that is legible on a laptop is
 *   still legible in a hand.
 *
 * ── The rules these components enforce so callers cannot break them ──────────
 *
 * 1. **Zero baseline, always.** Bar length is `value ÷ axis max`, and the axis
 *    max is a rounded number at or above the largest value. A truncated axis
 *    exaggerates differences, which is the single most common way a chart
 *    lies.
 * 2. **One hue.** These are nominal categories (products, payment methods,
 *    days), so every bar is the brand accent violet. Colouring bars by their
 *    own value would re-encode the length as hue and spend the only free
 *    channel saying what the bar already said. There is no second series
 *    anywhere on these screens, so there is no legend either — the title names
 *    what is plotted.
 * 3. **No dual axes.** Two measures of different scale get two charts. The
 *    components take one measure each; the second number rides along as text.
 * 4. **Every value is reachable as text.** The bar lists print their own
 *    values; the column chart ships a `<details>` table twin. A tooltip never
 *    gates a number.
 *
 * ── Colour, checked rather than eyeballed ────────────────────────────────────
 *
 * Marks are `var(--accent)`: `#7c3aed` on the light card `#ffffff` (5.70:1) and
 * `#a78bfa` on the dark card `#131316` (6.81:1) — both clear of the 3:1 floor
 * for chart marks, measured with the data-viz validator's `contrast()` rather
 * than guessed. Gridlines are `--border` at ~1.26:1, recessive by design: a
 * gridline that competes with the data is noise. Both accent values are fixed
 * by the design system (CLAUDE.md) and must not be renamed or re-stepped.
 *
 * ── Tooltips ─────────────────────────────────────────────────────────────────
 *
 * Hover detail is the native `title` attribute. A styled bubble would have to
 * be absolutely positioned, and at 320px a bubble on the last column overflows
 * the card and reintroduces the horizontal page scroll this admin is explicitly
 * required not to have. `title` costs no JavaScript, cannot overflow, and the
 * table twin carries every value for touch and assistive tech — so the tooltip
 * enhances and never gates.
 */

import { cn } from "@/lib/utils";
import { TableScroll } from "@/components/admin/form-kit";
import { Empty } from "@/components/admin/finance-ui";

/* ------------------------------------------------------------------ */
/*  Axis                                                               */
/* ------------------------------------------------------------------ */

/**
 * The smallest "clean" number at or above `v` — 1, 2, 2.5 or 5 times a power
 * of ten. Bars are measured against this rather than against the largest
 * value, so the tallest bar does not always touch the ceiling and the axis
 * label is a number a person can hold in their head.
 */
function niceCeil(v: number): number {
  if (!Number.isFinite(v) || v <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(v));
  for (const step of [1, 2, 2.5, 5, 10]) {
    const candidate = step * magnitude;
    if (candidate >= v) return candidate;
  }
  return 10 * magnitude;
}

/**
 * Keep a label inside the plot box. A label centred on the last column of a
 * 320px chart hangs off the right edge and takes the page's horizontal scroll
 * with it, so the two end positions anchor to the edge instead of centring.
 */
function anchor(index: number, count: number): {
  style: React.CSSProperties;
  className: string;
} {
  const centre = ((index + 0.5) / Math.max(1, count)) * 100;
  if (centre < 12) return { style: { left: 0 }, className: "" };
  if (centre > 88) return { style: { right: 0 }, className: "" };
  return { style: { left: `${centre}%` }, className: "-translate-x-1/2" };
}

/* ------------------------------------------------------------------ */
/*  Column chart — a measure over time                                 */
/* ------------------------------------------------------------------ */

/** Named `ChartColumn`, not `Column`: `finance-table` exports a `Column` too, and
 *  two different shapes under one name in sibling modules is a trap. */
export type ChartColumn = {
  key: string;
  label: string;
  value: number;
  /** Extra facts for the hover title and the table twin. */
  detail?: string;
};

export function ColumnChart({
  columns,
  formatValue,
  /** Names the measure, e.g. "Net revenue". Used in the accessible summary. */
  measure,
  /** What one column covers — "day", "week", "month". */
  unit,
  emptyText = "No orders in this period.",
  tableHead,
}: {
  columns: ChartColumn[];
  formatValue: (n: number) => string;
  measure: string;
  unit: string;
  emptyText?: string;
  /** Column headings for the table twin: [period, value, detail?]. */
  tableHead: [string, string, string?];
}) {
  if (columns.length === 0) return <Empty>{emptyText}</Empty>;

  const peakValue = Math.max(...columns.map((c) => c.value));
  const axisMax = niceCeil(peakValue);
  const peakIndex = columns.findIndex((c) => c.value === peakValue);
  const total = columns.reduce((n, c) => n + c.value, 0);

  // Which x positions get a label. First, last and the peak — never every
  // column, which at 30 bars is a wall of grey text nobody reads.
  const labelled = [...new Set([0, peakIndex, columns.length - 1])]
    .filter((i) => i >= 0)
    .sort((a, b) => a - b);

  const summary =
    peakValue > 0
      ? `${measure} by ${unit}, ${columns.length} ${unit}s totalling ${formatValue(total)}. Peak ${formatValue(peakValue)} on ${columns[peakIndex].label}.`
      : `${measure} by ${unit}: nothing recorded across ${columns.length} ${unit}s.`;

  return (
    <figure className="m-0">
      {/* Plot. `relative` + absolutely positioned rules keeps the bars on one
          shared baseline without a grid or a table getting involved. */}
      <div className="relative h-40 w-full sm:h-48" role="img" aria-label={summary}>
        {/* Gridlines: hairline, solid, one step off the surface. Never dashed —
            dashing reads as "threshold" when it is only a grid. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-border" />
        <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-border" />

        {/* Axis maximum, inside the plot so no left gutter is needed at 320px. */}
        <span className="pointer-events-none absolute right-0 top-0 -translate-y-1/2 bg-card pl-1 text-[10px] tabular-nums text-muted-foreground">
          {formatValue(axisMax)}
        </span>

        <div className="absolute inset-0 flex items-end gap-[2px]">
          {columns.map((c, i) => {
            const pct = axisMax > 0 ? (c.value / axisMax) * 100 : 0;
            return (
              <div
                key={c.key}
                // The whole column height is the hover target, so a near-zero
                // bar is not a pinpoint you have to land on.
                className="flex h-full min-w-0 flex-1 items-end justify-center"
                title={`${c.label}: ${formatValue(c.value)}${c.detail ? ` · ${c.detail}` : ""}`}
              >
                {c.value > 0 && (
                  <span
                    // 4px rounded data-end, square at the baseline; capped at
                    // 24px so a 7-bar chart does not become seven slabs.
                    className="block w-full max-w-6 rounded-t-[4px] bg-accent"
                    // `max()` guarantees a visible mark for a real but tiny
                    // value, without inventing height for a zero.
                    style={{ height: `max(2px, ${pct}%)` }}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Baseline last, so it sits over the foot of every bar. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 border-t border-border" />
      </div>

      {/* Selective direct labels. */}
      <div className="relative mt-1 h-4">
        {labelled.map((i) => {
          const a = anchor(i, columns.length);
          return (
            <span
              key={columns[i].key}
              style={a.style}
              className={cn(
                "absolute top-0 whitespace-nowrap text-[10px] text-muted-foreground",
                a.className
              )}
            >
              {columns[i].label}
            </span>
          );
        })}
      </div>

      <figcaption className="mt-2 text-xs text-muted-foreground">
        {peakValue > 0 ? (
          <>
            Peak{" "}
            <span className="tabular-nums text-foreground">{formatValue(peakValue)}</span> on{" "}
            {columns[peakIndex].label} · {columns.length} {unit}
            {columns.length === 1 ? "" : "s"}, total{" "}
            <span className="tabular-nums text-foreground">{formatValue(total)}</span>
          </>
        ) : (
          <>Nothing recorded across {columns.length} {unit}s.</>
        )}
      </figcaption>

      {/* The table twin. Every value, in text, for touch, keyboard and AT. */}
      <details className="mt-2 group">
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-[11px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground sm:min-h-9">
          Show as table
        </summary>
        <TableScroll className="mt-1">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-left">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">{tableHead[0]}</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">{tableHead[1]}</th>
                {tableHead[2] && (
                  <th scope="col" className="px-3 py-2 text-right font-medium">{tableHead[2]}</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {columns.map((c) => (
                <tr key={c.key}>
                  <th scope="row" className="whitespace-nowrap px-3 py-1.5 text-left font-normal">
                    {c.label}
                  </th>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatValue(c.value)}</td>
                  {tableHead[2] && (
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
                      {c.detail ?? "—"}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </details>
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/*  Ranked bars — magnitude across nominal categories                  */
/* ------------------------------------------------------------------ */

export type BarRow = {
  key: string;
  label: string;
  value: number;
  /** The value as the reader should see it — money, a count, a percentage. */
  valueLabel: string;
  /** One muted line under the bar: the second measure, a caveat, a status. */
  sub?: React.ReactNode;
};

/**
 * Label and value on one line, the bar underneath at full width.
 *
 * Laid out this way rather than as a three-column table because a long product
 * name in a narrow label column either truncates to uselessness or squeezes the
 * bar to nothing at 320px. Stacked, the label gets the whole width and the bar
 * keeps its full scale on any screen — so this form needs no mobile variant and
 * no horizontal scroll. The printed value means the list is already its own
 * table view.
 */
export function RankBars({
  rows,
  emptyText = "Nothing to show for this period.",
  max,
}: {
  rows: BarRow[];
  emptyText?: string;
  /** Override the axis maximum to compare two lists on one scale. */
  max?: number;
}) {
  if (rows.length === 0) return <Empty>{emptyText}</Empty>;

  const axisMax = niceCeil(max ?? Math.max(...rows.map((r) => r.value), 0));

  return (
    <ul className="space-y-2.5">
      {rows.map((r) => {
        const pct = axisMax > 0 ? Math.max(0, (r.value / axisMax) * 100) : 0;
        return (
          <li key={r.key} className="min-w-0">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="min-w-0 truncate" title={r.label}>
                {r.label}
              </span>
              <span className="shrink-0 tabular-nums">{r.valueLabel}</span>
            </div>
            {/* The track is the plot area; the fill is the mark. Both start at
                zero on the left, so lengths are comparable across rows. */}
            <div className="mt-1 h-2 w-full rounded-sm bg-muted" aria-hidden="true">
              {r.value > 0 && (
                <span
                  className="block h-2 rounded-r-[4px] bg-accent"
                  style={{ width: `max(2px, ${pct}%)` }}
                />
              )}
            </div>
            {r.sub && (
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{r.sub}</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/*  Meter — one ratio against a limit                                  */
/* ------------------------------------------------------------------ */

/**
 * A single share of a known whole. A two-slice pie would be the wrong form
 * and a one-bar bar chart the wrong form twice, so this is a meter: the track
 * is a lighter step of the fill's own hue, which keeps the whole bar reading
 * as one quantity rather than as two competing categories.
 */
export function Meter({
  value,
  limit,
  valueLabel,
  limitLabel,
  caption,
}: {
  value: number;
  limit: number;
  valueLabel: string;
  limitLabel: string;
  caption?: React.ReactNode;
}) {
  const pct = limit > 0 ? Math.min(100, Math.max(0, (value / limit) * 100)) : 0;
  const shown = limit > 0 ? Math.round(pct) : 0;

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="text-xl font-medium">{valueLabel}</span>
        <span className="text-xs text-muted-foreground">
          of <span className="tabular-nums">{limitLabel}</span> billed
        </span>
      </div>
      <div
        className="mt-2 h-3 w-full overflow-hidden rounded-full bg-accent/15"
        role="meter"
        aria-valuenow={shown}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${valueLabel} collected of ${limitLabel} billed`}
      >
        <span className="block h-3 rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1.5 text-xs text-muted-foreground">
        <span className="tabular-nums text-foreground">{shown}%</span> collected
        {caption ? <> · {caption}</> : null}
      </p>
    </div>
  );
}
