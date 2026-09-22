/**
 * The two shelves on /portfolio, as links rather than client state.
 *
 * Deliberately server-rendered `<Link>`s, not `useState` tabs: each view is a
 * real, shareable, crawlable URL, the page keeps working without JavaScript,
 * and switching shelf resets pagination for free because the href simply
 * omits `page`. The account page's tab bar is client state because its tabs
 * are private; these are not.
 *
 * `role="tablist"` is *not* used here on purpose — these are navigations, not
 * panel switches, and announcing a link as a tab lies to a screen reader
 * about what pressing it does.
 */

import Link from "next/link";
import { LinkPendingOverlay } from "@/components/store/link-pending";
import type { PortfolioView } from "@/lib/portfolio";
import { cn } from "@/lib/utils";

/* Squared, uppercase, wide-tracked; colour change only — no lift, no shadow.
 *
 * The `!` on the border colours is load-bearing. `globals.css` sets
 * `* { border-color: var(--border) }` outside any cascade layer, and unlayered
 * rules outrank Tailwind's `@layer utilities` — so a plain `border-accent`
 * silently renders as the default hairline. See the same note in
 * `pagination.tsx`. */
const CHIP =
  "relative overflow-hidden inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-4 text-[11px] font-medium uppercase tracking-[0.14em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const ON = "border-accent! bg-accent text-accent-foreground";
const OFF = "border-border text-muted-foreground hover:border-accent! hover:text-accent";

const TABS: { view: PortfolioView; label: string; href: string }[] = [
  // Page 1 of the default shelf is the bare URL, so it has exactly one
  // address rather than two — the same rule `pagination.tsx` follows.
  { view: "products", label: "From our products", href: "/portfolio" },
  { view: "other", label: "Everything else", href: "/portfolio?view=other" },
];

export function PortfolioTabs({
  view,
  counts,
}: {
  view: PortfolioView;
  counts: Record<PortfolioView, number>;
}) {
  return (
    <nav
      aria-label="Portfolio sections"
      // Scrolls rather than wraps at 320px, and the gutter keeps the last
      // chip clear of the screen edge.
      className="no-scrollbar -mx-5 mt-8 flex gap-2 overflow-x-auto px-5 sm:mx-0 sm:justify-center sm:px-0"
    >
      {TABS.map((tab) => {
        const active = tab.view === view;
        return (
          <Link
            key={tab.view}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(CHIP, "shrink-0", active ? ON : OFF)}
          >
            {tab.label}
            <span className="tabular-nums opacity-70">{counts[tab.view]}</span>
            {!active && <LinkPendingOverlay />}
          </Link>
        );
      })}
    </nav>
  );
}
