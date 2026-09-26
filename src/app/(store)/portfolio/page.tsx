import type { Metadata } from "next";
import { ArrowUpRight } from "lucide-react";
import { InstagramIcon } from "@/components/store/instagram-icon";
import { ButtonLink } from "@/components/ui/button";
import { InfoTip } from "@/components/store/info-tip";
import {
  PortfolioSocial,
  type ReelGroup,
} from "@/components/store/portfolio-grid";
import { PortfolioPages } from "@/components/store/portfolio-cards";
import { getSettings } from "@/lib/settings";
import {
  getPortfolio,
  instagramHandle,
  type PortfolioEntry,
} from "@/lib/portfolio";

export const dynamic = "force-dynamic";

/**
 * /portfolio — **exactly two sections**, and one interaction.
 *
 * ── What this replaced ──────────────────────────────────────────────────────
 *
 * Six shelves (`who we are · milestones · reels · happy customers ·
 * collaborations · bulk`), a chip nav that narrowed to one of them via
 * `?section=`, and pagination inside a narrowed shelf. It was a taxonomy the
 * visitor had to learn before seeing anything, and it put the reels — the only
 * thing anyone comes here for — four chips and a scroll away.
 *
 * It is now:
 *
 *   1. **Social** — reels and films, in three groups: the ones attached to a
 *      product, the ones the owner added by hand, and everything on YouTube.
 *   2. **Pages** — the write-ups, achievements and bulk-order work.
 *
 * ── Why the grouping is decided here and not in `lib/portfolio.ts` ──────────
 *
 * `lib/portfolio.ts` is another agent's file, and it still models the six
 * shelves. Rather than depend on a taxonomy that is being rewritten
 * underneath, this page flattens whatever shelves it is handed and re-groups
 * them on facts that are stable properties of an entry: does it have an
 * embed, what provider is it, and where did it come from. If the shelves move
 * again, this page keeps working.
 *
 * ── The split rule, in one line each ────────────────────────────────────────
 *
 * - **Social is `embedUrl !== null`.** Not "kind is instagram", not "it is on
 *   the reels shelf" — a thing belongs in the reel viewer exactly when there
 *   is something for the viewer to play. That makes the viewer's contract
 *   total: every tile in that grid opens and plays, with no dead ends.
 * - **Pages is everything else**, which is the same set the owner writes by
 *   hand: notes, milestones, testimonials, bulk-order work.
 *
 * ── `?section=` and `?page=` are gone ───────────────────────────────────────
 *
 * With two sections there is nothing worth narrowing to, so there is exactly
 * one canonical URL for this page. Old `?section=reels` / `?view=products`
 * links still return **200 with the whole page**, which is the right answer
 * for a shelf that no longer exists — better than a 404 on a URL Google has
 * already indexed.
 */

/* ------------------------------------------------------------------ */
/*  Grouping                                                           */
/* ------------------------------------------------------------------ */

/**
 * Source ids that mean **"this reel's URL came from a product's video links"**.
 *
 * A `Set<string>` rather than a comparison against `PortfolioSource`, and that
 * is the point: `lib/portfolio.ts` currently exports
 * `PortfolioSource = "portfolio" | "instagram-api"` and has **no marker at all
 * for a product-derived reel** — `productVideoEntries()` was removed, and the
 * owner of that module is adding it back. Written this way the lookup
 * typechecks against today's narrow union and starts working the moment the
 * union widens, whichever of these spellings lands, with no edit here.
 *
 * Until then the "shoppable" group is empty and hides itself, which is honest:
 * an empty group is better than guessing, and guessing was available —
 * `entry.product !== null` is *not* the same question. A reel the owner added
 * by hand can also name a garment; that does not make it a product video.
 */
const PRODUCT_SOURCES: ReadonlySet<string> = new Set([
  "product-video",
  "product-videos",
  "product",
  "products",
  "product-link",
]);

type SocialGroupId = "shoppable" | "studio" | "youtube";

