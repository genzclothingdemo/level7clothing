"use client";

/**
 * The full-screen reel viewer — the thing /portfolio exists for.
 *
 * The owner's brief, verbatim: *"insta ke jesa sidha see kar sake… multiple
 * click ke baad andar jaake on/view/see na ho… click karne par instagram ke
 * jesa hi reel open ho jaaega… scroll bhi ho jaegi yahi se direct back kiye
 * bina."* So: one tap on a thumbnail, the reel is full-screen and playing, and
 * the **next** reel is a swipe away — never back out to the grid and in again.
 *
 * ── Mount strategy: nothing at rest, at most THREE while open ───────────────
 *
 * A hard cap, not a heuristic, and it is what lets a group carry fifty reels:
 *
 * - **Zero iframes at rest.** The grid is `<img>` tags. Mounting a dozen
 *   players on load would be several megabytes of third-party script and would
 *   hand every visitor to Instagram's and YouTube's trackers before they had
 *   shown any interest at all.
 * - **While open: the slide in view plus its immediate neighbours** — so one,
 *   two or three iframes, never more. `MOUNT_RADIUS` is the whole rule. The
 *   neighbours are mounted *without* autoplay, so opening them costs a warm
 *   DNS/TLS/player-JS cache and nothing else; only the active slide gets the
 *   autoplay src.
 * - **`POSTER_RADIUS` bounds the images the same way**, and it is not a
 *   micro-optimisation: every slide is in the DOM, because the track's scroll
 *   height *is* the set, so a poster per slide meant a fifty-reel group
 *   downloading fifty covers the moment one tile was opened. Slides further
 *   out than two render as the flat black the player sits on anyway.
 * - **Closing unmounts all of them**, because the viewer is conditionally
 *   rendered. There is no cleanup to remember and no way to accumulate players
 *   by scrolling around.
 *
 * `key={src}` on the iframe is load-bearing. Mutating an existing iframe's
 * `src` pushes a session-history entry in several browsers, which quietly
 * breaks the back button after a few swipes; keying on the src makes React
 * replace the element instead, which does not.
 *
 * ── Knowing where you are in a set of fifty ─────────────────────────────────
 *
 * Three things, because a bare "12 / 54" is a number without a shape:
 *
 * 1. a hairline **progress rail** across the top, filled to `index / total` —
 *    readable at a glance, and it costs one div;
 * 2. the **group's name** beside the count, so the set has an identity ("On
 *    YouTube · 12 / 54") — the viewer is scoped to one group and this is the
 *    only place that scoping is visible;
 * 3. the count is in an `aria-live` region, so a screen reader is told the
 *    position changed without having to go looking for it.
 *
 * ── The swipe shield, and why Instagram gets a play mark ────────────────────
 *
 * A cross-origin iframe swallows touch and wheel events, so a swipe that
 * starts on the video would never reach our scroll container — the one gesture
 * the owner actually asked for. So an unengaged slide carries a transparent
 * shield over the player. It is one of our own elements, so the browser
 * scroll-snaps the track natively when you drag it; a *tap* on it (small
 * movement, short press) hands the slide over to the provider's own controls
 * for as long as you stay on it. Moving to another slide resets it, because
 * `engagedId` is a single value rather than a set.
 *
 * **Instagram's `/embed` has no autoplay parameter** — nothing cross-origin
 * can start it, and muting (which would make autoplay reliable) would silence
 * every reel on the page. So a non-YouTube slide is *told* it needs a tap,
 * with a labelled control rather than a bare glyph that could be mistaken for
 * a still frame. Naming the limit is the honest version of it; the only real
 * fix is the Graph API, which needs a token.
 *
 * ── Rules from CLAUDE.md this file exists to honour ─────────────────────────
 *
 * 1. **Conditionally rendered, opacity-only entrance.** Nothing is parked
 *    off-screen with a transform, so an interrupted animation can never strand
 *    a half-visible panel over the store. It sizes with `dvh`, never `vh`.
 * 2. **Safe areas go through `--sa-*`, never `env()`.** The overlay is padded
 *    with the repo's own `pt-safe / pb-safe / px-safe` utilities, so on a
 *    Dynamic Island phone the close button and the reel both sit below the
 *    clock — and it can be verified from the console by overriding `--sa-top`.
 *    It sits at `z-90`, under the `z-100` status-bar scrim, deliberately.
 * 3. **`next/image` only where `next.config.ts` allows the host.** An unlisted
 *    host does not degrade, it 400s and renders broken, so
 *    `entry.thumbnailOptimisable` is decided on the server and anything else
 *    goes through a plain `<img>`.
 *
 * ── Why the chrome is hard-coded white ──────────────────────────────────────
 *
 * Every other surface in the store reads its colours from the theme tokens.
 * This one must not: it is a black media surface in both themes, exactly like
 * a video player, and `text-foreground` would render the close button black on
 * black for anyone in light mode.
 */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import Link from "next/link";
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Play,
  ShoppingBag,
  X,
} from "lucide-react";
import { InstagramIcon } from "@/components/store/instagram-icon";
import type { PortfolioEntry } from "@/lib/portfolio";
import { cn } from "@/lib/utils";

