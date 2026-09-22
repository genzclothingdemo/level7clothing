"use client";

/**
 * The reels-and-films grid: posters that **become players in place**.
 *
 * The owner's ask was "insta and yt i want to mirror here not just redirect" —
 * so a tap must not hand the visitor to instagram.com. It doesn't: the poster
 * is ours (copied into blob storage at import time, see `actions/portfolio.ts`)
 * and the play button swaps that poster for the provider's own iframe inside
 * the same tile. The visitor never leaves the page, and "Open original" is an
 * option rather than the only behaviour.
 *
 * ── Mount strategy: at most ONE iframe in the document, ever ─────────────────
 *
 * This is a hard cap, not a heuristic, and it is the whole reason the page can
 * carry fifty reels:
 *
 * - **Nothing is mounted on load.** A shelf of twelve tiles is twelve `<img>`
 *   tags. Twelve mounted players would be several megabytes of third-party
 *   script and would hand every visitor to Instagram's and YouTube's trackers
 *   before they showed any interest at all.
 * - **Playing a second tile unmounts the first**, because `playingId` is a
 *   single value rather than a set. Nothing needs to remember to clean up, and
 *   there is no way to accumulate players by clicking around.
 * - **Opening the lightbox unmounts the tile's player** for the same reason —
 *   `Lightbox` renders only while `open` is set, and opening it clears
 *   `playingId`.
 * - The iframe still carries `loading="lazy"`, which costs nothing and helps
 *   if one is mounted far below the fold.
 *
 * Autoplay is only added for YouTube, and only in the click handler — a poster
 * rendering must never start a video, and `youtube-nocookie.com` means the
 * tracking cookie is not set just because a tile is on screen.
 *
 * ── Two rules from CLAUDE.md this file exists to honour ──────────────────────
 *
 * 1. **The overlay is conditionally rendered and fades only.** Nothing is
 *    parked off-screen with a transform, so an interrupted animation can never
 *    strand a half-visible panel. It sizes with `dvh`, never `vh`, so a phone's
 *    browser chrome can't push the close button out of reach.
 * 2. **`next/image` only where it is allowed.** `next.config.ts` permits two
 *    remote hosts; an unlisted one does not degrade, it 400s and the tile
 *    renders broken. `entry.thumbnailOptimisable` is decided on the server (see
 *    `lib/portfolio.ts`) and anything else goes through a plain `<img>`.
 */

