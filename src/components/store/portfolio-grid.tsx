"use client";

/**
 * The Social half of /portfolio: a feed of thumbnails that open a reel viewer.
 *
 * ── Why thumbnails and not players ──────────────────────────────────────────
 *
 * The page this replaces let a tile become a player in place, which meant a
 * visitor had to find the tile, press play, then press Expand to see it
 * properly — the *"multiple click ke baad andar jaake"* the owner asked us to
 * take out. A tile is now one thing: a poster you press to open the reel
 * full-screen, where it plays and where the next one is a swipe away. All the
 * player logic, and the hard cap of three iframes, lives in `reel-viewer.tsx`.
 *
 * **At rest this component mounts zero iframes.** It is `<img>` tags and
 * nothing else, which is what lets a group carry fifty reels on a phone.
 *
 * ── Square, on purpose ──────────────────────────────────────────────────────
 *
 * CLAUDE.md puts product imagery at portrait `aspect-[4/5]` everywhere and
 * carves out exactly one exception: the Instagram grid. This is that grid, and
 * it matches `instagram-section.tsx` on the homepage — `aspect-square`,
 * `grid-cols-3`, six up on desktop — so the two read as the same object.
 *
 * ── Why the viewer is scoped to one group ───────────────────────────────────
 *
 * Swiping runs to the end of the group you opened and stops, rather than
 * carrying on into the next one. A group is a feed with a subject; sliding
 * from a shoppable reel into a fifteen-minute landscape film with no warning
 * is the kind of surprise that makes people press Back — which is precisely
 * what this page is built to avoid.
 */

import { useCallback, useState } from "react";
import { ShoppingBag } from "lucide-react";
import { ProviderGlyph, ReelPoster, ReelViewer } from "@/components/store/reel-viewer";
import type { PortfolioEntry } from "@/lib/portfolio";

/** One shelf of reels. The page decides the grouping; this only renders it. */
export type ReelGroup = {
  id: string;
  label: string;
  blurb: string;
  entries: PortfolioEntry[];
};

/** Three up at 320px, six on a desktop — same as the homepage strip. */
const SIZES = "(max-width: 767px) 33vw, 16vw";

const TILE =
  "group relative block aspect-square w-full cursor-pointer overflow-hidden rounded-lg bg-muted ring-1 ring-border/60 transition-colors hover:ring-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function PortfolioSocial({ groups }: { groups: ReelGroup[] }) {
  /** Which group, and which reel inside it. `null` means no iframe exists. */
  const [openAt, setOpenAt] = useState<{ groupId: string; index: number } | null>(
    null
  );

  const close = useCallback(() => setOpenAt(null), []);

  const live = groups.filter((g) => g.entries.length > 0);
  if (live.length === 0) return null;

  const open = openAt ? live.find((g) => g.id === openAt.groupId) ?? null : null;

  return (
    <>
      {live.map((group) => (
        <div key={group.id} className="mt-8 first:mt-6">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <h3 className="font-serif text-lg leading-tight sm:text-xl">
              {group.label}
            </h3>
            <span className="text-xs tabular-nums text-muted-foreground">
              {group.entries.length}
            </span>
          </div>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            {group.blurb}
          </p>

          <ul className="mt-4 grid grid-cols-3 gap-2 sm:gap-3 md:grid-cols-6">
            {group.entries.map((entry, index) => (
              <li key={entry.id} className="min-w-0">
                <button
                  type="button"
                  onClick={() => setOpenAt({ groupId: group.id, index })}
                  // The tile itself carries no text, so the label is the only
                  // thing a screen reader gets — it has to say what opens.
                  aria-label={`Play ${entry.title}${
                    entry.product ? ` — featuring ${entry.product.name}` : ""
                  }`}
                  className={TILE}
                >
                  <ReelPoster entry={entry} sizes={SIZES} />

                  {/* Darkens on hover so the marks below stay legible over a
                      bright poster. Colour change only — CLAUDE.md: no lift. */}
                  <span className="pointer-events-none absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/25" />

                  <span className="pointer-events-none absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                    <span className="grid h-10 w-10 place-items-center rounded-full bg-background/90 text-foreground">
                      <ProviderGlyph provider={entry.provider} className="h-4 w-4" />
                    </span>
                  </span>

                  {entry.isFeatured && (
                    <span className="pointer-events-none absolute left-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-accent ring-2 ring-background/70" />
                  )}

                  {/* A reel you can buy from says so on the tile. The name is
                      in the viewer, not here — a caption under every square
                      turns the feed back into a product grid. */}
                  {entry.product && (
                    <span className="pointer-events-none absolute bottom-1.5 right-1.5 grid h-6 w-6 place-items-center rounded-full bg-background/85 text-foreground backdrop-blur">
                      <ShoppingBag className="h-3 w-3" aria-hidden="true" />
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {/* Mounted only while open — never hidden in place, never transformed
          off-screen. Closing it unmounts every iframe it had. */}
      {open && openAt && (
        <ReelViewer
          // A fresh mount per opening, so the viewer always lands on the reel
          // that was pressed rather than on wherever it was left last time.
          key={`${open.id}-${openAt.index}`}
          entries={open.entries}
          startIndex={openAt.index}
          onClose={close}
        />
      )}
    </>
  );
}