/** Slides within this many of the active one mount a real player. */
const MOUNT_RADIUS = 1;
/** Slides within this many of the active one render a poster image. */
const POSTER_RADIUS = 2;

/* ------------------------------------------------------------------ */
/*  Poster — shared with the grid                                      */
/* ------------------------------------------------------------------ */

/**
 * YouTube glyph, hand-rolled for the same reason `instagram-icon.tsx` is:
 * `lucide-react` at the version pinned here exports no brand icons at all
 * (`import { Youtube }` is a build error, not a missing-icon warning).
 */
function YouTubeIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17" />
      <path d="m10 15 5-3-5-3z" />
    </svg>
  );
}

/** The provider's mark, used on the placeholder and on the grid tile. */
export function ProviderGlyph({
  provider,
  className,
}: {
  provider: PortfolioEntry["provider"];
  className?: string;
}) {
  if (provider === "instagram") return <InstagramIcon className={className} />;
  if (provider === "youtube") return <YouTubeIcon className={className} />;
  return <Play className={className} aria-hidden="true" />;
}

/**
 * A reel with no poster is the normal case, not an edge case: `resolveVideo`
 * cannot get a public thumbnail out of Instagram without the Graph API, so
 * anything the admin has not imported a cover for arrives here with
 * `thumbnail: null`. A grey box would read as a broken image, so the fallback
 * is a deliberate card — provider mark, and the title it would otherwise hide.
 */
function PosterFallback({ entry }: { entry: PortfolioEntry }) {
  return (
    <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-muted via-muted to-accent/15 p-3 text-center">
      <ProviderGlyph provider={entry.provider} className="h-6 w-6 text-accent" />
      <span className="line-clamp-3 text-[11px] leading-snug text-muted-foreground">
        {entry.title}
      </span>
    </span>
  );
}

