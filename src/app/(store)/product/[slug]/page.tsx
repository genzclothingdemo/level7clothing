import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { Truck, ShieldCheck, Shirt, ChevronRight } from "lucide-react";
import { getProductBySlug, getRelated } from "@/lib/products";
import { prisma } from "@/lib/prisma";
import { formatINR } from "@/lib/utils";
import { ProductGallery } from "@/components/store/product-gallery";
import { ProductPurchase } from "@/components/store/product-purchase";
import { ProductCard } from "@/components/store/product-card";
import {
  ProductReviews,
  type PublicReview,
} from "@/components/store/product-reviews";
import { ProductViewProvider } from "@/context/product-view";
import { normalizeVariants, priceRange } from "@/lib/variants";

export const dynamic = "force-dynamic";

function siteUrl() {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) return { title: "Product" };

  // Lead the description with intent-matching terms (price, sizes, COD) rather
  // than only the brand-voice copy — better click-through from search results.
  const sizes = (product.options.find((o) => /^size$/i.test(o.name))?.choices ?? [])
    .map((c) => c.label)
    .join(", ");
  const description = [
    `${product.name} — ₹${product.price}.`,
    sizes ? `Sizes ${sizes}.` : "",
    "Premium heavyweight cotton, unisex oversized fit.",
    "Free shipping on prepaid orders, COD available across India.",
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 158);

  return {
    title: product.name,
    description,
    keywords: [
      product.name,
      product.category,
      ...product.tags,
      "buy online India",
      "Level7 Clothing",
    ],
    alternates: { canonical: `/product/${product.slug}` },
    openGraph: {
      title: product.name,
      description,
      type: "website",
      images: product.images[0] ? [{ url: product.images[0] }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title: product.name,
      description,
      images: product.images[0] ? [product.images[0]] : undefined,
    },
  };
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product || !product.isActive) notFound();

  const related = await getRelated(
    product.category,
    product.id,
    4,
    product.secondaryCategory
  );

  const rawReviews = await prisma.review
    .findMany({
      where: { productId: product.id, approved: true },
      orderBy: [{ featured: "desc" }, { createdAt: "desc" }],
      take: 50,
    })
    .catch(() => []);

  const reviews: PublicReview[] = rawReviews.map((r) => ({
    id: r.id,
    name: r.name,
    rating: r.rating,
    title: r.title,
    body: r.body,
    createdAt: r.createdAt.toISOString(),
  }));
  const discount =
    product.compareAtPrice && product.compareAtPrice > product.price
      ? Math.round(
          ((product.compareAtPrice - product.price) / product.compareAtPrice) *
            100
        )
      : 0;

  // Flipkart-style: nothing is pre-selected — the customer browses all photos
  // and narrows down. Header shows a price range when variants differ.
  const variants = normalizeVariants(product);
  const range = priceRange(product);
  const hasRange = range.min !== range.max;

  // Product structured data so Google can show price / availability / rating.
  const ratingCount = reviews.length;
  const ratingValue =
    ratingCount > 0
      ? Math.round(
          (reviews.reduce((n, r) => n + r.rating, 0) / ratingCount) * 10
        ) / 10
      : null;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description,
    // Structured data needs absolute image URLs.
    image: product.images.map((src) =>
      src.startsWith("http") ? src : `${siteUrl()}${src}`
    ),
    category: product.category,
    brand: { "@type": "Brand", name: "Level7 Clothing" },
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "INR",
      lowPrice: range.min,
      highPrice: range.max,
      availability:
        product.stock > 0
          ? "https://schema.org/InStock"
          : "https://schema.org/OutOfStock",
    },
    ...(ratingValue !== null && {
      aggregateRating: {
        "@type": "AggregateRating",
        ratingValue,
        reviewCount: ratingCount,
      },
    }),
  };

  const base = siteUrl();
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: base },
      { "@type": "ListItem", position: 2, name: "Shop", item: `${base}/shop` },
      {
        "@type": "ListItem",
        position: 3,
        name: product.category,
        item: `${base}/shop?category=${encodeURIComponent(product.category)}`,
      },
      {
        "@type": "ListItem",
        position: 4,
        name: product.name,
        item: `${base}/product/${product.slug}`,
      },
    ],
  };

  return (
    <div className="container-px mx-auto max-w-7xl py-4 md:py-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      {/* Breadcrumb */}
      <nav className="mb-2 md:mb-6 flex items-center gap-1 text-sm text-muted-foreground">
        <Link href="/" className="hover:text-accent">
          Home
        </Link>
        <ChevronRight className="h-4 w-4" />
        <Link href="/shop" className="hover:text-accent">
          Shop
        </Link>
        <ChevronRight className="h-4 w-4" />
        <span className="text-foreground">{product.name}</span>
      </nav>

      <ProductViewProvider>
      <div className="grid items-start gap-10 md:grid-cols-2 lg:gap-16">
        {/* Gallery: pinned to the top and sticky so a long description never
            stretches or scrolls the square photo out of view. */}
        {/* min-w-0: the gallery's thumbnail rail is a horizontal scroller, and a
            grid item's default `min-width: auto` would otherwise stretch this
            column to the rail's full min-content width and overflow the page. */}
        <div className="md:sticky md:top-24 self-start min-w-0">
          <ProductGallery
            product={product}
            variants={variants}
            name={product.name}
          />
        </div>

        <div className="md:pt-4">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            {product.category}
          </p>
          <h1 className="mt-2 font-serif text-2xl leading-tight md:text-4xl">
            {product.name}
          </h1>

          <div className="mt-4 flex items-center gap-3">
            <span className="text-2xl font-medium">
              {hasRange
                ? `${formatINR(range.min)} – ${formatINR(range.max)}`
                : formatINR(range.min)}
            </span>
            {!hasRange && discount > 0 && (
              <>
                <span className="text-lg text-muted-foreground line-through">
                  {formatINR(product.compareAtPrice!)}
                </span>
                <span className="rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-accent-foreground">
                  Save {discount}%
                </span>
              </>
            )}
          </div>

          <p className="mt-3 text-sm">
            {product.stock > 0 ? (
              <span className="text-success">
                In stock{product.stock <= 5 ? ` · only ${product.stock} left` : ""}
              </span>
            ) : (
              <span className="text-danger">Currently sold out</span>
            )}
          </p>

          <div className="mt-6 h-px bg-border" />

          <p className="mt-6 leading-relaxed text-muted-foreground">
            {product.description}
          </p>

          <div className="mt-8">
            <ProductPurchase product={product} />
          </div>

          <div className="mt-8 grid gap-4 rounded-2xl border border-border p-5 sm:grid-cols-3">
            <Feature icon={<Shirt className="h-5 w-5" />} label="Premium quality fabric" />
            <Feature icon={<Truck className="h-5 w-5" />} label="Ships across India" />
            <Feature icon={<ShieldCheck className="h-5 w-5" />} label="Cash on delivery" />
          </div>
        </div>
      </div>
      </ProductViewProvider>

      <ProductReviews
        productId={product.id}
        productSlug={product.slug}
        reviews={reviews}
      />

      {related.length > 0 && (
        <section className="mt-24">
          <h2 className="font-serif text-3xl">You may also like</h2>
          <div className="mt-8 grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-4">
            {related.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Feature({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-3 sm:flex-col sm:text-center">
      <span className="gold-text">{icon}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}
