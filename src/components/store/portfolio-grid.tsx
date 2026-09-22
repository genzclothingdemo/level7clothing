"use client";

/**
 * The /portfolio grid, and the overlay one tile opens.
 *
 * Three decisions this file exists to enforce:
 *
 * 1. **Thumbnails in the grid, never embeds.** The owner has ~50 reels. Fifty
 *    mounted iframes is several megabytes of third-party player script and
 *    hands every visitor to Instagram's and YouTube's trackers before they
 *    have shown any interest. A page of posters costs one image each, and the
 *    iframe is mounted only when someone actually clicks. Same trade the
 *    product page's `VideoPreviews` rail already makes.
 *
 * 2. **The overlay is conditionally rendered and fades only** — the "Modal
 *    pattern" rule in CLAUDE.md. Nothing is parked off-screen with a
 *    transform, so an interrupted animation can never strand a half-visible
 *    panel over the page. It sizes with `dvh`, never `vh`, so a phone's
 *    browser chrome can't push the close button out of reach.
 *
 * 3. **`next/image` only where it is allowed.** `next.config.ts` permits two
 *    remote hosts; an unlisted one does not degrade, it 400s and the tile
 *    renders broken. `entry.thumbnailOptimisable` is decided on the server
 *    (see `lib/portfolio.ts`) and anything else goes through a plain `<img>`.
 *    That is what lets a live Instagram CDN URL work with no config change.
 */

import { useCallback, useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, ExternalLink, Play, ShoppingBag, X } from "lucide-react";
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
    // usually a blog link, and it should still look deliberate.
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
        "fixed inset-0 z-[90] flex h-[100dvh] w-full items-center justify-center bg-background/95 p-3 sm:p-6",
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
              <iframe
                src={entry.embedUrl}
                title={entry.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                loading="lazy"
                referrerPolicy="strict-origin-when-cross-origin"
                className="absolute inset-0 h-full w-full"
              />
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
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-border px-4 text-[11px] font-medium uppercase tracking-widest transition-colors hover:border-accent hover:text-accent"
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

const TILE =
  "group relative block aspect-[4/5] w-full overflow-hidden rounded-2xl bg-muted ring-1 ring-border/60 transition-colors hover:ring-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function PortfolioGrid({ entries }: { entries: PortfolioEntry[] }) {
  const [open, setOpen] = useState<PortfolioEntry | null>(null);
  const close = useCallback(() => setOpen(null), []);

  if (entries.length === 0) return null;

  return (
    <>
      <ul className="mt-8 grid grid-cols-2 gap-x-3 gap-y-7 sm:grid-cols-3 sm:gap-x-5 sm:gap-y-10 md:mt-10 lg:grid-cols-4">
        {entries.map((entry) => {
          // An embed opens in place; anything else is a real link, so it stays
          // middle-clickable, shareable and crawlable rather than becoming a
          // button that only works with JavaScript.
          const canEmbed = Boolean(entry.embedUrl);
          const href = entry.url ?? (entry.product ? `/product/${entry.product.slug}` : null);

          const inner = (
            <>
              <Poster entry={entry} />
              <span className="pointer-events-none absolute inset-0 bg-foreground/0 transition-colors group-hover:bg-foreground/25" />
              <span className="pointer-events-none absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover:opacity-100">
                <span className="grid h-11 w-11 place-items-center rounded-full bg-background/90 text-foreground">
                  {canEmbed ? (
                    <Play className="h-5 w-5" aria-hidden="true" />
                  ) : entry.kind === "instagram" ? (
                    <InstagramIcon className="h-5 w-5" aria-hidden="true" />
                  ) : (
                    <ArrowUpRight className="h-5 w-5" aria-hidden="true" />
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
              {canEmbed ? (
                <button
                  type="button"
                  onClick={() => setOpen(entry)}
                  aria-label={`Play ${entry.title}`}
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

                {entry.product && (
                  /*
                   * `w-full` + `min-w-0` on the label are load-bearing. As an
                   * `inline-flex` sized to its content, this link ignored the
                   * grid column and a long product name pushed the whole page
                   * sideways at 320px — `truncate` cannot clip inside a flex
                   * item whose automatic minimum size is its own text.
                   */
                  <Link
                    href={`/product/${entry.product.slug}`}
                    className="flex min-h-11 w-full max-w-full items-center gap-1 text-xs text-accent transition-colors hover:text-foreground"
                  >
                    <ShoppingBag className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 truncate">{entry.product.name}</span>
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
