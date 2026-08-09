import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { ChevronRight, Star } from "lucide-react";
import { getProductBySlug, getRelated } from "@/lib/products";
import { getProductCrumb } from "@/lib/catalog";
import { formatINR } from "@/lib/utils";
import { ProductGallery } from "@/components/store/product-gallery";
import { ProductPurchase } from "@/components/store/product-purchase";
import { ProductPrice } from "@/components/store/product-price";
import { ProductCard } from "@/components/store/product-card";
import { ProductInfoSections } from "@/components/store/product-info-sections";
import { ReviewPanel } from "@/components/store/review-panel";
import { VideoPreviews } from "@/components/store/video-previews";
import { ProductViewProvider } from "@/context/product-view";
import { priceRange, firstAvailableSelection } from "@/lib/variants";
import { getSettings, resolveProductInfo } from "@/lib/settings";
import { siteUrl } from "@/lib/site-url";
import { resolveVideos } from "@/lib/videos";
import {
  getProductReviews,
  getReviewSummaries,
  getReviewSummary,
} from "@/lib/reviews";
import { getUserSession } from "@/lib/user-auth";

export const dynamic = "force-dynamic";

// ─── Metadata ────────────────────────────────────────────────────────────────
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) return { title: "Product" };

  const range = priceRange(product);
  const description = [
    `${product.name} — ${formatINR(range.min)}${range.min !== range.max ? `+` : ""}.`,
    product.description.replace(/\s+/g, " ").trim(),
  ]
    .join(" ")
    .slice(0, 158);

  // Prefer the relational gallery (source of truth) for share images; fall back
  // to the legacy product.images array.
  const mediaUrls = (product.media ?? []).map((m) => m.url).filter(Boolean);
  const images    = mediaUrls.length ? mediaUrls : product.images.filter(Boolean);
  const canonical = `/product/${product.slug}`;

  return {
    title: product.name,
    description,
    keywords: [product.name, product.category, ...(product.tags ?? [])].filter(
      Boolean
    ) as string[],
    alternates: { canonical },
    openGraph: {
      title: product.name,
      description,
      url: canonical,
      type: "website",
      ...(images.length ? { images: [{ url: images[0], alt: product.name }] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: product.name,
      description,
      ...(images.length ? { images: [images[0]] } : {}),
    },
    robots: { index: true, follow: true },
  };
}

// ─── Page ────────────────────────────────────────────────────────────────────
export default async function ProductPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug }    = await params;
  const product     = await getProductBySlug(slug);
  if (!product || !product.isActive) notFound();

  const [related, settings, crumb, reviews, summary, session] = await Promise.all([
    getRelated(
      product.category,
      product.id,
      6,
      product.secondaryCategory,
      product.subcategoryId
    ),
    getSettings(),
    getProductCrumb(product.subcategoryId),
    getProductReviews(product.id),
    // The headline figure counts every approved review, not just the page shown.
    getReviewSummary(product.id),
    getUserSession(),
  ]);

  const range     = priceRange(product);
  const initialSelection = firstAvailableSelection(product);
  const relatedRatings = await getReviewSummaries(related.map((p) => p.id));

  // Info-accordion copy: this product's own text where set, otherwise the
  // store-wide default from Settings > Product defaults.
  const info = resolveProductInfo(product, settings);

  // Physical specs, shown inside the Materials & Care panel when the admin has
  // filled the parcel fields.
  const dims = [product.lengthCm, product.breadthCm, product.heightCm];
  const specs = [
    ...(dims.every((d) => d != null)
      ? [{ label: "Dimensions", value: `${dims[0]} × ${dims[1]} × ${dims[2]} cm` }]
      : []),
    ...(product.weightGrams != null
      ? [{ label: "Weight", value: `${product.weightGrams} g` }]
      : []),
    { label: "Category", value: product.category },
  ];

  const base            = siteUrl();
  const productUrl      = `${base}/product/${product.slug}`;
  // JSON-LD images: prefer the relational gallery, fall back to product.images.
  const mediaUrls       = (product.media ?? []).map((m) => m.url).filter(Boolean);
  const absoluteImages  = (mediaUrls.length ? mediaUrls : product.images.filter(Boolean))
    .map((src) => (src.startsWith("http") ? src : `${base}${src}`));

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Product",
        "@id": `${productUrl}#product`,
        name: product.name,
        description: product.description.replace(/\s+/g, " ").trim(),
        ...(absoluteImages.length ? { image: absoluteImages } : {}),
        category: product.category,
        brand: { "@type": "Brand", name: settings.brandName },
        // Emitted only when real approved reviews exist. Structured-data rating
        // with no reviews behind it is exactly what Google penalises.
        ...(summary
          ? {
              aggregateRating: {
                "@type": "AggregateRating",
                ratingValue: summary.average,
                reviewCount: summary.count,
              },
            }
          : {}),
        offers: {
          "@type": "AggregateOffer",
          priceCurrency: "INR",
          lowPrice: range.min,
          highPrice: range.max,
          offerCount: 1,
          availability:
            product.stock > 0
              ? "https://schema.org/InStock"
              : "https://schema.org/OutOfStock",
          url: productUrl,
          seller: { "@id": `${base}/#organization` },
        },
      },
      {
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
          ...(crumb
            ? [
                {
                  "@type": "ListItem",
                  position: 4,
                  name: crumb.name,
                  item: `${base}${crumb.href}`,
                },
              ]
            : []),
          {
            "@type": "ListItem",
            position: crumb ? 5 : 4,
            name: product.name,
            item: productUrl,
          },
        ],
      },
    ],
  };

  return (
    <div className="container-px mx-auto max-w-7xl py-4 md:py-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* Breadcrumb */}
      <nav className="mb-4 flex items-center gap-1 text-xs text-muted-foreground md:mb-6 md:text-sm">
        <Link href="/" className="hover:text-accent">Home</Link>
        <ChevronRight className="h-3.5 w-3.5" />
        <Link href="/shop" className="hover:text-accent">Shop</Link>
        {crumb && (
          <>
            <ChevronRight className="h-3.5 w-3.5" />
            <Link href={crumb.href} className="hover:text-accent">{crumb.name}</Link>
          </>
        )}
        <ChevronRight className="h-3.5 w-3.5" />
        <span className="truncate text-foreground">{product.name}</span>
      </nav>

      <ProductViewProvider initial={initialSelection}>
        <div className="grid items-start gap-8 md:grid-cols-2 md:gap-12 lg:gap-16">
          {/* ── Gallery — sticky on desktop ── */}
          <div className="md:sticky md:top-24 md:self-start min-w-0">
            <ProductGallery
              product={product}
              media={product.media ?? []}
            />
          </div>

          {/* ── Product summary + variant selection + purchase ──
              Order is deliberate: the customer's first question is "which one do
              I want", so the option pickers sit directly under the price and the
              long-form copy (details, care, shipping, reviews) moves below the
              fold into <ProductInfoSections />. */}
          <div className="md:pt-2">
            {/* Category */}
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground sm:text-xs">
              {product.category}
            </p>

            {/* Product name */}
            <h1 className="mt-1.5 font-serif text-2xl leading-tight md:text-[2rem]">
              {product.name}
            </h1>

            {/* Rating + stock on one compact line. The rating block only exists
                once a real approved review does — no placeholder stars. */}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              {summary && (
                <>
                  <span className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Star
                        key={star}
                        className={`h-3.5 w-3.5 ${
                          star <= Math.round(summary.average)
                            ? "fill-accent text-accent"
                            : "fill-muted text-muted-foreground"
                        }`}
                      />
                    ))}
                    <span className="ml-0.5 font-medium">{summary.average}</span>
                  </span>
                  <span className="text-muted-foreground">
                    ({summary.count} review{summary.count === 1 ? "" : "s"})
                  </span>
                  <span className="text-border">|</span>
                </>
              )}
              {product.stock > 0 ? (
                <span className="text-success">
                  In stock{product.stock <= 5 ? ` · only ${product.stock} left` : ""}
                </span>
              ) : (
                <span className="text-danger">Currently sold out</span>
              )}
            </div>

            {/* Price — tracks the selected variant (client component) */}
            <ProductPrice product={product} />
            <p className="mt-1 text-xs text-muted-foreground">Inclusive of all taxes</p>

            <div className="mt-5 h-px bg-border" />

            {/* Purchase controls (variant pickers, qty, CTAs, trust) */}
            <div className="mt-5">
              <ProductPurchase product={product} />
            </div>
          </div>
        </div>
      </ProductViewProvider>

      {/* ── Below the fold: everything read after the decision is made ── */}
      <section className="mt-10 md:mt-16 md:max-w-3xl">
        <ProductInfoSections
          description={product.description}
          materialsCare={info.materialsCare}
          shippingInfo={info.shippingInfo}
          returnsInfo={info.returnsInfo}
          rating={summary?.average ?? null}
          reviewCount={summary?.count ?? 0}
          specs={specs}
          reviews={
            <ReviewPanel
              productId={product.id}
              summary={summary}
              items={reviews.items}
              distribution={reviews.distribution}
              signedInName={session?.name ?? null}
            />
          }
        />
      </section>

      {/* ── Video previews — the admin's YouTube / Instagram links ── */}
      <VideoPreviews videos={resolveVideos(product.videos)} />

      {/* ── You may also love — horizontal carousel ── */}
      {related.length > 0 && (
        <section className="mt-20 md:mt-28">
          <h2 className="font-serif text-2xl md:text-3xl">You may also love</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Handpicked pieces that go beautifully together
          </p>

          {/* Horizontal scroll carousel — snap on mobile, grid on desktop */}
          <div className="-mx-5 mt-6 sm:mx-0">
            <div className="no-scrollbar flex gap-4 overflow-x-auto px-5 pb-2 sm:px-0 md:grid md:grid-cols-4 md:gap-6 md:overflow-visible">
              {related.map((p) => (
                <div
                  key={p.id}
                  className="w-[calc(50vw-2rem)] shrink-0 sm:w-[calc(33vw-2rem)] md:w-auto"
                >
                  <ProductCard product={p} rating={relatedRatings.get(p.id)} />
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
