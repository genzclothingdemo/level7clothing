"use client";

/**
 * The Social half of /portfolio: a feed of thumbnails that open a reel viewer.
 *
 * ── Built for fifty per group, not for four ─────────────────────────────────
 *
 * The owner's sizing, verbatim: *"samjo ki each section = class me 50+
 * post/reel/yt/page or etc sab hai."* Three groups of fifty is a hundred and
 * fifty squares, and a flat grid of that is a scroll nobody finishes and an
 * image budget nobody on a phone should pay. Three bounds, each answering a
 * different question — they are complementary, not three goes at the same one:
 *
 * | bound | what it caps | why not the others |
 * |---|---|---|
 * | **one group at a time** (`role="tablist"`) | how much page exists | a filter is the only thing that stops three groups stacking into one scroll |
 * | **`PAGE_SIZE` + Show more** | how much *of that group* is in the DOM | caps scroll length inside a fifty-item group; a tab cannot |
 * | **`revealer` — an IntersectionObserver per tile** | how many images are actually fetched | `next/image`'s lazy loading is the floor, not the answer: Chrome's lazy threshold reaches well past a thousand pixels, so on a 3-up phone grid it would fetch the whole page of tiles anyway |
 *
 * The tabs are also the honest shape for what the viewer already did: swiping
 * runs to the end of the group you opened and stops, because sliding from a
 * shoppable reel into a fifteen-minute landscape film is the kind of surprise
 * that makes people press Back. The tab makes that scoping visible instead of
 * leaving it as a rule you discover.
 *
 * **Counts live on the tabs**, so nothing is hidden-unknown: a group you are
 * not looking at still says how big it is.
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
 * nothing else, which is what lets a group carry fifty reels.
 *
 * ── Square, on purpose ──────────────────────────────────────────────────────
 *
 * CLAUDE.md puts product imagery at portrait `aspect-[4/5]` everywhere and
 * carves out exactly one exception: the Instagram grid. This is that grid, and
 * it matches `instagram-section.tsx` on the homepage — `aspect-square`,
 * `grid-cols-3`, six up on desktop — so the two read as the same object.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ShoppingBag } from "lucide-react";
import { ShowMore } from "@/components/store/portfolio-reveal";
import { ProviderGlyph, ReelPoster, ReelViewer } from "@/components/store/reel-viewer";
import type { PortfolioEntry } from "@/lib/portfolio";
import { cn } from "@/lib/utils";

/** One shelf of reels. The page decides the grouping; this only renders it. */
export type ReelGroup = {
  id: string;
  label: string;
  entries: PortfolioEntry[];
};

/** Tiles added per press of Show more, and shown before the first press. */
const PAGE_SIZE = 24;

/**
 * Tiles whose poster is in the server-rendered HTML.
 *
 * Not zero, deliberately. Gating *every* image behind an observer would mean
 * the first paint of this section is empty squares until hydration runs, which
 * trades an image budget for a blank page — the wrong way round. Twelve is two
 * rows at the six-up desktop grid and four at the three-up phone grid, i.e.
 * roughly what is above the fold either way, and it is a constant rather than
 * a measurement so the server and the client render identically and hydration
 * has nothing to reconcile.
 */
const EAGER = 12;

/** Three up at 320px, six on a desktop — same as the homepage strip. */
const SIZES = "(max-width: 767px) 33vw, 16vw";

const TILE =
  "group relative block aspect-square w-full cursor-pointer overflow-hidden rounded-lg bg-muted ring-1 ring-border/60 transition-colors hover:ring-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/* ------------------------------------------------------------------ */
/*  Image budget                                                       */
/* ------------------------------------------------------------------ */

type Revealer = {
  /** Watch `el`; call `show` once it is near the viewport. Returns a detach. */
  register(el: Element, show: () => void): () => void;
  destroy(): void;
};

