/**
 * The Pages half of /portfolio: one card shape for everything the admin wrote.
 *
 * **A server component, deliberately.** Nothing here has any interaction, so
 * nothing here needs to ship JavaScript — only the reel grid does, because
 * only it opens a player. That is also why it can import `splitStat` from
 * `lib/portfolio.ts` directly: a client component could not, because that
 * module imports Prisma (the RSC trap CLAUDE.md records).
 *
 * ── Why one shape and not four ──────────────────────────────────────────────
 *
 * This file used to export three card shapes — `PortfolioStats`,
 * `PortfolioQuotes`, `PortfolioNotes` — one per shelf, across six shelves. The
 * page is now two sections, and Pages is one of them: write-ups, achievements
 * and bulk-order work, read down in the order the owner arranged them. Four
 * card shapes stacked in one shelf reads as four shelves that forgot their
 * headings.
 *
 * So there is one card, and the *content* varies inside it. An achievement
 * still gets its figure set large, because `splitStat` can pull a leading
 * number out of a title the owner typed without being told to; a title with no
 * number is printed plainly. Nothing has to be written a special way for this
 * to be safe, which matters because the owner types these.
 *
 * The photo keeps the portrait `aspect-[4/5]` crop CLAUDE.md requires, but the
 * card lays out **horizontally** — photo left, words right. A row with a
 * paragraph in it is unmistakably an article card rather than a product tile,
 * so the rule is honoured and the page still reads as editorial.
 */

import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, ShoppingBag } from "lucide-react";
import { splitStat, type PortfolioEntry } from "@/lib/portfolio";

/**
 * `next/image` only where `next.config.ts` allows the host. An unlisted host
 * does not degrade — the optimiser 400s and the photo renders broken — so
 * `thumbnailOptimisable` is decided on the server and anything else goes
 * through a plain `<img>`. Same rule as the reel grid.
 */
function Photo({ entry, sizes }: { entry: PortfolioEntry; sizes: string }) {
  if (!entry.thumbnail) return null;
  if (entry.thumbnailOptimisable) {
    return (
      <Image
        src={decodeURI(entry.thumbnail)}
        alt=""
        fill
        sizes={sizes}
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
      loading="lazy"
      decoding="async"
      className="absolute inset-0 h-full w-full object-cover"
    />
  );
}

export function PortfolioPages({ entries }: { entries: PortfolioEntry[] }) {
  if (entries.length === 0) return null;

  return (
    <ul className="mt-6 grid grid-cols-1 gap-3 lg:grid-cols-2">
      {entries.map((entry) => {
        const { figure, rest } = splitStat(entry.title);
        const external = entry.url ? !entry.url.startsWith("/") : false;

        return (
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

              {/* An achievement leads with its number; everything else leads
                  with its heading. Same card either way. */}
              {figure ? (
                <>
                  <p className="display-tight mt-1.5 font-serif text-3xl leading-none text-accent sm:text-4xl">
                    {figure}
                  </p>
                  <h3 className="mt-1.5 break-words font-serif text-base leading-snug sm:text-lg">
                    {rest}
                  </h3>
                </>
              ) : (
                <h3 className="mt-1.5 break-words font-serif text-lg leading-snug">
                  {entry.title}
                </h3>
              )}

              {entry.description && (
                <p className="mt-1.5 line-clamp-4 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                  {entry.description}
                </p>
              )}

              {/*
               * The garment is a footnote, not the point of the card — this
               * page is about the brand, not the catalogue.
               *
               * `w-full` + `min-w-0` on the label are load-bearing. As an
               * `inline-flex` sized to its own content this ignored the grid
               * column and a long product name pushed the whole page sideways
               * at 320px — `truncate` cannot clip inside a flex item whose
               * automatic minimum size is its own text.
               */}
              {entry.product && (
                <Link
                  href={`/product/${entry.product.slug}`}
                  className="mt-2 flex min-h-11 w-full max-w-full items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-accent"
                >
                  <ShoppingBag className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 truncate">{entry.product.name}</span>
                </Link>
              )}

              {entry.url && (
                <a
                  href={entry.url}
                  {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
                  className="mt-auto inline-flex min-h-11 items-center gap-1.5 pt-2 text-xs font-medium uppercase tracking-widest text-accent transition-colors hover:text-foreground"
                >
                  Read more
                  <ArrowUpRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                </a>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