const SOCIAL_GROUP_META: Record<SocialGroupId, { label: string; blurb: string }> = {
  shoppable: {
    label: "Shot on a piece",
    blurb: "Reels attached to something you can buy — the garment is one tap away.",
  },
  studio: {
    label: "From the studio",
    blurb: "Drops, shoots and behind the scenes, picked by us.",
  },
  youtube: {
    label: "On YouTube",
    blurb: "The longer cuts and the shorts, wherever they came from.",
  },
};

/** YouTube wins over provenance — the brief asks for both sources together. */
function socialGroupOf(entry: PortfolioEntry): SocialGroupId {
  if (entry.provider === "youtube") return "youtube";
  return PRODUCT_SOURCES.has(entry.source) ? "shoppable" : "studio";
}

/* ------------------------------------------------------------------ */
/*  Metadata                                                           */
/* ------------------------------------------------------------------ */

export async function generateMetadata(): Promise<Metadata> {
  const s = await getSettings();
  const description = `Reels, films and the work behind ${s.brandName} — they play right here.`;

  return {
    title: "Portfolio",
    description,
    alternates: { canonical: "/portfolio" },
    openGraph: {
      title: `Portfolio · ${s.brandName}`,
      description,
      url: "/portfolio",
      siteName: s.brandName,
      type: "website",
      locale: "en_IN",
    },
    twitter: {
      card: "summary_large_image",
      title: `Portfolio · ${s.brandName}`,
      description,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default async function PortfolioPage() {
  const [s, data] = await Promise.all([getSettings(), getPortfolio()]);
  const handle = instagramHandle(s.instagram);
  const profileUrl = s.instagram || "https://instagram.com";

  // Flatten whatever shelves `getPortfolio()` returns — an entry appears on
  // exactly one of them, so this lists each once and keeps the order the owner
  // arranged (featured first, then `sortOrder`).
  const all = data.sections.flatMap((section) => section.entries);

  const social = all.filter((entry) => Boolean(entry.embedUrl));
  const pages = all.filter((entry) => !entry.embedUrl);

  const groups: ReelGroup[] = (
    ["shoppable", "studio", "youtube"] as const
  ).map((id) => ({
    id,
    ...SOCIAL_GROUP_META[id],
    entries: social.filter((entry) => socialGroupOf(entry) === id),
  }));

  const liveGroups = groups.filter((g) => g.entries.length > 0);
  const empty = social.length === 0 && pages.length === 0;

  return (
    <div className="container-px mx-auto max-w-7xl py-14">
      {/* ---- Who we are ----------------------------------------------
          The brand statement leads the page: it is the one thing every visitor
          should read, and it comes from `SiteSettings` so the owner edits it
          at Admin → Settings. CLAUDE.md: don't hardcode brand strings.

          A `<div>`, not a `<header>`: the store layout's navbar is already the
          page's `banner` landmark, and a second one leaves a screen-reader
          user with two "banner" regions and no way to tell which is the site
          header. */}
      <div className="text-center">
        <p className="eyebrow">Our work</p>
        <h1 className="mt-2 font-serif text-4xl leading-tight md:text-5xl">
          {s.brandName}
        </h1>
        {s.tagline && (
          <p className="mt-2 text-sm uppercase tracking-[0.2em] text-accent">
            {s.tagline}
          </p>
        )}
        {s.aboutText && (
          <p className="mx-auto mt-5 max-w-xl text-sm leading-relaxed text-muted-foreground">
            {s.aboutText}
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <ButtonLink href={profileUrl} target="_blank" rel="noreferrer">
            <InstagramIcon className="h-4 w-4" aria-hidden="true" />
            {handle}
            <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </ButtonLink>
          <ButtonLink href="/contact" variant="outline">
            Work with us
          </ButtonLink>
        </div>

        {/*
          Honesty about what this page is. With no Graph API token there is no
          automatic mirror of the whole account, and saying so is better than
          implying one — see the block comment on `fetchInstagramMedia` in
          lib/portfolio.ts. Individual posts *are* mirrored: the poster is
          copied into our own storage and the reel plays on this page.

          Prose behind an (i), per the owner's rule about first impressions.
        */}
        <p className="mt-5 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          {data.live ? (
            <>Pulled live from Instagram, plus our own picks</>
          ) : (
            <>Tap any tile — it plays here, not on Instagram</>
          )}
          <InfoTip term={data.live ? "Live feed" : "How this works"}>
            {data.live
              ? "Recent posts come straight from the Instagram Graph API and refresh every few minutes. Anything we've written up ourselves keeps its own description and stays where we put it."
              : "Every reel and film here opens full-screen on this page, and you can keep scrolling through them without going back. We copy the cover image to our own storage when we add a post; the video itself only streams from Instagram or YouTube once you open it. Mirroring the whole account automatically would need an Instagram Graph API token tied to a Business account, which isn't connected."}
          </InfoTip>
        </p>
      </div>

      {empty ? (
        <div className="mt-10 rounded-2xl border border-dashed border-border p-10 text-center sm:p-12">
          <p className="font-serif text-xl">Nothing here yet</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
            Reels, milestones and customer notes will show up here as they
            happen.
          </p>
          <ButtonLink href="/shop" className="mt-6">
            Browse the collection
          </ButtonLink>
        </div>
      ) : (
        <>
          {/* Two sections is not a tab bar — these are jump links to what is
              already on the page, so there is still exactly one URL and
              nothing to hydrate. `role="tablist"` would lie to a screen reader
              about what pressing them does. */}
          {social.length > 0 && pages.length > 0 && (
            <nav
              aria-label="Jump to a section"
              className="mt-8 flex flex-wrap justify-center gap-2"
            >
              <SectionChip href="#social" label="Social" count={social.length} />
              <SectionChip href="#pages" label="Pages" count={pages.length} />
            </nav>
          )}

          {social.length > 0 && (
            <section id="social" className="mt-12 scroll-mt-24">
              <div className="min-w-0">
                <h2 className="font-serif text-2xl leading-tight sm:text-3xl">
                  Social
                </h2>
                <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
                  Reels and films. Open one and keep scrolling — you never have
                  to come back out.
                </p>
              </div>

              <PortfolioSocial groups={liveGroups} />
            </section>
          )}

          {pages.length > 0 && (
            <section id="pages" className="mt-14 scroll-mt-24">
              <div className="min-w-0">
                <h2 className="font-serif text-2xl leading-tight sm:text-3xl">
                  Pages
                </h2>
                <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
                  What the label has done, in our words and in our customers&rsquo;
                  — plus the bulk and custom runs.
                </p>
              </div>

              <PortfolioPages entries={pages} />
            </section>
          )}
        </>
      )}

      <div className="rule mt-14" />

      <section className="mt-10 text-center">
        <h2 className="font-serif text-2xl">Want something like this?</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
          Bulk runs, campus orders and custom prints — tell us what you need.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <ButtonLink href="/contact">Talk to us</ButtonLink>
          <ButtonLink href="/shop" variant="outline">
            Browse the collection
          </ButtonLink>
        </div>
      </section>
    </div>
  );
}

/**
 * Squared, uppercase, wide-tracked; colour change only — no lift, no shadow,
 * per the design system in CLAUDE.md.
 *
 * The `!` on the border colour guards against `globals.css`'s
 * `* { border-color: var(--border) }`, which is inside `@layer base` today but
 * has escaped that layer twice before. It costs nothing and the failure it
 * prevents is silent.
 */
function SectionChip({
  href,
  label,
  count,
}: {
  href: string;
  label: string;
  count: number;
}) {
  return (
    <a
      href={href}
      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border px-4 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:border-accent! hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {label}
      <span className="tabular-nums opacity-70">{count}</span>
    </a>
  );
}
