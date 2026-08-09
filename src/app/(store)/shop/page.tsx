import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { ChevronRight } from "lucide-react";
import { getProducts, type ShopQuery } from "@/lib/products";
import {
  getCategoryTiles,
  getShopTiles,
  getSubcategoryView,
  type CategoryTile,
} from "@/lib/catalog";
import { ProductCard } from "@/components/store/product-card";
import { getReviewSummaries, type ReviewSummary } from "@/lib/reviews";
import { SubcategoryCard } from "@/components/store/subcategory-card";
import { Reveal } from "@/components/store/reveal";
import { ShopFilters } from "@/components/store/shop-filters";
import { prisma } from "@/lib/prisma";
import { formatINR } from "@/lib/utils";

export const dynamic = "force-dynamic";

type SP = Promise<{
  category?: string;
  sub?: string;
  q?: string;
  sort?: string;
}>;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: SP;
}): Promise<Metadata> {
  const sp = await searchParams;

  // Search result pages are near-infinite and thin — keep them out of the
  // index but let crawlers follow through to the products themselves.
  if (sp.q) {
    return {
      title: `Search: ${sp.q}`,
      description: `Tees, hoodies and streetwear matching “${sp.q}”.`,
      robots: { index: false, follow: true },
    };
  }

  // A subcategory is a real, indexable shelf of its own.
  if (sp.category && sp.sub) {
    const view = await getSubcategoryView(sp.category, sp.sub);
    if (view) {
      const url = `/shop?category=${encodeURIComponent(sp.category)}&sub=${
        view.slug
      }`;
      return {
        title: `${view.name} — ${view.categoryName}`,
        description: `${
          view.products.length
        } ${view.name.toLowerCase()} designs in premium cotton, made in India. Free shipping and cash on delivery available.`,
        keywords: [
          view.name,
          `${view.name.toLowerCase()} online India`,
          view.categoryName,
        ],
        alternates: { canonical: url },
        openGraph: { title: `${view.name} — ${view.categoryName}`, url },
      };
    }
  }

  if (sp.category && sp.category !== "All") {
    const c = sp.category;
    return {
      title: `${c} — Premium Streetwear`,
      description: `Shop ${c.toLowerCase()} in premium cotton — designed and made in India. Free shipping across India, cash on delivery available.`,
      keywords: [`${c.toLowerCase()} online India`, `buy ${c.toLowerCase()}`, c],
      alternates: { canonical: `/shop?category=${encodeURIComponent(c)}` },
      openGraph: {
        title: `${c} — Premium Streetwear`,
        url: `/shop?category=${encodeURIComponent(c)}`,
      },
    };
  }

  return {
    title: "Shop All — Tees, Hoodies & Streetwear",
    description:
      "Browse the full range — oversized tees, drop-shoulder hoodies and everyday essentials in premium cotton. Free shipping across India.",
    keywords: [
      "buy oversized t-shirts online India",
      "graphic tees India",
      "drop-shoulder hoodies",
      "unisex streetwear",
    ],
    alternates: { canonical: "/shop" },
  };
}

// 2-up on phones so each tile is large enough to read; 3-up from sm and
// 4-up on desktop keeps the shelf density every real store uses.
const GRID =
  "mt-8 grid grid-cols-2 gap-x-3 gap-y-7 sm:grid-cols-3 sm:gap-x-5 sm:gap-y-10 md:mt-10 lg:grid-cols-4";

