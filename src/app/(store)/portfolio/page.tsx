import type { Metadata } from "next";
import { ArrowUpRight } from "lucide-react";
import { InstagramIcon } from "@/components/store/instagram-icon";
import { ButtonLink } from "@/components/ui/button";
import { InfoTip } from "@/components/store/info-tip";
import { PortfolioGrid } from "@/components/store/portfolio-grid";
import { PortfolioTabs } from "@/components/store/portfolio-tabs";
import { Pagination, paginate, parsePageParam } from "@/components/store/pagination";
import { getSettings } from "@/lib/settings";
import { asPortfolioView, getPortfolio, instagramHandle } from "@/lib/portfolio";

export const dynamic = "force-dynamic";

/**
 * 12 tiles a page — three full rows of the 4-up desktop grid, six of the 2-up
 * phone grid, so a page never ends on a ragged half-row. It is also the
 * answer to "the owner has ~50 reels": at 50 entries this is five pages of
 * twelve posters, not one page of fifty iframes.
 */
const PER_PAGE = 12;

type SP = Promise<{ view?: string; page?: string }>;

/** Page 1 is the bare URL, so a shelf has one canonical address, not two. */
function canonicalFor(view: string, page: number): string {
  const base = view === "other" ? "/portfolio?view=other" : "/portfolio";
  if (page <= 1) return base;
  return `${base}${view === "other" ? "&" : "?"}page=${page}`;
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: SP;
}): Promise<Metadata> {
  const sp = await searchParams;
  const view = asPortfolioView(sp.view);
  const [s, data] = await Promise.all([getSettings(), getPortfolio()]);

  // Clamped against the real page count, so an out-of-range `?page=99` — which
  // renders the last page — doesn't advertise a canonical nobody can reach.
  // `getPortfolio` is `cache()`d, so this costs the page body nothing.
  const entries = view === "other" ? data.other : data.products;
  const totalPages = Math.max(1, Math.ceil(entries.length / PER_PAGE));
  const page = Math.min(parsePageParam(sp.page), totalPages);

  const title = page > 1 ? `Portfolio — Page ${page}` : "Portfolio";
  const description =
    view === "other"
      ? `Collaborations, bulk orders and features — the work ${s.brandName} does beyond the shop.`
      : `Reels, films and shoots of ${s.brandName} pieces, each one linked to the garment in it.`;

  return {
    title,
    description,
    alternates: { canonical: canonicalFor(view, page) },
    openGraph: {
      title: `Portfolio · ${s.brandName}`,
      description,
      url: canonicalFor(view, page),
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

export default async function PortfolioPage({
  searchParams,
}: {
  searchParams: SP;
}) {
  const sp = await searchParams;
  const view = asPortfolioView(sp.view);

  const [s, data] = await Promise.all([getSettings(), getPortfolio()]);
  const handle = instagramHandle(s.instagram);
  const profileUrl = s.instagram || "https://instagram.com";

  const entries = view === "other" ? data.other : data.products;
  const paged = paginate(entries, sp.page, PER_PAGE);

  return (
    <div className="container-px mx-auto max-w-7xl py-14">
      <header className="text-center">
        <p className="eyebrow">Our work</p>
        <h1 className="mt-2 font-serif text-4xl leading-tight md:text-5xl">
          Portfolio
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
          Reels, shoots, collaborations and bulk work. Everything with a garment
          in it links straight to the piece.
        </p>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <ButtonLink href={profileUrl} target="_blank" rel="noreferrer">
            <InstagramIcon className="h-4 w-4" aria-hidden="true" />
            {handle}
            <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </ButtonLink>
          <ButtonLink href="/shop" variant="outline">
            Shop the looks
          </ButtonLink>
        </div>

        {/*
          Honesty about what this page is. With no Graph API token there is no
          live mirror, and saying so is better than implying one — see the
          block comment on `fetchInstagramMedia` in lib/portfolio.ts.
        */}
        <p className="mt-5 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          {data.live ? (
            <>Pulled live from Instagram, plus our own picks</>
          ) : (
            <>Hand-picked by us, not a live feed</>
          )}
          <InfoTip term={data.live ? "Live feed" : "Why this isn't a live feed"}>
            {data.live
              ? "Recent posts come straight from the Instagram Graph API and refresh every few minutes. Anything we've written up ourselves keeps its own description and stays where we put it."
              : "Pulling real posts needs an Instagram Graph API token tied to a Business account, which isn't connected. Everything here was chosen by hand instead — tap through to Instagram for the very latest."}
          </InfoTip>
        </p>
      </header>

      <PortfolioTabs
        view={view}
        counts={{ products: data.products.length, other: data.other.length }}
      />

      {paged.items.length > 0 ? (
        <>
          <PortfolioGrid entries={paged.items} />
          <Pagination
            page={paged.page}
            totalPages={paged.totalPages}
            // `view` is carried through, `page` is rebuilt — see pagination.tsx.
            params={view === "other" ? { view: "other" } : {}}
            basePath="/portfolio"
          />
        </>
      ) : (
        <div className="mt-10 rounded-2xl border border-dashed border-border p-10 text-center sm:p-12">
          <p className="font-serif text-xl">
            {view === "other"
              ? "Nothing here yet"
              : "No product films yet"}
          </p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
            {view === "other"
              ? "Collaborations and features will show up here."
              : "Films and shoots of individual pieces will show up here."}
          </p>
          <ButtonLink href="/shop" className="mt-6">
            Browse the collection
          </ButtonLink>
        </div>
      )}

      <div className="rule mt-14" />

      <section className="mt-10 text-center">
        <h2 className="font-serif text-2xl">Seen something you like?</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
          Every piece in these shots is in the shop.
        </p>
        <ButtonLink href="/shop" className="mt-6">
          Browse the collection
        </ButtonLink>
      </section>
    </div>
  );
}
