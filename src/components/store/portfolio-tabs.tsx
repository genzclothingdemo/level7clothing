/**
 * The shelf nav on /portfolio, as links rather than client state.
 *
 * This used to be two tabs — "From our products" and "Everything else" — which
 * is the split that made the page a second shop. It is now one chip per
 * section of the brand page, plus an "All" chip that is the canonical address.
 *
 * ── Why links and not `useState` ─────────────────────────────────────────────
 *
 * Each narrowing is a real, shareable, crawlable URL, the page keeps working
 * without JavaScript, and there is nothing to hydrate. The account page's tab
 * bar is client state because its tabs are private; these are not.
 *
 * `role="tablist"` is *not* used here on purpose — these are navigations, not
 * panel switches, and announcing a link as a tab lies to a screen reader about
 * what pressing it does.
 *
 * ── Why the labels are props ─────────────────────────────────────────────────
 *
 * They come from `PORTFOLIO_SECTION_META` in `lib/portfolio.ts`, which imports
 * Prisma. Reading them here would be fine today (this is a server component)
 * and would break the day somebody adds an `onClick` — so the page resolves
 * them and passes plain strings, and this file has no import that could ever
 * drag the database client into a browser bundle.
 */

import Link from "next/link";
import { LinkPendingOverlay } from "@/components/store/link-pending";
import { cn } from "@/lib/utils";

/* Squared, uppercase, wide-tracked; colour change only — no lift, no shadow.
 *
 * The `!` on the border colours is kept from the version this replaces: it
 * guards against `globals.css`'s `* { border-color: var(--border) }`, which is
 * inside `@layer base` today but has escaped that layer twice before (see the
 * CSS cascade note in CLAUDE.md). It costs nothing and the failure it prevents
 * is silent. */
const CHIP =
  "relative overflow-hidden inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-4 text-[11px] font-medium uppercase tracking-[0.14em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

const ON = "border-accent! bg-accent text-accent-foreground";
const OFF = "border-border text-muted-foreground hover:border-accent! hover:text-accent";

export type PortfolioNavItem = {
  /** `null` is the "All" chip — the bare `/portfolio` URL. */
  id: string | null;
  label: string;
  count: number;
};

export function PortfolioTabs({
  items,
  active,
}: {
  items: PortfolioNavItem[];
  /** `null` while the whole page is showing. */
  active: string | null;
}) {
  // One shelf and an All chip is not a choice worth rendering.
  if (items.length <= 2) return null;

  return (
    <nav
      aria-label="Portfolio sections"
      // Scrolls rather than wraps at 320px, and the gutter keeps the last chip
      // clear of the screen edge.
      className="no-scrollbar -mx-5 mt-8 flex gap-2 overflow-x-auto px-5 sm:mx-0 sm:flex-wrap sm:justify-center sm:px-0"
    >
      {items.map((item) => {
        const on = item.id === active;
        // Page 1 of the whole page is the bare URL, so it has exactly one
        // address rather than two — the rule `pagination.tsx` follows.
        const href = item.id ? `/portfolio?section=${item.id}` : "/portfolio";
        return (
          <Link
            key={item.id ?? "all"}
            href={href}
            aria-current={on ? "page" : undefined}
            className={cn(CHIP, "shrink-0", on ? ON : OFF)}
          >
            {item.label}
            <span className="tabular-nums opacity-70">{item.count}</span>
            {!on && <LinkPendingOverlay />}
          </Link>
        );
      })}
    </nav>
  );
}
