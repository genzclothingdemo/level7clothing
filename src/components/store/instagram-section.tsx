import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { InstagramIcon } from "@/components/store/instagram-icon";
import { LinkPendingOverlay } from "@/components/store/link-pending";
import { getSettings } from "@/lib/settings";
import { getPortfolioHighlights } from "@/lib/portfolio";
import { CURATED_POSTS } from "@/lib/instagram";

/**
 * The homepage social strip.
 *
 * Two changes from the version this replaces:
 *
 * 1. **It is now a server component.** It used to be `"use client"` purely to
 *    read `useSettings()`, which meant it could never touch the database. The
 *    homepage renders it as `<Reveal><InstagramSection /></Reveal>` — a server
 *    component passed as `children` to a client one, which is allowed — so it
 *    can read its own rows and still keep a zero-prop signature. The homepage
 *    is owned elsewhere and did not have to change.
 *
 * 2. **The tiles are admin-managed.** They come from `PortfolioItem`, edited
 *    at `/admin/portfolio`, and the strip links to the full `/portfolio` page
 *    rather than straight out to Instagram. `CURATED_POSTS` survives as the
 *    fallback for a store whose portfolio table is still empty: an empty grid
 *    on the homepage is a visible outage, and a brand-new store has no rows.
 *
 * The grid stays **square** here. CLAUDE.md's portrait `aspect-[4/5]` rule
 * carves out exactly this social grid, and the `/portfolio` page proper uses
 * 4/5 as it should.
 */
export async function InstagramSection() {
  const [s, highlights] = await Promise.all([
    getSettings(),
    getPortfolioHighlights(6),
  ]);

  const usable = highlights.filter((h) => h.thumbnail);
  const profileUrl = s.instagram || "https://instagram.com";

  return (
    <section className="container-px mx-auto max-w-7xl pb-20">
      <div className="text-center">
        <p className="text-xs uppercase tracking-widest gold-text">Our work</p>
        <h2 className="mt-1 font-serif text-3xl md:text-4xl">Portfolio</h2>
        <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
          Reels, shoots and collaborations — tap through for the full set.
        </p>
      </div>

      <div className="mt-8 grid grid-cols-3 gap-2 sm:gap-3 md:grid-cols-6">
        {usable.length > 0
          ? usable.map((item) => (
              <Link
                key={item.id}
                href="/portfolio"
                className="group relative block aspect-square overflow-hidden rounded-lg bg-muted"
                aria-label={item.title}
              >
                {/* `next/image` only where next.config.ts allows the host —
                    see the note in components/store/portfolio-grid.tsx. */}
                {item.thumbnailOptimisable ? (
                  <Image
                    src={decodeURI(item.thumbnail as string)}
                    alt=""
                    fill
                    sizes="(max-width: 768px) 33vw, 16vw"
                    className="object-cover"
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element -- host
                  // is not in remotePatterns; the optimiser would 400 on it.
                  <img
                    src={item.thumbnail as string}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                )}
                <span className="absolute inset-0 grid place-items-center bg-black/40 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                  <ArrowUpRight className="h-6 w-6 text-white" aria-hidden="true" />
                </span>
                <LinkPendingOverlay />
              </Link>
            ))
          : CURATED_POSTS.map((post) => (
              <Link
                key={post.src}
                href="/portfolio"
                className="group relative block aspect-square overflow-hidden rounded-lg bg-muted"
                aria-label={post.alt}
              >
                <Image
                  src={post.src}
                  alt=""
                  fill
                  sizes="(max-width: 768px) 33vw, 16vw"
                  className="object-cover"
                />
                <span className="absolute inset-0 grid place-items-center bg-black/40 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                  <ArrowUpRight className="h-6 w-6 text-white" aria-hidden="true" />
                </span>
                <LinkPendingOverlay />
              </Link>
            ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-center">
        <Link
          href="/portfolio"
          className="link-underline inline-flex min-h-11 items-center gap-2 text-sm"
        >
          See the full portfolio
          <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
        </Link>
        {s.instagram && (
          <a
            href={profileUrl}
            target="_blank"
            rel="noreferrer"
            className="link-underline inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground"
          >
            <InstagramIcon className="h-4 w-4" aria-hidden="true" /> Follow us on
            Instagram
          </a>
        )}
      </div>
    </section>
  );
}
