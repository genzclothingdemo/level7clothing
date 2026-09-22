/**
 * The three non-media card shapes on /portfolio.
 *
 * **Server components, deliberately.** None of them has any interaction, so
 * none of them needs to ship JavaScript — only the reels grid does, because
 * only it mounts a player. That is also why they can import `splitStat` from
 * `lib/portfolio.ts` directly: a client component could not, because that
 * module imports Prisma (the RSC trap CLAUDE.md records).
 *
 * ── Why these are not just more tiles ────────────────────────────────────────
 *
 * The page this replaced rendered one square-ish poster grid for everything,
 * which is what made it read as a second shop no matter what was in it. A
 * milestone is a number, a testimonial is a sentence somebody said, and a
 * collaboration is a short piece of writing with a photo — three different
 * objects. Giving each its own shape is most of the difference between "brand
 * page" and "catalogue with the prices taken off".
 *
 * The `note` card keeps the portrait `aspect-[4/5]` crop CLAUDE.md requires for
 * garment photography, but lays it out **horizontally** — photo left, heading
 * and paragraph right. A row with a paragraph in it is unmistakably an article
 * card rather than a product tile, so the rule is honoured and the page still
 * reads as editorial.
 */

import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, Quote, ShoppingBag } from "lucide-react";
import { splitStat, type PortfolioEntry } from "@/lib/portfolio";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Shared photo                                                       */
/* ------------------------------------------------------------------ */

/**
 * `next/image` only where `next.config.ts` allows the host. An unlisted host
 * does not degrade — the optimiser 400s and the photo renders broken — so
 * `thumbnailOptimisable` is decided on the server and anything else goes
 * through a plain `<img>`. Same rule as the media grid.
 */
function Photo({
  entry,
  sizes,
  className,
}: {
  entry: PortfolioEntry;
  sizes: string;
  className?: string;
}) {
  if (!entry.thumbnail) return null;
  if (entry.thumbnailOptimisable) {
    return (
      <Image
        src={decodeURI(entry.thumbnail)}
        alt=""
        fill
        sizes={sizes}
        className={cn("object-cover", className)}
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
      className={cn("absolute inset-0 h-full w-full object-cover", className)}
    />
  );
}

/**
 * The garment, when there is one — a footnote, never the subject.
 *
 * `w-full` + `min-w-0` are load-bearing: as an `inline-flex` sized to its own
 * content this ignored the grid column, and a long product name pushed the
 * whole page sideways at 320px. `truncate` cannot clip inside a flex item
 * whose automatic minimum size is its own text.
 */
function ProductNote({ entry }: { entry: PortfolioEntry }) {
  if (!entry.product) return null;
  return (
    <Link
      href={`/product/${entry.product.slug}`}
      className="mt-2 flex min-h-11 w-full max-w-full items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-accent"
    >
      <ShoppingBag className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 truncate">{entry.product.name}</span>
    </Link>
  );
}

/** An outbound link, only when the row actually has one. */
function OpenLink({ entry, label }: { entry: PortfolioEntry; label: string }) {
  if (!entry.url) return null;
  const external = !entry.url.startsWith("/");
  return (
    <a
      href={entry.url}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-xs font-medium uppercase tracking-widest text-accent transition-colors hover:text-foreground"
    >
      {label}
      <ArrowUpRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
    </a>
  );
}

/* ------------------------------------------------------------------ */
/*  Milestones                                                         */
/* ------------------------------------------------------------------ */

/**
 * A number and what it means.
 *
 * `splitStat` pulls a leading figure out of the title so `"250+ pieces for one
 * campus fest"` sets the `250+` large. A title with no leading number is
 * printed plainly at a smaller size — nothing has to be written a special way
 * for this to be safe, which matters because the owner types these.
 */
export function PortfolioStats({ entries }: { entries: PortfolioEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <ul className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {entries.map((entry) => {
        const { figure, rest } = splitStat(entry.title);
        return (
          <li
            key={entry.id}
            className="min-w-0 rounded-2xl border border-border bg-card p-5 sm:p-6"
          >
            {figure ? (
              <>
                <p className="display-tight font-serif text-4xl leading-none text-accent sm:text-5xl">
                  {figure}
                </p>
                <p className="mt-2 break-words font-serif text-lg leading-snug">
                  {rest}
                </p>
              </>
            ) : (
              <p className="break-words font-serif text-xl leading-snug">
                {entry.title}
              </p>
            )}

            {entry.description && (
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {entry.description}
              </p>
            )}

            <OpenLink entry={entry} label="See it" />
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/*  Happy customers                                                    */
/* ------------------------------------------------------------------ */

/**
 * A testimonial: the quote is `description`, the person is `title`.
 *
 * That mapping is the one the admin form already produces without anybody
 * learning a convention — you type who said it in the title and what they said
 * in the description. A row with no description degrades to the title set as
 * the quote, which is still a readable card rather than an empty one.
 */
export function PortfolioQuotes({ entries }: { entries: PortfolioEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <ul className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {entries.map((entry) => {
        const said = entry.description ?? entry.title;
        const who = entry.description ? entry.title : null;
        return (
          <li
            key={entry.id}
            className="flex min-w-0 flex-col rounded-2xl border border-border bg-card p-5 sm:p-6"
          >
            <Quote
              className="h-5 w-5 shrink-0 text-accent/40"
              aria-hidden="true"
            />
            <p className="mt-3 flex-1 whitespace-pre-line break-words text-sm leading-relaxed">
              {said}
            </p>

            {who && (
              <div className="mt-4 flex items-center gap-2.5 border-t border-border pt-3">
                {entry.thumbnail ? (
                  <span className="relative grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-muted">
                    <Photo entry={entry} sizes="36px" />
                  </span>
                ) : (
                  <span
                    aria-hidden="true"
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent/15 text-xs font-semibold text-accent"
                  >
                    {who.trim().charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="min-w-0 truncate text-xs font-medium">{who}</span>
              </div>
            )}

            <ProductNote entry={entry} />
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/*  Editorial notes                                                    */
/* ------------------------------------------------------------------ */

/**
 * Photo left, words right. The photo keeps its portrait crop; the row shape is
 * what says "this is a piece of writing, not a product".
 *
 * At 320px the photo is 88px wide and the text takes the rest, which is why
 * this stays a row all the way down instead of stacking — a stacked card with
 * a full-width portrait photo would push the heading a screen and a half down.
 */
export function PortfolioNotes({ entries }: { entries: PortfolioEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <ul className="mt-8 grid grid-cols-1 gap-3 lg:grid-cols-2">
      {entries.map((entry) => (
        <li
          key={entry.id}
          className="flex min-w-0 gap-3 rounded-2xl border border-border bg-card p-3 sm:gap-5 sm:p-4"
        >
          {entry.thumbnail && (
            <span className="relative aspect-[4/5] w-[88px] shrink-0 overflow-hidden rounded-lg bg-muted sm:w-32">
              <Photo entry={entry} sizes="(max-width: 640px) 88px, 128px" />
            </span>
          )}

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              {entry.isFeatured && (
                <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium uppercase tracking-widest text-accent-foreground">
                  Featured
                </span>
              )}
              {entry.tags.slice(0, 2).map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-widest text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>

            <h3 className="mt-1.5 break-words font-serif text-lg leading-snug">
              {entry.title}
            </h3>

            {entry.description && (
              <p className="mt-1.5 line-clamp-4 text-sm leading-relaxed text-muted-foreground">
                {entry.description}
              </p>
            )}

            <ProductNote entry={entry} />
            <OpenLink entry={entry} label="Read more" />
          </div>
        </li>
      ))}
    </ul>
  );
}