function Empty({ message }: { message: string }) {
  return (
    <div className="mt-16 rounded-2xl border border-dashed border-border p-12 text-center">
      <p className="font-serif text-xl">No pieces found</p>
      <p className="mt-2 text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

type Ratings = Map<string, ReviewSummary>;

/** One grouped review query per page, not one per card. */
async function ratingsFor(products: { id: string }[]): Promise<Ratings> {
  return getReviewSummaries(products.map((p) => p.id));
}

/** One grid for both shapes of listing — groups and products sit side by side. */
function TileGrid({ tiles, ratings }: { tiles: CategoryTile[]; ratings: Ratings }) {
  return (
    <div className={GRID}>
      {tiles.map((tile, i) => (
        <Reveal
          key={tile.kind === "product" ? tile.product.id : tile.id}
          delay={Math.min(i * 0.05, 0.3)}
        >
          {tile.kind === "product" ? (
            <ProductCard
              product={tile.product}
              rating={ratings.get(tile.product.id)}
            />
          ) : (
            <SubcategoryCard tile={tile} />
          )}
        </Reveal>
      ))}
    </div>
  );
}

export default async function ShopPage({
  searchParams,
}: {
  searchParams: SP;
}) {
  const sp = await searchParams;
  const sort = (sp.sort as ShopQuery["sort"]) ?? "newest";
  const categoriesList = await prisma.category.findMany({
    orderBy: { name: "asc" },
  });
  const categories = categoriesList.map((c) => c.name);
  const inCategory = !!sp.category && sp.category !== "All";

  // ---- Level 3: inside one subcategory — the real, individual pieces ----
  // Skipped while searching, because a search should reach products directly.
  if (inCategory && sp.sub && !sp.q) {
    const view = await getSubcategoryView(sp.category!, sp.sub, sort);
    if (view) {
      const range =
        view.priceMin === view.priceMax
          ? formatINR(view.priceMin)
          : `${formatINR(view.priceMin)} – ${formatINR(view.priceMax)}`;
      const subRatings = await ratingsFor(view.products);

      return (
        <div className="container-px mx-auto max-w-7xl py-8 md:py-12">
          <header className="mb-6 md:mb-8">
            <nav className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              <Link href="/shop" className="hover:text-foreground">
                Shop
              </Link>
              <ChevronRight className="h-3 w-3" />
              <Link
                href={`/shop?category=${encodeURIComponent(view.categoryName)}`}
                className="hover:text-foreground"
              >
                {view.categoryName}
              </Link>
              <ChevronRight className="h-3 w-3" />
              <span className="text-foreground">{view.name}</span>
            </nav>
            <h1 className="mt-2 font-serif text-3xl md:text-4xl">{view.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {view.products.length} design
              {view.products.length === 1 ? "" : "s"} · {range}
            </p>
          </header>

          <Suspense fallback={<div className="h-24" />}>
            <ShopFilters categories={categories} />
          </Suspense>

          {view.products.length > 0 ? (
            <div className={GRID}>
              {view.products.map((p, i) => (
                <Reveal key={p.id} delay={Math.min(i * 0.05, 0.3)}>
                  <ProductCard product={p} rating={subRatings.get(p.id)} />
                </Reveal>
              ))}
            </div>
          ) : (
            <Empty message="This collection is being restocked — check back soon." />
          )}
        </div>
      );
    }
    // An unknown subcategory falls through to the category page below.
  }

  // ---- Level 2: a category — groups as tiles, one-offs as products ----
  if (inCategory && !sp.q) {
    const tiles = await getCategoryTiles(sp.category!, sort);
    const tileRatings = await ratingsFor(
      tiles.flatMap((t) => (t.kind === "product" ? [t.product] : []))
    );

    return (
      <div className="container-px mx-auto max-w-7xl py-8 md:py-12">
        <header className="mb-6 md:mb-8">
          <nav className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            <Link href="/shop" className="hover:text-foreground">
              Shop
            </Link>
            <ChevronRight className="h-3 w-3" />
            <span className="text-foreground">{sp.category}</span>
          </nav>
          <h1 className="mt-2 font-serif text-3xl md:text-4xl">
            {sp.category}
          </h1>
        </header>

        <Suspense fallback={<div className="h-24" />}>
          <ShopFilters categories={categories} />
        </Suspense>

        {tiles.length > 0 ? (
          <TileGrid tiles={tiles} ratings={tileRatings} />
        ) : (
          <Empty message="Nothing in this category yet — try another one." />
        )}
      </div>
    );
  }

  // ---- A search reaches individual pieces, so it stays a flat product list ----
  if (sp.q) {
    const products = await getProducts({ category: sp.category, q: sp.q, sort });
    const catRatings = await ratingsFor(products);
    return (
      <div className="container-px mx-auto max-w-7xl py-8 md:py-12">
        <header className="mb-6 md:mb-8">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            Search
          </p>
          <h1 className="mt-1 font-serif text-3xl md:text-4xl">
            “{sp.q}”
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {products.length} piece{products.length === 1 ? "" : "s"} found
          </p>
        </header>

        <Suspense fallback={<div className="h-24" />}>
          <ShopFilters categories={categories} />
        </Suspense>

        {products.length > 0 ? (
          <div className={GRID}>
            {products.map((p, i) => (
              <Reveal key={p.id} delay={Math.min(i * 0.05, 0.3)}>
                <ProductCard product={p} rating={catRatings.get(p.id)} />
              </Reveal>
            ))}
          </div>
        ) : (
          <Empty message="Try a different category or search term." />
        )}
      </div>
    );
  }

  // ---- Level 1: shop all — folded the same way as a category page ----
  const tiles = await getShopTiles(sort);
  const allRatings = await ratingsFor(
    tiles.flatMap((t) => (t.kind === "product" ? [t.product] : []))
  );

  return (
    <div className="container-px mx-auto max-w-7xl py-8 md:py-12">
      <header className="mb-6 md:mb-8">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          The collection
        </p>
        <h1 className="mt-1 font-serif text-3xl md:text-4xl">Shop all</h1>
      </header>

      <Suspense fallback={<div className="h-24" />}>
        <ShopFilters categories={categories} />
      </Suspense>

      {tiles.length > 0 ? (
        <TileGrid tiles={tiles} ratings={allRatings} />
      ) : (
        <Empty message="Nothing here yet — please check back soon." />
      )}
    </div>
  );
}