import { useCallback, useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import Link from "next/link";
import { ExternalLink, Expand, Play, ShoppingBag, X } from "lucide-react";
import { InstagramIcon } from "@/components/store/instagram-icon";
import type { PortfolioEntry } from "@/lib/portfolio";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Poster                                                             */
/* ------------------------------------------------------------------ */

const SIZES = "(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw";

function Poster({ entry }: { entry: PortfolioEntry }) {
  if (!entry.thumbnail) {
    // A branded placeholder rather than a grey box: a piece with no photo is
    // usually a link, and it should still look deliberate.
    return (
      <span className="absolute inset-0 grid place-items-center bg-gradient-to-br from-muted to-accent/10">
        <span className="eyebrow px-4 text-center text-muted-foreground">
          {entry.kind === "link" ? "Read" : "View"}
        </span>
      </span>
    );
  }

  if (entry.thumbnailOptimisable) {
    return (
      <Image
        src={decodeURI(entry.thumbnail)}
        alt=""
        fill
        sizes={SIZES}
        className="object-cover"
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- host is not in
    // next.config.ts remotePatterns; the optimiser would 400 on it.
    <img
      src={entry.thumbnail}
      alt=""
      loading="lazy"
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
 * waits for a second click on its own button.
 */
function withAutoplay(entry: PortfolioEntry): string | null {
  if (!entry.embedUrl) return null;
  if (entry.provider !== "youtube") return entry.embedUrl;
  try {
    const u = new URL(entry.embedUrl);
    u.searchParams.set("autoplay", "1");
    // Without this iOS Safari takes the video fullscreen, which is exactly the
    // "you have left the page" feeling this whole component is avoiding.
    u.searchParams.set("playsinline", "1");
    return u.toString();
  } catch {
    return entry.embedUrl;
  }
}

function Player({
  entry,
  autoplay,
  className,
}: {
  entry: PortfolioEntry;
  autoplay: boolean;
  className?: string;
}) {
  const src = autoplay ? withAutoplay(entry) : entry.embedUrl;
  if (!src) return null;
  return (
    <iframe
      src={src}
      title={entry.title}
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      allowFullScreen
      loading="lazy"
      referrerPolicy="strict-origin-when-cross-origin"
      className={cn("absolute inset-0 h-full w-full border-0 bg-black", className)}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Overlay                                                            */
/* ------------------------------------------------------------------ */

function Lightbox({
  entry,
  onClose,
}: {
  entry: PortfolioEntry;
  onClose: () => void;
}) {
  const titleId = useId();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    // The page behind must not scroll while a full-screen panel is over it.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      // `dvh`, not `vh` — see the header note.
      className={cn(
        "fixed inset-0 z-[90] flex h-[100dvh] w-full items-center justify-center bg-background/95 p-3 pt-[max(0.75rem,var(--sa-top))] pb-[max(0.75rem,var(--sa-bottom))] sm:p-6",
        "animate-[fadeIn_0.15s_ease-out_both] motion-reduce:animate-none"
      )}
      onClick={onClose}
    >
      <div
        // Stop a click inside the panel from reaching the backdrop handler.
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-card sm:max-h-[calc(100dvh-3rem)]"
      >
        <div className="flex items-start justify-between gap-2 border-b border-border p-3 sm:p-4">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate font-serif text-lg">
              {entry.title}
            </h2>
            {entry.product && (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {entry.product.name}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {entry.embedUrl ? (
            <div
              className={cn(
                "relative mx-auto w-full bg-muted",
                entry.vertical ? "aspect-[9/16] max-w-sm" : "aspect-video"
              )}
            >
              {/* Autoplays: the visitor pressed Expand on something they were
                  already watching, so waiting for a second press is friction. */}
              <Player entry={entry} autoplay />
            </div>
          ) : (
            <div className="relative mx-auto aspect-[4/5] w-full max-w-sm bg-muted">
              <Poster entry={entry} />
            </div>
          )}

          {entry.description && (
            <p className="whitespace-pre-line px-3 py-4 text-sm leading-relaxed text-muted-foreground sm:px-4">
              {entry.description}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border p-3 sm:p-4">
          {entry.product && (
            <Link
              href={`/product/${entry.product.slug}`}
              className="inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg bg-foreground px-4 text-[11px] font-medium uppercase tracking-widest text-background transition-opacity hover:opacity-90"
            >
              <ShoppingBag className="h-4 w-4" /> Shop this piece
            </Link>
          )}
          {entry.url && (
            <a
              href={entry.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-border px-4 text-[11px] font-medium uppercase tracking-widest transition-colors hover:border-accent! hover:text-accent"
            >
              <ExternalLink className="h-4 w-4" /> Open original
            </a>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ------------------------------------------------------------------ */
/*  Grid                                                               */
/* ------------------------------------------------------------------ */

/**
 * The tile frame stays `aspect-[4/5]` whether it is showing a poster or a
 * player, which is what stops the grid reflowing under the visitor's thumb the
 * moment something starts playing. YouTube's player letterboxes itself inside
 * whatever box it is given; Instagram's `/embed` card is responsive down to
 * about 320px and scrolls internally. Neither needs the tile to change shape.
 */
const TILE =
  "group relative block aspect-[4/5] w-full overflow-hidden rounded-2xl bg-muted ring-1 ring-border/60 transition-colors hover:ring-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function PortfolioGrid({ entries }: { entries: PortfolioEntry[] }) {
  /** The one tile currently playing in place. `null` means no iframe exists. */
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [open, setOpen] = useState<PortfolioEntry | null>(null);

  const close = useCallback(() => setOpen(null), []);
  const expand = useCallback((entry: PortfolioEntry) => {
    // One player at a time, across both mount points.
    setPlayingId(null);
    setOpen(entry);
  }, []);

  if (entries.length === 0) return null;

  return (
    <>
      <ul className="mt-8 grid grid-cols-2 gap-x-3 gap-y-7 sm:grid-cols-3 sm:gap-x-5 sm:gap-y-10 lg:grid-cols-4">
        {entries.map((entry) => {
          const canPlay = Boolean(entry.embedUrl);
          const playing = canPlay && playingId === entry.id;
          // An entry with nothing to embed is a real link, so it stays
          // middle-clickable, shareable and crawlable rather than becoming a
          // button that only works with JavaScript.
          const href =
            entry.url ?? (entry.product ? `/product/${entry.product.slug}` : null);

          const inner = (
            <>
              <Poster entry={entry} />
              <span className="pointer-events-none absolute inset-0 bg-foreground/0 transition-colors group-hover:bg-foreground/25" />
              <span className="pointer-events-none absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover:opacity-100">
                <span className="grid h-11 w-11 place-items-center rounded-full bg-background/90 text-foreground">
                  {canPlay ? (
                    <Play className="h-5 w-5" aria-hidden="true" />
                  ) : entry.kind === "instagram" ? (
                    <InstagramIcon className="h-5 w-5" aria-hidden="true" />
                  ) : (
                    <ExternalLink className="h-5 w-5" aria-hidden="true" />
                  )}
                </span>
              </span>
              {entry.isFeatured && (
                <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium uppercase tracking-widest text-accent-foreground">
                  Featured
                </span>
              )}
            </>
          );

          return (
            <li key={entry.id} className="min-w-0">
              {playing ? (
                <div className={cn(TILE, "ring-accent/40")}>
                  <Player entry={entry} autoplay />
                  {/* Sits over the player so it stays reachable on a phone,
                      where the provider's own chrome fills the frame. */}
                  <button
                    type="button"
                    onClick={() => expand(entry)}
                    aria-label={`Expand ${entry.title}`}
                    title="Expand"
                    className="absolute right-1.5 top-1.5 z-10 grid h-11 w-11 cursor-pointer place-items-center rounded-lg bg-background/85 text-foreground backdrop-blur transition-colors hover:bg-background sm:h-9 sm:w-9"
                  >
                    <Expand className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              ) : canPlay ? (
                <button
                  type="button"
                  onClick={() => setPlayingId(entry.id)}
                  aria-label={`Play ${entry.title} here`}
                  className={cn(TILE, "cursor-pointer")}
                >
                  {inner}
                </button>
              ) : href ? (
                <a
                  href={href}
                  {...(href.startsWith("/")
                    ? {}
                    : { target: "_blank", rel: "noreferrer" })}
                  aria-label={`Open ${entry.title}`}
                  className={TILE}
                >
                  {inner}
                </a>
              ) : (
                <button
                  type="button"
                  onClick={() => setOpen(entry)}
                  aria-label={`View ${entry.title}`}
                  className={cn(TILE, "cursor-pointer")}
                >
                  {inner}
                </button>
              )}

              <div className="mt-2 min-w-0">
                <p className="line-clamp-2 text-sm leading-snug">{entry.title}</p>

                {/*
                 * The garment is a footnote now, not the point of the tile —
                 * this page is about the brand, not the catalogue. It is still
                 * here because a visitor who wants the piece in the shot should
                 * not have to hunt for it.
                 *
                 * `w-full` + `min-w-0` on the label are load-bearing. As an
                 * `inline-flex` sized to its content, this link ignored the grid
                 * column and a long product name pushed the whole page sideways
                 * at 320px — `truncate` cannot clip inside a flex item whose
                 * automatic minimum size is its own text.
                 */}
                {entry.product && (
                  <Link
                    href={`/product/${entry.product.slug}`}
                    className="flex min-h-11 w-full max-w-full items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-accent"
                  >
                    <ShoppingBag className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 truncate">
                      Wearing {entry.product.name}
                    </span>
                  </Link>
                )}

                {entry.tags.length > 0 && (
                  <ul className="mt-1 flex flex-wrap gap-1">
                    {entry.tags.slice(0, 3).map((tag) => (
                      <li
                        key={tag}
                        className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-widest text-muted-foreground"
                      >
                        {tag}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {/* Mounted only while open — never hidden in place. */}
      {open && <Lightbox entry={open} onClose={close} />}
    </>
  );
}
