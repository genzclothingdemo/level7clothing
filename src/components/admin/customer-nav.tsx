"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/**
 * The four sections of one customer.
 *
 * The detail page used to be a single scroll: six analytics tiles, then
 * contact, then payments, then every order with every line item expanded, then
 * returns, chat, wishlist and cart. On a customer with four orders that is the
 * better part of three screens, and the only way to read their last chat
 * message was to scroll past all of it.
 *
 * Splitting it into routes rather than a `?tab=` does three things a query
 * parameter does not: the URL of a section is a link somebody can paste, the
 * back button steps through sections, and Next re-renders only the section
 * when you switch — the header this bar sits under is a layout and stays put.
 *
 * ── Why this is the one client component here ────────────────────────────────
 *
 * A layout cannot know which of its children is rendering, so "which tab is
 * on" has to be read from the pathname in the browser. Everything else on
 * these screens is server-rendered.
 *
 * Counts are plain numbers. Nothing here takes a component as a prop: passing
 * a lucide icon *component* from a server component into a client one throws
 * at render time and is caught by neither `tsc` nor `next build` — it took
 * this exact page down once (see CLAUDE.md → RSC boundary traps).
 */

export type CustomerNavCounts = {
  orders: number;
  /** Chats + cart entries + wishlist saves + returns. */
  activity: number;
  /** Anything that wants doing — drawn as a dot on Overview, not a number. */
  attention: boolean;
};

/**
 * Payments deliberately carries no count. Its rows are the same orders the
 * Orders tab counts, and two tabs showing "4" for two different things is
 * worse than one of them showing nothing.
 */

const chip =
  "inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 text-[11px] font-medium uppercase tracking-wider transition-colors sm:min-h-9 " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const chipOn = "border-accent bg-accent/10 text-accent";
const chipOff =
  "border-border text-muted-foreground hover:bg-muted hover:text-foreground";

export function CustomerNav({
  base,
  counts,
}: {
  /** `/admin/customers/<id>` — the overview, and the prefix for the rest. */
  base: string;
  counts: CustomerNavCounts;
}) {
  const pathname = usePathname();

  const sections = [
    { href: base, label: "Overview", count: null as number | null, exact: true },
    { href: `${base}/orders`, label: "Orders", count: counts.orders },
    { href: `${base}/payments`, label: "Payments", count: null as number | null },
    { href: `${base}/activity`, label: "Activity", count: counts.activity },
  ];

  return (
    <nav
      aria-label="Customer sections"
      className="flex min-w-0 flex-wrap gap-1 rounded-lg border border-border bg-card p-2"
    >
      {sections.map((s) => {
        // `exact` on Overview: its href is a prefix of all three others, so a
        // `startsWith` match would light it up on every section.
        const on = s.exact ? pathname === s.href : pathname.startsWith(s.href);
        return (
          <Link
            key={s.href}
            href={s.href}
            aria-current={on ? "page" : undefined}
            className={cn(chip, on ? chipOn : chipOff)}
          >
            {s.label}
            {s.count !== null && (
              <span
                className={cn(
                  "rounded px-1 text-[10px] tabular-nums",
                  on ? "bg-accent/20" : "bg-muted"
                )}
              >
                {s.count}
              </span>
            )}
            {s.exact && counts.attention && (
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                aria-label="Something needs attention"
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