/**
 * **One** `IntersectionObserver` for the whole feed, not one per tile.
 *
 * A tile past `EAGER` renders as an empty square and only mounts its `<img>`
 * when this says it is close. `rootMargin` is the whole tuning knob: enough
 * that a poster has landed by the time you scroll onto it, small enough that
 * opening the page does not fetch the fifty below the fold.
 *
 * A browser with no `IntersectionObserver` gets every tile revealed
 * immediately, which is exactly what this component did before — degraded, not
 * broken, and `next/image`'s own lazy loading still applies underneath.
 */
function createRevealer(): Revealer {
  const waiting = new Map<Element, () => void>();
  const io =
    typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver(
          (records) => {
            for (const record of records) {
              if (!record.isIntersecting) continue;
              const show = waiting.get(record.target);
              if (!show) continue;
              waiting.delete(record.target);
              io?.unobserve(record.target);
              show();
            }
          },
          { rootMargin: "250px 0px" }
        );

  return {
    register(el, show) {
      if (!io) {
        show();
        return () => {};
      }
      waiting.set(el, show);
      io.observe(el);
      return () => {
        waiting.delete(el);
        io.unobserve(el);
      };
    },
    destroy() {
      io?.disconnect();
      waiting.clear();
    },
  };
}

/* ------------------------------------------------------------------ */
/*  One tile                                                           */
/* ------------------------------------------------------------------ */

