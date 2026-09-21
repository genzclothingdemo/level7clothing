"use client";

/**
 * finance-nav — the sub-navigation and the time-range control.
 *
 * Both live in one bar above everything they scope, which is the rule that
 * matters here: a per-chart date picker lets two panels on one screen answer
 * different questions while looking like they answer the same one. One range,
 * one URL, every figure below it.
 *
 * The range is a query parameter rather than a cookie or component state for
 * three reasons: a view can be pasted into a message and reopen identically,
 * the back button behaves, and the server component can read it directly from
 * `searchParams` without a round trip through the client.
 *
 * This is the only client component on the Finance screens.
 */

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarRange } from "lucide-react";
import { FINANCE_RANGES, DEFAULT_RANGE } from "@/lib/analytics";
import { InfoTip } from "@/components/store/info-tip";
import { cn } from "@/lib/utils";

/**
 * `exact` on the first tab only: `/admin/finance` is a prefix of both the
 * others, so a `startsWith` match would light Money up on every sub-route.
 */
const TABS: { href: string; label: string; exact?: boolean }[] = [
  { href: "/admin/finance", label: "Money", exact: true },
  { href: "/admin/finance/products", label: "Products" },
  { href: "/admin/finance/demand", label: "Demand" },
];

export function FinanceNav() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const range = params.get("range") ?? DEFAULT_RANGE;

  /**
   * Changing the range resets every table's page number. Keeping `p` would
   * leave the reader on page 4 of a list that is now two pages long — the URL
   * would be honest and the screen would look broken.
   */
  function setRange(value: string) {
    const next = new URLSearchParams();
    if (value !== DEFAULT_RANGE) next.set("range", value);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  /** Tabs carry the range across, so switching view never resets the period. */
  function tabHref(href: string) {
    return range !== DEFAULT_RANGE ? `${href}?range=${range}` : href;
  }

  return (
    <div className="rounded-lg border border-border bg-card p-2">
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="Finance views" className="flex min-w-0 flex-wrap gap-1">
          {TABS.map((t) => {
            const on = t.exact ? pathname === t.href : pathname.startsWith(t.href);
            return (
              <Link
                key={t.href}
                href={tabHref(t.href)}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center rounded-lg border px-3 text-[11px] font-medium uppercase tracking-wider transition-colors sm:min-h-9",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  on
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex min-w-0 items-center gap-1.5">
          <CalendarRange
            className="hidden h-3.5 w-3.5 shrink-0 text-muted-foreground sm:block"
            aria-hidden="true"
          />
          <div
            role="radiogroup"
            aria-label="Time range"
            className="flex min-w-0 flex-wrap gap-1"
          >
            {FINANCE_RANGES.map((r) => {
              const on = range === r.value;
              return (
                <button
                  key={r.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setRange(r.value)}
                  className={cn(
                    "inline-flex min-h-11 cursor-pointer items-center rounded-lg border px-2.5 text-[11px] font-medium uppercase tracking-wider transition-colors sm:min-h-9",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                    on
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  {r.label}
                </button>
              );
            })}
          </div>
          <InfoTip term="Time range">
            Filters every figure on this screen by when the order was placed, in
            a half-open window ending now — so two adjacent periods never
            double-count and their totals add up. Refunds are the exception:
            they are dated by when the money left, which is stated wherever they
            appear. Days start at midnight IST.
          </InfoTip>
        </div>
      </div>
    </div>
  );
}
