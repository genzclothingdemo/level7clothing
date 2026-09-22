"use client";

/**
 * finance-nav — the section tabs and the filter row for the whole analytics
 * workspace.
 *
 * Both live in one bar above everything they scope, which is the rule that
 * matters here: a per-chart date picker lets two panels on one screen answer
 * different questions while looking like they answer the same one. One range,
 * one URL, every figure below it.
 *
 * The range and the bucket size are query parameters rather than cookies or
 * component state for three reasons: a view can be pasted into a message and
 * reopen identically, the back button behaves, and the server component can
 * read them straight out of `searchParams` without a round trip through the
 * client.
 *
 * **Overview lives at `/admin`, not under `/admin/finance`.** It is the admin
 * panel's index page and cannot be moved, so the first tab points there and
 * the rest are sub-routes. That is the only asymmetry; everything else about
 * the six sections is identical, which is why the chrome is one component
 * (`dash-workspace`) rendered by both the index page and the finance layout.
 *
 * This and the `InfoTip` bubbles are the only client JavaScript on these
 * screens.
 */

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarRange, BarChart3 } from "lucide-react";
import { FINANCE_RANGES, DEFAULT_RANGE, GRANULARITIES } from "@/lib/analytics";
import { InfoTip } from "@/components/store/info-tip";
import { cn } from "@/lib/utils";

/**
 * `exact` where a route is a prefix of its siblings: `/admin` is a prefix of
 * every admin page and `/admin/finance` of every other section, so a
 * `startsWith` match on either would light them up everywhere.
 */
export const SECTIONS: { href: string; label: string; exact?: boolean }[] = [
  { href: "/admin", label: "Overview", exact: true },
  { href: "/admin/finance/sales", label: "Sales" },
  { href: "/admin/finance/products", label: "Products" },
  { href: "/admin/finance/customers", label: "Customers" },
  { href: "/admin/finance/fulfilment", label: "Fulfilment" },
  { href: "/admin/finance", label: "Finance", exact: true },
];

/** Bucket size only means anything where there is a time series to bucket. */
const GRAIN_ROUTES = new Set(["/admin", "/admin/finance/sales"]);

const chip =
  "inline-flex min-h-11 items-center rounded-lg border px-3 text-[11px] font-medium uppercase tracking-wider transition-colors sm:min-h-9 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const chipOn = "border-accent bg-accent/10 text-accent";
const chipOff = "border-border text-muted-foreground hover:bg-muted hover:text-foreground";

export function WorkspaceNav() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const range = params.get("range") ?? DEFAULT_RANGE;
  const grain = params.get("grain") ?? "auto";
  const showGrain = GRAIN_ROUTES.has(pathname);

  /**
   * Changing a filter resets every table's page number. Keeping `p` would
   * leave the reader on page 4 of a list that is now two pages long — the URL
   * would be honest and the screen would look broken.
   */
  function setParam(key: string, value: string, fallback: string) {
    const next = new URLSearchParams();
    for (const [k, v] of [
      ["range", range],
      ["grain", grain],
    ] as const) {
      if (k === key) continue;
      if (k === "range" && v !== DEFAULT_RANGE) next.set(k, v);
      if (k === "grain" && v !== "auto") next.set(k, v);
    }
    if (value !== fallback) next.set(key, value);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  /** Tabs carry the filters across, so switching section never resets them. */
  function tabHref(href: string) {
    const qs = new URLSearchParams();
    if (range !== DEFAULT_RANGE) qs.set("range", range);
    if (grain !== "auto") qs.set("grain", grain);
    const s = qs.toString();
    return s ? `${href}?${s}` : href;
  }

  return (
    <div className="space-y-2">
      <nav
        aria-label="Analytics sections"
        className="flex min-w-0 flex-wrap gap-1 rounded-lg border border-border bg-card p-2"
      >
        {SECTIONS.map((t) => {
          const on = t.exact ? pathname === t.href : pathname.startsWith(t.href);
          return (
            <Link
              key={t.href}
              href={tabHref(t.href)}
              aria-current={on ? "page" : undefined}
              className={cn(chip, on ? chipOn : chipOff)}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-card p-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <CalendarRange
            className="hidden h-3.5 w-3.5 shrink-0 text-muted-foreground sm:block"
            aria-hidden="true"
          />
          <div role="radiogroup" aria-label="Time range" className="flex min-w-0 flex-wrap gap-1">
            {FINANCE_RANGES.map((r) => {
              const on = range === r.value;
              return (
                <button
                  key={r.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setParam("range", r.value, DEFAULT_RANGE)}
                  className={cn(chip, "cursor-pointer px-2.5", on ? chipOn : chipOff)}
                >
                  {r.label}
                </button>
              );
            })}
          </div>
          <InfoTip term="Time range">
            Filters every figure on this screen by when the order was placed, in
            a half-open window ending now — so two adjacent periods never
            double-count and their totals add up. Two things are deliberately
            outside it: refunds, dated by when the money left, and the
            lifetime customer figures, which are all-time. Both say so where
            they appear. Days start at midnight IST.
          </InfoTip>
        </div>

        {showGrain && (
          <div className="flex min-w-0 items-center gap-1.5 sm:ml-auto">
            <BarChart3
              className="hidden h-3.5 w-3.5 shrink-0 text-muted-foreground sm:block"
              aria-hidden="true"
            />
            <div role="radiogroup" aria-label="Bucket size" className="flex min-w-0 flex-wrap gap-1">
              {GRANULARITIES.map((g) => {
                const on = grain === g.value;
                return (
                  <button
                    key={g.value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setParam("grain", g.value, "auto")}
                    className={cn(chip, "cursor-pointer px-2.5", on ? chipOn : chipOff)}
                  >
                    {g.label}
                  </button>
                );
              })}
            </div>
            <InfoTip term="Bucket size">
              How much time one bar of the trend chart covers. Auto picks from
              the span so the chart lands at roughly 7–35 bars — fewer and the
              shape is noise, more and they are hairlines. A choice that would
              draw more than 120 bars is overruled back to Auto, and the chart
              says so rather than quietly disobeying.
            </InfoTip>
          </div>
        )}
      </div>
    </div>
  );
}
