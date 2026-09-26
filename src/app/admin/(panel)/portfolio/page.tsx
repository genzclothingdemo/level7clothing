import { Suspense } from "react";
import Link from "next/link";
import { ExternalLink, Plus } from "lucide-react";
import { prisma } from "@/lib/prisma";
import {
  PORTFOLIO_SECTION_META,
  asPortfolioKind,
  embedSrcFromHtml,
  isOptimisableImage,
  isSafeHref,
  publicTags,
  sectionOf,
} from "@/lib/portfolio";
import { planHarvest } from "@/lib/portfolio-harvest";
import { resolveVideo } from "@/lib/videos";
import { PortfolioFilters } from "@/components/admin/portfolio-filters";
import { PortfolioHarvest } from "@/components/admin/portfolio-harvest";
import {
  PortfolioTable,
  type PortfolioRow,
} from "@/components/admin/portfolio-table";

export const dynamic = "force-dynamic";
export const metadata = { title: "Portfolio" };

type SP = Promise<{
  q?: string;
  kind?: string;
  status?: string;
  section?: string;
  source?: string;
}>;

export default async function AdminPortfolio({
  searchParams,
}: {
  searchParams: SP;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().toLowerCase();
  const kind = sp.kind ?? "";
  const status = sp.status ?? "";
  const section = sp.section ?? "";
  const source = sp.source ?? "";
  const filtered = Boolean(q || kind || status || section || source);

  /*
   * Both reads together: they are independent, and this screen is already one
   * of the query-heavy ones CLAUDE.md warns about. `planHarvest` fails soft —
   * `null` simply hides the suggestion panel rather than taking the list down
   * with it, which is the right direction for a hint about work that has not
   * been done.
   */
  const [rows, harvestPlan] = await Promise.all([
    prisma.portfolioItem
      .findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }] })
      .catch(() => []),
    planHarvest().catch((error: unknown) => {
      console.error("[portfolio] could not plan the harvest:", error);
      return null;
    }),
  ]);

  // One query for every linked product rather than one per row. Only active
  // products come back, which is what makes `danglingProduct` below meaningful
  // — a piece pointing at a retired garment should say so rather than quietly
  // dropping the link the way the storefront does.
  const productIds = [
    ...new Set(rows.map((r) => r.productId).filter((v): v is string => Boolean(v))),
  ];
  const products = productIds.length
    ? await prisma.product
        .findMany({
          where: { id: { in: productIds }, isActive: true },
          select: { id: true, name: true, slug: true, images: true },
        })
        .catch(() => [])
    : [];
  const byId = new Map(products.map((p) => [p.id, p]));

  const all: PortfolioRow[] = rows.map((r) => {
    const product = r.productId ? byId.get(r.productId) ?? null : null;
    const thumbnail = r.imageUrl ?? product?.images[0] ?? null;

    // Worked out exactly the way the storefront works it out — same helper,
    // same inputs. The admin saying one shelf while the page shows another is
    // the "two readers" bug CLAUDE.md keeps warning about, so there is only
    // ever one reader: `sectionOf`.
    const embedUrl =
      embedSrcFromHtml(r.embedHtml) ??
      (r.url && isSafeHref(r.url)
        ? resolveVideo({ title: r.title, url: r.url }).embedUrl
        : null);
    const sectionId = sectionOf(r.tags, Boolean(embedUrl));

    return {
      id: r.id,
      kind: asPortfolioKind(r.kind),
      title: r.title,
      url: r.url,
      thumbnail,
      thumbnailOptimisable: thumbnail ? isOptimisableImage(thumbnail) : false,
      section: sectionId,
      sectionLabel: PORTFOLIO_SECTION_META[sectionId].label,
      productName: product?.name ?? null,
      productSlug: product?.slug ?? null,
      danglingProduct: Boolean(r.productId) && !product,
      // Internal tags (`section:…`, `set:demo`) are bookkeeping. They stay
      // searchable below but are not printed as chips, here or on the site.
      tags: publicTags(r.tags),
      sortOrder: r.sortOrder,
      isFeatured: r.isFeatured,
      isActive: r.isActive,
      // Provenance and shape, so the list says what a row *is* without
      // opening it. All three are resolved here for the same reason the
      // section is: the table is a client component and `lib/portfolio.ts`
      // imports Prisma, so nothing may be worked out during render.
      fromCatalogue: Boolean(r.sourceProductId),
      hasBody: Boolean(r.bodyHtml?.trim()),
      extraPhotos: r.images.length,
    };
  });

  // Filtering happens here rather than in a WHERE clause because "which shelf
  // does this land on" is derived from the tags *and* from whether a URL
  // resolved to something playable — which is not a filter SQL can take.
  const visible = all.filter((row) => {
    if (kind && row.kind !== kind) return false;
    if (status === "active" && !row.isActive) return false;
    if (status === "hidden" && row.isActive) return false;
    if (status === "featured" && !row.isFeatured) return false;
    if (section && row.section !== section) return false;
    // "Where did this row come from?" is a question the harvest panel makes
    // worth asking, and it is a column read rather than a derived one.
    if (source === "catalogue" && !row.fromCatalogue) return false;
    if (source === "written" && row.fromCatalogue) return false;
    if (source === "page" && !row.hasBody) return false;
    if (q) {
      // Searches the raw tags too, so an admin who knows a row is tagged
      // `set:demo` can still find it by typing that.
      const raw = rows.find((r) => r.id === row.id)?.tags ?? [];
      const hay = [row.title, row.url ?? "", row.productName ?? "", ...raw]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const showing = all.filter((r) => r.isActive).length;

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-serif text-2xl">Portfolio</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {all.length} piece{all.length === 1 ? "" : "s"} · {showing} showing on
            the site
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Link
            href="/portfolio"
            target="_blank"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 text-[11px] font-medium uppercase tracking-widest transition-colors hover:bg-muted"
          >
            <ExternalLink className="h-4 w-4" /> View page
          </Link>
          <Link
            href="/admin/portfolio/new"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-foreground px-5 text-[11px] font-medium uppercase tracking-widest text-background transition-opacity hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> Add piece
          </Link>
        </div>
      </div>

      <div className="mt-6 min-w-0 rounded-2xl border border-border bg-muted/30 p-4 sm:p-5">
        <p className="eyebrow text-muted-foreground">
          How a piece finds its section
        </p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          The portfolio page is about the label, not the catalogue:{" "}
          <span className="text-foreground">who we are</span>,{" "}
          <span className="text-foreground">milestones</span>,{" "}
          <span className="text-foreground">reels &amp; films</span>,{" "}
          <span className="text-foreground">happy customers</span>,{" "}
          <span className="text-foreground">collaborations</span> and{" "}
          <span className="text-foreground">bulk &amp; custom work</span>. Pick a
          section on the piece, or leave it on auto and we read it from your tags
          — anything that plays and has no tag lands under Reels &amp; films.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Attaching a product no longer moves a piece anywhere; it just adds a
          small &ldquo;Wearing …&rdquo; link so a shopper can find the garment in
          the shot.
        </p>
      </div>

      {/* Reels already in the catalogue. Detection is automatic; publishing
          is a press — see the header of `portfolio-harvest.tsx` for why the
          old always-on derived read was deleted. The plan is read here rather
          than in a mount effect, so the panel arrives with its answer instead
          of flashing a spinner on a screen the owner opens constantly. */}
      <PortfolioHarvest initialPlan={harvestPlan} />

      <div className="mt-6 min-w-0">
        {/* `useSearchParams` needs a Suspense boundary above it. */}
        <Suspense fallback={<div className="h-16" />}>
          <PortfolioFilters />
        </Suspense>
      </div>

      <PortfolioTable rows={visible} canReorder={!filtered} filtered={filtered} />
    </div>
  );
}