export function ReelPoster({
  entry,
  sizes,
  priority,
}: {
  entry: PortfolioEntry;
  sizes: string;
  priority?: boolean;
}) {
  if (!entry.thumbnail) return <PosterFallback entry={entry} />;

  if (entry.thumbnailOptimisable) {
    return (
      <Image
        src={decodeURI(entry.thumbnail)}
        alt=""
        fill
        sizes={sizes}
        priority={priority}
        className="object-cover"
      />
    );
  }

  return (
    // The host is not in next.config.ts remotePatterns, so the optimiser would
    // 400 on it rather than degrade — a plain <img> is the correct tag here.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={entry.thumbnail}
      alt=""
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      className="absolute inset-0 h-full w-full object-cover"
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Player                                                             */
/* ------------------------------------------------------------------ */

/**
 * Add autoplay to a YouTube embed, and only to a YouTube embed.
 *
 * Built with `URL` rather than string concatenation so an embed address that
 * already carries a query string doesn't end up with two `?`. Anything
 * unparseable comes back untouched, which is always safe — the player just
 * waits for a press on its own button.
 *
 * Instagram has no equivalent: `/embed` renders a card with its own play
 * control and there is no parameter that starts it. That is a platform limit,
 * not something to work around — it is why a non-YouTube slide carries a
 * labelled play control instead.
 */
function srcFor(entry: PortfolioEntry, autoplay: boolean): string | null {
  if (!entry.embedUrl) return null;
  if (!autoplay || entry.provider !== "youtube") return entry.embedUrl;
  try {
    const u = new URL(entry.embedUrl);
    u.searchParams.set("autoplay", "1");
    // Without this iOS Safari takes the video fullscreen, which is exactly the
    // "you have left the page" feeling this component exists to avoid.
    u.searchParams.set("playsinline", "1");
    return u.toString();
  } catch {
    return entry.embedUrl;
  }
}

function Player({
  entry,
  autoplay,
  onReady,
}: {
  entry: PortfolioEntry;
  autoplay: boolean;
  /** The embed's own document has loaded — the poster can step aside. */
  onReady: () => void;
}) {
  const src = srcFor(entry, autoplay);
  if (!src) return null;
  return (
    <iframe
      // Replace the element rather than mutating `src` — see the header note.
      key={src}
      src={src}
      title={entry.title}
      onLoad={onReady}
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      allowFullScreen
      loading="lazy"
      referrerPolicy="strict-origin-when-cross-origin"
      // **No background.** The poster sits underneath (see `Slide`), and a
      // cross-origin iframe is transparent until its own document paints — so
      // leaving this unpainted is what turns "black rectangle while Instagram
      // connects" into "the cover, then the reel". `bg-black` here was quietly
      // cancelling the poster it was supposed to be layered over.
      className="absolute inset-0 h-full w-full border-0"
    />
  );
}

/* ------------------------------------------------------------------ */
/*  One slide                                                          */
/* ------------------------------------------------------------------ */

function Slide({
  entry,
  active,
  mounted,
  postered,
  engaged,
  onEngage,
  onBackdrop,
}: {
  entry: PortfolioEntry;
  active: boolean;
  mounted: boolean;
  postered: boolean;
  engaged: boolean;
  onEngage: () => void;
  /** A press on the letterbox beside the media, not on the media itself. */
  onBackdrop: () => void;
}) {
  /** Where the press started, so a drag can be told from a tap. */
  const press = useRef<{ y: number; x: number; at: number } | null>(null);
  const backdrop = useRef<{ y: number; x: number } | null>(null);
  /**
   * Has the embed's own document painted?
   *
   * The poster is dropped only once it has, which is what makes a player that
   * never arrives degrade into the cover shot rather than a black rectangle —
   * a slow connection, an ad blocker or a privacy extension refusing
   * `youtube-nocookie.com`, all of which are ordinary. Chrome fires `load`
   * even for an error document, so a *refused* frame still resolves; a frame
   * whose request is blocked outright never fires, and the poster stays.
   */
  const [ready, setReady] = useState(false);

  return (
    <li
      className="relative flex h-full w-full snap-start snap-always items-center justify-center"
      onPointerDown={(e) => {
        backdrop.current =
          e.target === e.currentTarget ? { y: e.clientY, x: e.clientX } : null;
      }}
      onPointerUp={(e) => {
        const start = backdrop.current;
        backdrop.current = null;
        // Only the letterbox itself, and only a tap — a drag here is a scroll
        // the browser has already snapped, and closing on it would be a trap.
        if (!start || e.target !== e.currentTarget) return;
        if (Math.abs(e.clientY - start.y) + Math.abs(e.clientX - start.x) < 12) {
          onBackdrop();
        }
      }}
    >
      <div
        className={cn(
          "relative w-full overflow-hidden bg-black",
          entry.vertical
            ? "h-full max-w-[26rem]"
            : // A landscape film is a black box floating on a black overlay —
              // the hairline is what tells you where the film actually is.
              "aspect-video max-h-full max-w-5xl rounded-lg ring-1 ring-white/10"
        )}
      >
        {/* The poster first, so it is genuinely *under* the player — a slide
            is then never a black rectangle, whether the player is unmounted,
            still connecting, or blocked outright. It used to be rendered only
            when `!mounted`, under a comment claiming it stayed behind a
            mounted-but-unpainted one; it did not, and opening a reel on a slow
            connection was several seconds of black.

            Beyond `POSTER_RADIUS` there is nothing to see anyway — see the
            header note on why that bound exists. */}
        {postered && (!mounted || !ready) && (
          <ReelPoster entry={entry} sizes="(max-width: 640px) 100vw, 26rem" />
        )}

        {mounted ? (
          <Player
            entry={entry}
            autoplay={active}
            onReady={() => setReady(true)}
          />
        ) : null}

        {/* ---- swipe shield -------------------------------------------------
            Transparent, one of ours, so a drag scroll-snaps the track natively
            and a tap hands the slide to the provider's own controls. */}
        {mounted && !engaged && (
          <button
            type="button"
            aria-label={
              entry.provider === "youtube"
                ? `Show player controls for ${entry.title}`
                : `Play ${entry.title}`
            }
            onPointerDown={(e) => {
              press.current = { y: e.clientY, x: e.clientX, at: Date.now() };
            }}
            onPointerUp={(e) => {
              const start = press.current;
              press.current = null;
              if (!start) return;
              const moved =
                Math.abs(e.clientY - start.y) + Math.abs(e.clientX - start.x);
              // A drag is a scroll the browser already handled; only a real
              // tap should take the shield down.
              if (moved < 12 && Date.now() - start.at < 500) onEngage();
            }}
            className="absolute inset-0 z-10 grid cursor-pointer place-items-center focus-visible:outline-none"
          >
            {/* YouTube is already playing under this, so it gets no mark.
                Instagram cannot be started from here at all, so it gets a
                control that says so rather than a glyph that might be
                mistaken for a watermark. */}
            {entry.provider !== "youtube" && (
              <span className="flex flex-col items-center gap-2.5">
                {/*
                 * A white disc needs a dark edge, not a light one: this sits
                 * over a dark poster *and* over Instagram's white embed card
                 * while that card is still fetching its own media, and a
                 * `ring-white/15` made it disappear against the second. The
                 * ring plus the drop shadow define it either way.
                 */}
                <span className="grid h-16 w-16 place-items-center rounded-full bg-white text-black shadow-[0_4px_22px_rgba(0,0,0,0.45)] ring-1 ring-black/10">
                  <Play className="ml-0.5 h-7 w-7 fill-current" aria-hidden="true" />
                </span>
                <span className="rounded-lg bg-black/55 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-white/90 backdrop-blur">
                  Tap to play
                </span>
              </span>
            )}
          </button>
        )}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/*  Viewer                                                             */
/* ------------------------------------------------------------------ */

export function ReelViewer({
  entries,
  startIndex,
  groupLabel,
  onClose,
}: {
  entries: PortfolioEntry[];
  startIndex: number;
  /** The set being swiped through. Shown beside the count — see the header. */
  groupLabel?: string;
  onClose: () => void;
}) {
  const titleId = useId();
  const trackRef = useRef<HTMLUListElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const first = Math.max(0, Math.min(entries.length - 1, startIndex));
  const [index, setIndex] = useState(first);
  /**
   * The one slide whose player the visitor has taken over, by id rather than
   * by a boolean per slide: moving to another reel puts the shield back with
   * no effect and no cleanup, the same reason `playingId` was a single value.
   */
  const [engagedId, setEngagedId] = useState<string | null>(null);

  /* ---- land on the tapped reel, before the first paint ---- */
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollTop = first * track.clientHeight;
  }, [first]);

  /**
   * Which slide is in view.
   *
   * Every slide is exactly the track's height, so this is division — no
   * measuring, no per-slide refs, no `data-index`. It replaced an
   * `IntersectionObserver` at `threshold: 0.6`, which read as the tidier
   * choice and was not: IO delivers on the rendering lifecycle, so it goes
   * silent in a tab the browser is not painting, and at 0.6 there is a dead
   * band mid-gesture where no slide qualifies and the chrome still names the
   * one you have left. Rounding flips at the halfway mark, which is exactly
   * when the next reel has become the one you are looking at.
   *
   * The functional update is what keeps this cheap: a scroll event that does
   * not change the slide returns the same value and React bails out without
   * re-rendering, so the common case costs two property reads and a compare.
   */
  const onTrackScroll = useCallback(() => {
    const track = trackRef.current;
    if (!track || track.clientHeight === 0) return;
    const at = Math.max(
      0,
      Math.min(entries.length - 1, Math.round(track.scrollTop / track.clientHeight))
    );
    setIndex((previous) => (previous === at ? previous : at));
  }, [entries.length]);

  const goTo = useCallback(
    (next: number) => {
      const track = trackRef.current;
      if (!track || track.clientHeight === 0) return;
      const clamped = Math.max(0, Math.min(entries.length - 1, next));
      const still =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      /**
       * **A long jump is instant, a step is smooth.**
       *
       * `End` in a fifty-reel set is a smooth scroll of forty thousand pixels,
       * and a smooth scroll is a per-pixel animation: it takes seconds, every
       * slide in between is dragged through the mount window on the way, and
       * the chrome counts up like an odometer. Nobody asked to *see* the
       * distance — they asked to be at the other end. Only an adjacent step
       * is a movement worth animating.
       */
      const from = Math.round(track.scrollTop / track.clientHeight);
      const far = Math.abs(clamped - from) > 1;
      track.scrollTo({
        top: clamped * track.clientHeight,
        behavior: still || far ? "auto" : "smooth",
      });
    },
    [entries.length]
  );

  /**
   * Step relative to where the track actually is rather than to `index`.
   * The observer is asynchronous, so two quick presses would otherwise both
   * read the same stale index and move one slide between them.
   */
  const step = useCallback(
    (delta: number) => {
      const track = trackRef.current;
      if (!track || track.clientHeight === 0) return;
      goTo(Math.round(track.scrollTop / track.clientHeight) + delta);
    },
    [goTo]
  );

  /* ---- keys ---- */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      switch (e.key) {
        case "Escape":
          e.preventDefault();
          onClose();
          return;
        case "ArrowDown":
        case "ArrowRight":
        case "PageDown":
          e.preventDefault();
          step(1);
          return;
        case "ArrowUp":
        case "ArrowLeft":
        case "PageUp":
          e.preventDefault();
          step(-1);
          return;
        case "Home":
          e.preventDefault();
          goTo(0);
          return;
        case "End":
          e.preventDefault();
          goTo(entries.length - 1);
          return;
        default:
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [entries.length, goTo, onClose, step]);

  /* ---- the page behind must not scroll, and must get its scroll back ---- */
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      // Back to the thumbnail that was pressed, not to the top of the page.
      previouslyFocused?.focus?.();
    };
  }, []);

  /** Keep Tab inside the overlay — it is modal, and the grid is still behind. */
  const trapTab = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const root = panelRef.current;
    if (!root) return;
    const focusable = [
      ...root.querySelectorAll<HTMLElement>("a[href],button:not([disabled])"),
    ].filter((el) => el.offsetParent !== null);
    if (focusable.length === 0) return;
    const firstEl = focusable[0];
    const lastEl = focusable[focusable.length - 1];
    const on = document.activeElement;
    if (e.shiftKey && (on === firstEl || on === root)) {
      e.preventDefault();
      lastEl.focus();
    } else if (!e.shiftKey && on === lastEl) {
      e.preventDefault();
      firstEl.focus();
    }
  }, []);

  if (entries.length === 0) return null;
  if (typeof document === "undefined") return null;

  const entry = entries[index] ?? entries[0];
  const chrome =
    "grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-lg bg-white/10 text-white backdrop-blur transition-colors hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70";

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={trapTab}
      className={cn(
        // `dvh` so a phone's collapsing browser chrome can't push the close
        // button off-screen. Safe-area padding through the repo's tokens, so
        // nothing lands under the Dynamic Island. z-90 keeps it under the
        // z-100 status-bar scrim, which is the system's band, not ours.
        "pt-safe pb-safe px-safe fixed inset-0 z-[90] h-[100dvh] w-full bg-black outline-none",
        // Opacity only. Nothing here is parked with a transform.
        "animate-[fadeIn_0.15s_ease-out_both] motion-reduce:animate-none"
      )}
    >
      {/*
        This wrapper is not decoration and must not be flattened away.
        `position: absolute` resolves against its containing block's **padding
        box**, so chrome hung directly off the padded dialog would sit at
        `top: 0` — i.e. under the Dynamic Island — while the safe-area padding
        quietly moved only the video. Measured before this wrapper existed:
        track top 59, close button top 12. Everything inset now hangs off this
        instead, so one `pt-safe` covers the whole overlay.
      */}
      <div className="relative h-full w-full">
        <ul
          ref={trackRef}
          onScroll={onTrackScroll}
          className="no-scrollbar h-full w-full snap-y snap-mandatory overflow-y-auto overscroll-contain"
        >
          {entries.map((item, at) => (
            <Slide
              key={item.id}
              entry={item}
              active={at === index}
              mounted={Math.abs(at - index) <= MOUNT_RADIUS}
              postered={Math.abs(at - index) <= POSTER_RADIUS}
              engaged={engagedId === item.id}
              onEngage={() => setEngagedId(item.id)}
              onBackdrop={onClose}
            />
          ))}
        </ul>

        {/* ---- top chrome -------------------------------------------------
            **Opaque, not a gradient**, and that is a correctness fix rather
            than a taste one. Instagram's `/embed` is not a video — it is a
            white card with its own header, action row and caption — so a
            translucent bar put our white close button on their white card and
            our white title over their "Add a comment…". Measured on a real
            embed: the close control was invisible.

            A solid bar hides the provider's furniture and guarantees our own
            reads, on a black video and on a white card alike. It overlays
            rather than sitting in the layout on purpose: a bar in the flex
            column would change the track's height whenever its own content
            changed height, and the track's height *is* the scroll-snap unit —
            one reel with no description would shift every snap position in
            the set.

            The short gradient hung off `top-full` keeps the edge from reading
            as a hard letterbox. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 bg-black">
          {/* Progress rail: how far into the set you are, without reading a
              number. `width` is inline because it is data, not style — there
              is no utility for "47%". */}
          <div aria-hidden="true" className="h-0.5 w-full bg-white/20">
            <div
              className="h-full bg-white transition-[width] duration-200 motion-reduce:transition-none"
              style={{ width: `${((index + 1) / entries.length) * 100}%` }}
            />
          </div>

          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <p
              aria-live="polite"
              className="min-w-0 truncate text-[10px] font-medium uppercase tracking-[0.16em] text-white/85"
            >
              {groupLabel && (
                <span className="text-white/50">{groupLabel} · </span>
              )}
              <span className="tabular-nums">
                {index + 1}
                <span className="text-white/50"> / {entries.length}</span>
              </span>
            </p>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close reels"
              className={cn(chrome, "pointer-events-auto")}
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          <div
            aria-hidden="true"
            className="absolute inset-x-0 top-full h-6 bg-gradient-to-b from-black to-transparent"
          />
        </div>

        {/* ---- next / previous, for a mouse and for anyone who does not swipe ---- */}
        <div className="pointer-events-none absolute right-3 top-1/2 z-20 hidden -translate-y-1/2 flex-col gap-2 sm:flex">
          <button
            type="button"
            onClick={() => step(-1)}
            disabled={index === 0}
            aria-label="Previous reel"
            className={cn(
              chrome,
              "pointer-events-auto disabled:cursor-default disabled:opacity-25"
            )}
          >
            <ChevronUp className="h-5 w-5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => step(1)}
            disabled={index === entries.length - 1}
            aria-label="Next reel"
            className={cn(
              chrome,
              "pointer-events-auto disabled:cursor-default disabled:opacity-25"
            )}
          >
            <ChevronDown className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* ---- bottom chrome: what this is, and the piece in it ----
            Opaque for the same reason as the top bar, with the same soft edge
            hung off `bottom-full`. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-black px-3 pb-3 pt-2.5">
          <div
            aria-hidden="true"
            className="absolute inset-x-0 bottom-full h-8 bg-gradient-to-t from-black to-transparent"
          />
          {/* The caption tracks the media's own width — 26rem under a reel,
              5xl under a film — so it reads as part of the same object rather
              than a band of text that happens to be underneath it. */}
          <div
            className={cn(
              "mx-auto w-full",
              entry.vertical ? "max-w-[26rem]" : "max-w-5xl"
            )}
          >
            <h2
              id={titleId}
              className="line-clamp-2 font-serif text-sm leading-5 text-white sm:text-base sm:leading-6"
            >
              {entry.title}
            </h2>
            {entry.description && (
              <p className="mt-0.5 line-clamp-1 text-xs leading-5 text-white/55">
                {entry.description}
              </p>
            )}

            <div className="mt-2.5 flex items-center gap-2">
              {/*
               * The garment reads as a **destination**, not a sentence.
               * It was "Shop <product name>" on one uppercase line, which
               * truncated into things like "SHOP BOTTLE GREEN OVERSIZ…" — the
               * label and the name fighting for the same line. Splitting them
               * gives the name the whole width and the intent an eyebrow.
               *
               * **No photo here on purpose.** `PortfolioProductRef.image` is a
               * bare URL with no `optimisable` flag beside it (unlike
               * `thumbnail` / `thumbnailOptimisable` on the entry), and
               * `isOptimisableImage` lives in a Prisma-importing module this
               * client component may not call — CLAUDE.md's RSC trap. An
               * unlisted host does not degrade through `next/image`, it 400s
               * and renders broken, and a plain `<img>` would push a full-size
               * product PNG into a 36px box. Neither is worth it for a
               * decoration; see the report note asking for that flag.
               *
               * `min-w-0` + `truncate` are load-bearing at 320px — a flex
               * item's automatic minimum size is its own text, so a long
               * product name pushes the row sideways without them.
               */}
              {entry.product && (
                <Link
                  href={`/product/${entry.product.slug}`}
                  className="pointer-events-auto flex min-h-12 min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-lg bg-white px-3 text-black transition-colors hover:bg-white/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                >
                  <ShoppingBag className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 py-1.5 text-left">
                    <span className="block text-[9px] font-medium uppercase tracking-[0.16em] text-black/50">
                      Shop the piece
                    </span>
                    <span className="block truncate text-xs font-medium leading-tight">
                      {entry.product.name}
                    </span>
                  </span>
                </Link>
              )}
              {entry.url && (
                <a
                  href={entry.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open ${entry.title} on ${
                    entry.provider === "youtube" ? "YouTube" : "the original site"
                  }`}
                  className={cn(
                    "pointer-events-auto inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-lg border border-white/25 px-4 text-[10px] font-medium uppercase tracking-[0.16em] text-white transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
                    !entry.product && "flex-1"
                  )}
                >
                  <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
                  Original
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