function Tile({
  entry,
  index,
  revealer,
  onOpen,
}: {
  entry: PortfolioEntry;
  index: number;
  revealer: Revealer;
  onOpen: () => void;
}) {
  const ref = useRef<HTMLLIElement | null>(null);
  // A constant, so the server and the first client render agree. See `EAGER`.
  const [shown, setShown] = useState(index < EAGER);

  useEffect(() => {
    if (shown) return;
    const el = ref.current;
    if (!el) return;
    return revealer.register(el, () => setShown(true));
  }, [shown, revealer]);

  return (
    <li ref={ref} className="min-w-0">
      <button
        type="button"
        onClick={onOpen}
        // The tile itself carries no text, so the label is the only thing a
        // screen reader gets — it has to say what opens.
        aria-label={`Play ${entry.title}${
          entry.product ? ` — featuring ${entry.product.name}` : ""
        }`}
        className={TILE}
      >
        {shown && <ReelPoster entry={entry} sizes={SIZES} />}

        {/* Darkens on hover so the marks below stay legible over a bright
            poster. Colour change only — CLAUDE.md: no lift. */}
        <span className="pointer-events-none absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/25" />

        <span className="pointer-events-none absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-background/90 text-foreground">
            <ProviderGlyph provider={entry.provider} className="h-4 w-4" />
          </span>
        </span>

        {entry.isFeatured && (
          <span className="pointer-events-none absolute left-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-accent ring-2 ring-background/70" />
        )}

        {/* A reel you can buy from says so on the tile. The name is in the
            viewer, not here — a caption under every square turns the feed back
            into a product grid. */}
        {entry.product && (
          <span className="pointer-events-none absolute bottom-1.5 right-1.5 grid h-6 w-6 place-items-center rounded-full bg-background/85 text-foreground backdrop-blur">
            <ShoppingBag className="h-3 w-3" aria-hidden="true" />
          </span>
        )}
      </button>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/*  The feed                                                           */
/* ------------------------------------------------------------------ */

export function PortfolioSocial({ groups }: { groups: ReelGroup[] }) {
  const live = groups.filter((g) => g.entries.length > 0);

  /** Which group is on screen. Ids, not indexes — the list can change length. */
  const [activeId, setActiveId] = useState(live[0]?.id ?? "");
  /**
   * How far each group has been expanded, kept **per group** so switching away
   * and back does not silently collapse a feed somebody had already opened out.
   */
  const [shown, setShown] = useState<Record<string, number>>({});
  /** Which group, and which reel inside it. `null` means no iframe exists. */
  const [openAt, setOpenAt] = useState<{ groupId: string; index: number } | null>(
    null
  );

  const [revealer] = useState(createRevealer);
  useEffect(() => () => revealer.destroy(), [revealer]);

  const tabsRef = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => setOpenAt(null), []);

  if (live.length === 0) return null;

  const active = live.find((g) => g.id === activeId) ?? live[0];
  const limit = shown[active.id] ?? PAGE_SIZE;
  const visible = active.entries.slice(0, limit);
  const remaining = active.entries.length - visible.length;

  const open = openAt ? live.find((g) => g.id === openAt.groupId) ?? null : null;

  /** Left/Right move between tabs, which is what the ARIA tabs pattern owes. */
  function onTabKey(e: React.KeyboardEvent<HTMLDivElement>) {
    const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (delta === 0) return;
    e.preventDefault();
    const at = live.findIndex((g) => g.id === active.id);
    const next = live[(at + delta + live.length) % live.length];
    setActiveId(next.id);
    // Focus follows selection in this pattern — the panel updates on arrow.
    tabsRef.current
      ?.querySelector<HTMLButtonElement>(`#${CSS.escape(`reel-tab-${next.id}`)}`)
      ?.focus();
  }

  return (
    <>
      {/* One group is one feed. With a single group there is nothing to choose
          between, so the control does not appear at all rather than rendering
          a tab bar of one. */}
      {live.length > 1 && (
        <div
          ref={tabsRef}
          role="tablist"
          aria-label="Reel groups"
          onKeyDown={onTabKey}
          className="mt-5 flex flex-wrap gap-2"
        >
          {live.map((group) => {
            const on = group.id === active.id;
            return (
              <button
                key={group.id}
                id={`reel-tab-${group.id}`}
                type="button"
                role="tab"
                aria-selected={on}
                aria-controls={`reel-panel-${group.id}`}
                tabIndex={on ? 0 : -1}
                onClick={() => setActiveId(group.id)}
                className={cn(
                  "inline-flex min-h-11 min-w-0 cursor-pointer items-center gap-2 rounded-lg border px-3.5 text-[11px] font-medium uppercase tracking-[0.14em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:px-4",
                  // The `!` guards against `* { border-color: var(--border) }`
                  // in globals.css — inside `@layer base` today, but it has
                  // escaped that layer twice before and the failure is silent.
                  on
                    ? "border-foreground! bg-foreground text-background"
                    : "border-border text-muted-foreground hover:border-accent! hover:text-accent"
                )}
              >
                <span className="truncate">{group.label}</span>
                <span
                  className={cn(
                    "tabular-nums",
                    on ? "text-background/60" : "opacity-60"
                  )}
                >
                  {group.entries.length}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div
        key={active.id}
        id={`reel-panel-${active.id}`}
        role={live.length > 1 ? "tabpanel" : undefined}
        aria-labelledby={live.length > 1 ? `reel-tab-${active.id}` : undefined}
        tabIndex={live.length > 1 ? 0 : undefined}
        className="focus-visible:outline-none"
      >
        <ul className="mt-4 grid grid-cols-3 gap-2 sm:gap-3 md:grid-cols-6">
          {visible.map((entry, index) => (
            <Tile
              key={entry.id}
              entry={entry}
              index={index}
              revealer={revealer}
              onOpen={() => setOpenAt({ groupId: active.id, index })}
            />
          ))}
        </ul>

        {/* The same control the Pages list uses — one button, one place, so
            the two halves of this page cannot drift apart. An explicit press
            and not an infinite scroll: see the note in `portfolio-reveal.tsx`. */}
        {remaining > 0 && (
          <ShowMore
            remaining={remaining}
            onPress={() =>
              setShown((s) => ({ ...s, [active.id]: limit + PAGE_SIZE }))
            }
          />
        )}
      </div>

      {/* Mounted only while open — never hidden in place, never transformed
          off-screen. Closing it unmounts every iframe it had. */}
      {open && openAt && (
        <ReelViewer
          // A fresh mount per opening, so the viewer always lands on the reel
          // that was pressed rather than on wherever it was left last time.
          key={`${open.id}-${openAt.index}`}
          entries={open.entries}
          startIndex={openAt.index}
          groupLabel={open.label}
          onClose={close}
        />
      )}
    </>
  );
}
