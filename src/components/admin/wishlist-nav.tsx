import Link from "next/link";
import { Heart, ShoppingCart } from "lucide-react";
import { cn } from "@/lib/utils";
import { InfoTip } from "@/components/store/info-tip";

/**
 * The two-tab strip shared by Admin → Interested customers and Admin →
 * Wishlists.
 *
 * ── Why one destination and not two sidebar rows ─────────────────────────────
 *
 * These are the same question asked of two signals: *somebody wants this and
 * has not bought it*. One is a cart they left, the other is a piece they
 * saved. Splitting them into two sidebar entries would mean the owner has to
 * remember which of two screens holds the answer before they can look for it,
 * and the sidebar already carries fifteen rows — a sixteenth costs every
 * screen, forever, in return for a list that is one row deep today.
 *
 * So: one nav entry, two routes, this strip switching between them. That is
 * exactly the precedent the Dashboard already sets, where Overview and the
 * five `/admin/finance/*` sections are one nav item with a `match` rule
 * covering both route trees.
 *
 * ── Why real routes and not `?tab=` ──────────────────────────────────────────
 *
 * Same reason the customer record uses `/orders`, `/payments`, `/activity`
 * rather than query tabs: a tab is then a link somebody can paste into a
 * message, the back button steps between the two, and each screen keeps its
 * own filters in its own URL. A `?tab=` would have put the wishlist's pivot
 * and the lead list's status filter in one query string, where clearing one
 * clears the other.
 *
 * A server component: two links and two counts, nothing interactive, so
 * nothing here ships to the browser.
 */

export type IntentTab = "carts" | "wishlist";

const TABS: {
  key: IntentTab;
  href: string;
  label: string;
  icon: typeof Heart;
  help: string;
}[] = [
  {
    key: "carts",
    href: "/admin/leads",
    label: "In a cart",
    icon: ShoppingCart,
    help: "Everyone who added a piece to their cart and left a contact detail. Mostly guests — the mini sign-up at add-to-cart is how the store learns who they are. Each row carries a status and a notes field, because these are leads you work.",
  },
  {
    key: "wishlist",
    href: "/admin/wishlist",
    label: "Wishlisted",
    icon: Heart,
    help: "Everyone who saved a piece for later. A save needs an account, so unlike carts, every person here is a registered customer you can reach. Nothing to work row by row — it is a demand list, read by product or by person.",
  },
];

export function IntentNav({
  active,
  counts,
}: {
  active: IntentTab;
  /** Rows behind each tab. A tab whose count is unknown passes `null`. */
  counts: Record<IntentTab, number | null>;
}) {
  return (
    <div
      role="navigation"
      aria-label="Interest signals"
      className="flex flex-wrap items-center gap-2"
    >
      {TABS.map((t) => {
        const on = t.key === active;
        const Icon = t.icon;
        const count = counts[t.key];
        return (
          <Link
            key={t.key}
            href={t.href}
            aria-current={on ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 text-[11px] font-medium uppercase tracking-wider transition-colors sm:min-h-9 sm:flex-none",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              on
                ? "border-accent bg-accent/10 text-accent"
                : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {t.label}
            {count !== null && (
              <span
                className={cn(
                  "rounded px-1 text-[10px] tabular-nums",
                  on ? "bg-accent/20" : "bg-muted"
                )}
              >
                {count}
              </span>
            )}
          </Link>
        );
      })}
      <InfoTip term="Interest signals">
        {TABS.find((t) => t.key === active)?.help}
        <span className="mt-2 block border-t border-border pt-2">
          Both tabs are built from the same customer records as Admin →
          Customers — matched on lowercased email, then phone — so a person who
          left a cart and later saved a piece is one person on both screens.
        </span>
      </InfoTip>
    </div>
  );
}
