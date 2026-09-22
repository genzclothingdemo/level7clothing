import type { Metadata } from "next";
import { ArrowUpRight } from "lucide-react";
import { InstagramIcon } from "@/components/store/instagram-icon";
import { ButtonLink } from "@/components/ui/button";
import { InfoTip } from "@/components/store/info-tip";
import { PortfolioGrid } from "@/components/store/portfolio-grid";
import {
  PortfolioNotes,
  PortfolioQuotes,
  PortfolioStats,
} from "@/components/store/portfolio-cards";
import {
  PortfolioTabs,
  type PortfolioNavItem,
} from "@/components/store/portfolio-tabs";
import { Pagination, paginate, parsePageParam } from "@/components/store/pagination";
import { getSettings } from "@/lib/settings";
import {
  asPortfolioSection,
  getPortfolio,
  instagramHandle,
  type PortfolioSectionGroup,
} from "@/lib/portfolio";

export const dynamic = "force-dynamic";

/**
 * /portfolio — a **brand page**, not a second shop.
 *
 * The owner's brief: *"improve portfolio section. it shows big achievement,
 * who are we, and instagram reels etc. product waha pe nahi chahiye. kuchh
 * reels, happy customer or some achievement except insta reel"*. So the
 * organising idea is what the work says about the label — who we are,
 * milestones, reels, happy customers, collaborations, bulk work — and a
 * garment is at most a footnote on a card. See the header of
 * `lib/portfolio.ts` for the shelf list and how a row is placed on one.
 *
 * ── Why the whole page by default, and a `?section=` narrowing ───────────────
 *
 * The two tabs this replaces forced a choice before the visitor had seen
 * anything. A brand page has to be *read down*, so the default — and the
 * canonical URL — is every shelf in order. The chips narrow to one shelf, which
 * is a real crawlable URL, and that is also the answer to "the owner has fifty
 * reels": each shelf caps at `PREVIEW` on the full page and the chip opens the
 * paginated rest.
 *
 * ── Why `?page=` only exists inside a section ────────────────────────────────
 *
 * Paginating six stacked shelves at once has no honest meaning — page 2 of
 * *what*? On the full page every shelf shows its first `PREVIEW` entries and
 * says how many more there are; pagination only appears once a single shelf is
 * selected, where "page 2" means exactly one thing.
 */

/**
 * 12 in one shelf — three full rows of the 4-up desktop grid, six of the 2-up
 * phone grid, so a page never ends on a ragged half-row.
 *
 * `PREVIEW` is deliberately smaller: on the full page a shelf is an
 * invitation, not the archive.
 */
const PER_PAGE = 12;
const PREVIEW = 6;

type SP = Promise<{ section?: string; page?: string; view?: string }>;

