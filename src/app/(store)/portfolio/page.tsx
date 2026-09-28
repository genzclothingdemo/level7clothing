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
 * ── The page does not explain itself ────────────────────────────────────────
 *
 * The owner's note, verbatim: *"explaination text 00 kar do."* This page had
 * an intro paragraph, a sentence under each of the two headings, a sentence
 * under each of the three groups, a standing hint reading "Tap any tile — it
 * plays here, not on Instagram", and a line of sell copy over the closing
 * buttons. Seven paragraphs of narration around the work itself.
 *
 * A portfolio shows. What survives is the vocabulary CLAUDE.md already
 * prescribes for this store — `.eyebrow` labels, counts, and **one** `(i)`
 * carrying everything that is genuinely worth saying, on the heading it is
 * about. Prose belongs behind an info affordance, not in the first impression.
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
 * is the point: the union in `lib/portfolio.ts` is that module's to widen, and
 * it has already carried more and fewer members than it does today. Written
 * this way the lookup typechecks against whatever the union is now and keeps
 * working through the next spelling, with no edit here.
 *
 * A group with nothing in it hides itself, which is honest: an empty group is
 * better than guessing, and guessing was available — `entry.product !== null`
 * is *not* the same question. A reel the owner added by hand can also name a
 * garment; that does not make it a product video.
 */
const PRODUCT_SOURCES: ReadonlySet<string> = new Set([
  "product-video",
  "product-videos",
  "product",
  "products",
  "product-link",
]);

type SocialGroupId = "shoppable" | "studio" | "youtube";

/**
 * Two or three words each, and no sentence.
 *
 * These are **tab labels** now, not shelf headings with a blurb under them, so
 * they have to survive being read at 11px beside a count on a 320px screen.
 * The same string names the set inside the reel viewer ("STUDIO · 12 / 54"),
 * which is the only place a visitor is told which feed they are swiping
 * through — so short is not a compromise here, it is the requirement.
 */
const SOCIAL_GROUP_LABEL: Record<SocialGroupId, string> = {
  shoppable: "On a piece",
  studio: "Studio",
  youtube: "YouTube",
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
    label: SOCIAL_GROUP_LABEL[id],
    entries: social.filter((entry) => socialGroupOf(entry) === id),
  }));

  const liveGroups = groups.filter((g) => g.entries.length > 0);
  const empty = social.length === 0 && pages.length === 0;

  return (
    <div className="container-px mx-auto max-w-7xl py-9 sm:py-14">
      {/* ---- Masthead ------------------------------------------------
          The brand, the line under it, and one way out. Deliberately short:
          this is a page whose job is to show work, and every pixel spent above
          the first photograph is a pixel of not showing it. At 320×800 the
          masthead plus one section header already runs to most of a screen.

          Two things that used to be here are gone for the same reason, and
          both were duplicates rather than sacrifices: `aboutText`, which has a
          page of its own at /about, and a "Work with us" button pointing at
          /contact — which the closing block already offers as "Talk to us".

          A `<div>`, not a `<header>`: the store layout's navbar is already the
          page's `banner` landmark, and a second one leaves a screen-reader
          user with two "banner" regions and no way to tell which is the site
          header. */}
      <div className="text-center">
        <p className="eyebrow">Our work</p>
        <h1 className="display-tight mt-2.5 font-serif text-4xl leading-none sm:text-5xl md:text-6xl">
          {s.brandName}
        </h1>
        {s.tagline && (
          <p className="mt-2.5 text-[11px] uppercase tracking-[0.22em] text-accent sm:text-xs">
            {s.tagline}
          </p>
        )}

        <div className="mt-5 flex justify-center">
          <ButtonLink href={profileUrl} target="_blank" rel="noreferrer">
            <InstagramIcon className="h-4 w-4" aria-hidden="true" />
            {handle}
            <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </ButtonLink>
        </div>
      </div>

      {empty ? (
        <div className="mt-10 rounded-2xl border border-dashed border-border p-10 text-center sm:p-14">
          <p className="font-serif text-xl">Nothing here yet</p>
          <ButtonLink href="/shop" className="mt-6">
            Browse the collection
          </ButtonLink>
        </div>
      ) : (
        <>
          {/* There is no section index above this, and that is the second
              duplicate removed: two chips reading "SOCIAL 166 · PAGES 63" sat
              eighty pixels above two headings reading "Social … 166 posts" and
              "Pages … 63 pages". The counts have one home now — the heading
              they belong to — and the hairline rules do the dividing. */}
          {social.length > 0 && (
            <section id="social" className="mt-10 scroll-mt-24 sm:mt-14">
              <SectionHead label="Social" count={social.length} unit="posts">
                {/*
                  The one piece of prose left on the page, behind the (i) that
                  CLAUDE.md prescribes for exactly this. It carries what a
                  visitor might reasonably wonder and what we owe them
                  honestly: the reels play on this page, nothing is embedded
                  until one is opened, and with no Graph API token this is a
                  curated set rather than a mirror of the whole account.
                */}
                <InfoTip term="Social">
                  {data.live
                    ? "Recent posts come straight from the Instagram Graph API and refresh every few minutes. Anything we have written up ourselves keeps its own description and stays where we put it."
                    : "Every reel and film here opens full-screen on this page, and you can keep scrolling through them without coming back out. Nothing is loaded from Instagram or YouTube until you open one. Mirroring the whole account automatically would need an Instagram Graph API token tied to a Business account, which isn't connected — so this is a set we pick, not a live feed."}
                </InfoTip>
              </SectionHead>

              <PortfolioSocial groups={liveGroups} />
            </section>
          )}

          {pages.length > 0 && (
            <section id="pages" className="mt-12 scroll-mt-24 sm:mt-16">
              <SectionHead label="Pages" count={pages.length} unit="pages" />
              <PortfolioPages entries={pages} />
            </section>
          )}
        </>
      )}

      <section className="mt-14 sm:mt-18">
        <div className="rule" />
        <div className="mt-8 text-center">
          <h2 className="display-tight font-serif text-2xl sm:text-3xl">
            Want something like this?
          </h2>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
            <ButtonLink href="/contact">Talk to us</ButtonLink>
            <ButtonLink href="/shop" variant="outline">
              Browse the collection
            </ButtonLink>
          </div>
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Section furniture                                                  */
/* ------------------------------------------------------------------ */

/**
 * A rule, a big name, a count. That is the whole divider.
 *
 * The two sections used to be an `h2` with a sentence under it, one after the
 * other down a single column — which is why they "read as one long scroll".
 * What separates them now is structural rather than verbal: a hairline across
 * the full measure, a heading at display size against it, and the count set
 * right so the eye has two anchors on the line instead of one.
 *
 * `children` is where a section's `(i)` goes, and it is typed as
 * `React.ReactNode` — never as a component. CLAUDE.md: a Lucide icon is a
 * `forwardRef` object, so passing the component itself from a server file to a
 * client one throws at render with a clean typecheck behind it.
 */
function SectionHead({
  label,
  count,
  unit,
  children,
}: {
  label: string;
  count: number;
  unit: string;
  children?: React.ReactNode;
}) {
  return (
    <>
      <div className="rule" />
      <div className="mt-4 flex items-end justify-between gap-4">
        <h2 className="display-tight min-w-0 font-serif text-3xl leading-none sm:text-4xl">
          {label}
          {children}
        </h2>
        <span className="eyebrow shrink-0 pb-1 tabular-nums">
          {count} {unit}
        </span>
      </div>
    </>
  );
}

