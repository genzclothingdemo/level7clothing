import { Suspense } from "react";
import type { Metadata } from "next";
import { getProducts, type ShopQuery } from "@/lib/products";
import { ProductCard } from "@/components/store/product-card";
import { Reveal } from "@/components/store/reveal";
import { ShopFilters } from "@/components/store/shop-filters";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type SP = Promise<{ category?: string; q?: string; sort?: string }>;

/**
 * Category-aware metadata so each collection URL gets its own title, description
 * and canonical instead of every filter sharing one generic "Shop" page.
 * Search result pages are left noindex — they're thin/duplicate by nature.
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: SP;
}): Promise<Metadata> {
  const sp = await searchParams;
  const category = sp.category?.trim();
  const q = sp.q?.trim();

  if (q) {
    return {
      title: `Search: ${q}`,
      description: `Search results for “${q}” at Level7 Clothing.`,
      robots: { index: false, follow: true },
    };
  }

  if (category) {
    return {
      title: category,
      description: `Shop ${category.toLowerCase()} at Level7 Clothing — premium heavyweight cotton, unisex sizing S–2XL, cash on delivery and fast shipping across India.`,
      keywords: [
        category,
        `buy ${category.toLowerCase()} online India`,
        "unisex oversized fit",
        "premium cotton streetwear",
        "Level7 Clothing",
      ],
      alternates: {
        canonical: `/shop?category=${encodeURIComponent(category)}`,
      },
      openGraph: {
        title: `${category} · Level7 Clothing`,
        description: `Shop ${category.toLowerCase()} — premium heavyweight cotton, unisex oversized fits.`,
        type: "website",
      },
    };
  }

  return {
    title: "Shop all",
    description:
      "Shop premium oversized t-shirts and drop-shoulder hoodies from Level7 Clothing. Unisex sizing S–2XL, heavyweight cotton, cash on delivery across India.",
    keywords: [
      "oversized t-shirts India",
      "graphic tees online",
      "drop-shoulder hoodies",
      "unisex streetwear",
      "premium cotton t-shirts",
      "Level7 Clothing",
    ],
    alternates: { canonical: "/shop" },
  };
}

export default async function ShopPage({
  searchParams,
}: {
  searchParams: SP;
}) {
  const sp = await searchParams;
  const query: ShopQuery = {
    category: sp.category,
    q: sp.q,
    sort: (sp.sort as ShopQuery["sort"]) ?? "newest",
  };
  
  const [products, categoriesList] = await Promise.all([
    getProducts(query),
    prisma.category.findMany({ orderBy: { name: "asc" } }),
  ]);
  const categories = categoriesList.map((c) => c.name);

  return (
    <div className="container-px mx-auto max-w-7xl py-8 md:py-12">
      <header className="mb-6 md:mb-8">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">
          The collection
        </p>
        <h1 className="mt-1 font-serif text-3xl md:text-4xl">
          {sp.category && sp.category !== "All" ? sp.category : "Shop all"}
        </h1>
      </header>

      <Suspense fallback={<div className="h-24" />}>
        <ShopFilters categories={categories} />
      </Suspense>

      {products.length > 0 ? (
        <div className="mt-8 grid grid-cols-3 gap-x-3 gap-y-7 sm:gap-x-5 sm:gap-y-10 md:mt-10 md:grid-cols-3 lg:grid-cols-4">
          {products.map((p, i) => (
            <Reveal key={p.id} delay={Math.min(i * 0.05, 0.3)}>
              <ProductCard product={p} />
            </Reveal>
          ))}
        </div>
      ) : (
        <div className="mt-16 rounded-2xl border border-dashed border-border p-12 text-center">
          <p className="font-serif text-xl">No styles found</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Try a different category or search term.
          </p>
        </div>
      )}
    </div>
  );
}
