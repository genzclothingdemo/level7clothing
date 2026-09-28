"use client";

/**
 * "Show more" — the one growth control on /portfolio, and the list wrapper
 * that uses it.
 *
 * ── Why a button and not an infinite scroll ─────────────────────────────────
 *
 * The owner's sizing is *"each section = 50+ post/reel/yt/page"*, so every
 * list on this page has to assume it is fifty long. An auto-loading feed is
 * the obvious answer and the wrong one here: /portfolio ends in a call to
 * action and the store's footer, and a list that grows as you approach them
 * means they are never reached. A press is also the only version of this that
 * a keyboard and a screen reader get for free, and the only one where the
 * back button lands you where you were.
 *
 * The count of what is left rides **on** the button, so the press is a
 * decision rather than a guess.
 *
 * ── Why the list takes rendered nodes, not data ─────────────────────────────
 *
 * `PortfolioPages` is a server component on purpose — its cards have no
 * interaction, so they should ship no JavaScript, and it calls `splitStat`
 * from `lib/portfolio.ts`, which a client component may not do because that
 * module imports Prisma (CLAUDE.md's RSC trap). Handing this component an
 * array of already-rendered nodes keeps both of those true: the cards stay on
 * the server, and the only thing that becomes interactive is how many of them
 * are in the DOM.
 *
 * Slicing rather than hiding is the point — a card past the cut is not in the
 * document at all, so its photo is never requested.
 */

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Squared, uppercase, wide-tracked, colour change only — the design system in
 * CLAUDE.md. The `!` on the hover border guards against
 * `* { border-color: var(--border) }` in `globals.css`: it is inside
 * `@layer base` today, but it has escaped that layer twice and the failure is
 * silent — every `border-<colour>` utility in the repo simply stops working.
 */
export function ShowMore({
  remaining,
  onPress,
  label = "Show more",
}: {
  remaining: number;
  onPress: () => void;
  label?: string;
}) {
  return (
    <div className="mt-6 flex justify-center">
      <button
        type="button"
        onClick={onPress}
        className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-border px-5 text-[11px] font-medium uppercase tracking-[0.14em] text-foreground transition-colors hover:border-accent! hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {label}
        <span className="tabular-nums opacity-60">{remaining}</span>
      </button>
    </div>
  );
}

export function RevealList({
  items,
  step = 8,
  className,
}: {
  /** Already-rendered cards. See the header note on why these are nodes. */
  items: React.ReactNode[];
  /** How many to show at first, and how many each press adds. */
  step?: number;
  /** Classes for the `<ul>`, so the caller keeps ownership of the grid. */
  className?: string;
}) {
  const [shown, setShown] = useState(step);
  const remaining = items.length - shown;

  return (
    <>
      <ul className={cn(className)}>{items.slice(0, shown)}</ul>
      {remaining > 0 && (
        <ShowMore
          remaining={remaining}
          onPress={() => setShown((n) => n + step)}
        />
      )}
    </>
  );
}