/** Page 1 of a shelf is its bare URL, so it has one canonical address, not two. */
function canonicalFor(section: string | null, page: number): string {
  const base = section ? `/portfolio?section=${section}` : "/portfolio";
  if (page <= 1) return base;
  return `${base}${section ? "&" : "?"}page=${page}`;
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: SP;
}): Promise<Metadata> {
  const sp = await searchParams;
  const section = asPortfolioSection(sp.section);
  const [s, data] = await Promise.all([getSettings(), getPortfolio()]);

  const group = section ? data.sections.find((g) => g.id === section) ?? null : null;

  // Clamped against the real page count, so an out-of-range `?page=99` — which
  // renders the last page — doesn't advertise a canonical nobody can reach.
  // `getPortfolio` is `cache()`d, so this costs the page body nothing.
  const totalPages = group
    ? Math.max(1, Math.ceil(group.entries.length / PER_PAGE))
    : 1;
  const page = Math.min(parsePageParam(sp.page), totalPages);

  const title = group
    ? page > 1
      ? `${group.label} — Page ${page}`
      : `${group.label} · Portfolio`
    : page > 1
      ? `Portfolio — Page ${page}`
      : "Portfolio";

  const description = group
    ? `${group.blurb} — ${s.brandName}.`
    : `Who ${s.brandName} is, what we have done, and the reels, customers and collaborations behind the label.`;

  return {
    title,
    description,
    alternates: { canonical: canonicalFor(section, page) },
    openGraph: {
      title: `${group ? `${group.label} · ` : ""}Portfolio · ${s.brandName}`,
      description,
      url: canonicalFor(section, page),
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

/**
 * One shelf, in whichever shape its `layout` calls for.
 *
 * The branch is on `layout`, not on `id`, so adding a seventh section is a row
 * in `PORTFOLIO_SECTION_META` and nothing here changes.
 */
function Shelf({
  group,
  entries,
  more,
}: {
  group: PortfolioSectionGroup;
  entries: typeof group.entries;
  /** How many were held back on the full page, and where to see them. */
  more: number;
}) {
  return (
    <section id={group.id} className="mt-14 scroll-mt-24 first:mt-10">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 className="font-serif text-2xl leading-tight sm:text-3xl">
            {group.label}
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            {group.blurb}
          </p>
        </div>
        {more > 0 && (
          <a
            href={`/portfolio?section=${group.id}`}
            className="link-underline inline-flex min-h-11 shrink-0 items-center gap-1.5 text-xs font-medium uppercase tracking-widest"
          >
            {more} more
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        )}
      </div>

      {group.layout === "media" ? (
        <PortfolioGrid entries={entries} />
      ) : group.layout === "stat" ? (
        <PortfolioStats entries={entries} />
      ) : group.layout === "quote" ? (
        <PortfolioQuotes entries={entries} />
      ) : (
        <PortfolioNotes entries={entries} />
      )}
    </section>
  );
}

export default async function PortfolioPage({
  searchParams,
}: {
  searchParams: SP;
}) {
  const sp = await searchParams;
  const section = asPortfolioSection(sp.section);

  const [s, data] = await Promise.all([getSettings(), getPortfolio()]);
  const handle = instagramHandle(s.instagram);
  const profileUrl = s.instagram || "https://instagram.com";

  const group = section ? data.sections.find((g) => g.id === section) ?? null : null;
  // A `?section=` naming a shelf with nothing on it falls back to the whole
  // page rather than to an empty screen — the shelf is real, it is just empty
  // today, and an empty screen reads as a broken link.
  const showingOne = group !== null;
  const paged = showingOne ? paginate(group.entries, sp.page, PER_PAGE) : null;

  const nav: PortfolioNavItem[] = [
    { id: null, label: "All", count: data.total },
    ...data.sections.map((g) => ({
      id: g.id,
      label: g.label,
      count: g.entries.length,
    })),
  ];

  return (
    <div className="container-px mx-auto max-w-7xl py-14">
      {/* ---- Who we are ----------------------------------------------
          The brand statement leads the page, not a shelf: it is the one thing
          every visitor should read, and it comes from `SiteSettings` so the
          owner edits it at Admin → Settings rather than here. CLAUDE.md:
          don't hardcode brand strings.

          A `<div>`, not a `<header>`: the store layout's navbar is already the
          page's `banner` landmark, and a second one leaves a screen-reader
          user with two "banner" regions and no way to tell which is the site
          header. The version this replaces had that bug. */}
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
        */}
        <p className="mt-5 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          {data.live ? (
            <>Pulled live from Instagram, plus our own picks</>
          ) : (
            <>Hand-picked by us, and it plays here</>
          )}
          <InfoTip term={data.live ? "Live feed" : "How this works"}>
            {data.live
              ? "Recent posts come straight from the Instagram Graph API and refresh every few minutes. Anything we've written up ourselves keeps its own description and stays where we put it."
              : "Every reel and film below plays on this page — we copy the cover image to our own storage when we add it, and the video itself streams from Instagram or YouTube only once you press play. Mirroring the whole account automatically would need an Instagram Graph API token tied to a Business account, which isn't connected."}
          </InfoTip>
        </p>
      </div>

      <PortfolioTabs items={nav} active={section} />

      {data.sections.length === 0 ? (
        <div className="mt-10 rounded-2xl border border-dashed border-border p-10 text-center sm:p-12">
          <p className="font-serif text-xl">Nothing here yet</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
            Reels, milestones, customer notes and collaborations will show up
            here as they happen.
          </p>
          <ButtonLink href="/shop" className="mt-6">
            Browse the collection
          </ButtonLink>
        </div>
      ) : showingOne && paged ? (
        <>
          <Shelf group={group} entries={paged.items} more={0} />
          <Pagination
            page={paged.page}
            totalPages={paged.totalPages}
            // `section` is carried through, `page` is rebuilt — see pagination.tsx.
            params={{ section: group.id }}
            basePath="/portfolio"
          />
        </>
      ) : (
        data.sections.map((g) => (
          <Shelf
            key={g.id}
            group={g}
            entries={g.entries.slice(0, PREVIEW)}
            more={Math.max(0, g.entries.length - PREVIEW)}
          />
        ))
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
