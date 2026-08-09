"use client";

import { useState, useRef, useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import { Star, ChevronLeft, ChevronRight } from "lucide-react";
import { formatINR, cn } from "@/lib/utils";
import { variantPreviewImages } from "@/lib/variants";
import type { ProductDTO } from "@/lib/types";
import { WhatsAppProductButton } from "./product-actions";

// ─── Badge logic ──────────────────────────────────────────────────────────────
type BadgeKind =
  | "Best Seller"
  | "Festival Special"
  | "Limited Edition"
  | "New"
  | "Made to Order"
  | null;

function resolveBadge(product: ProductDTO): BadgeKind {
  const tags = (product.tags ?? []).map((t) => t.toLowerCase());
  if (product.isFeatured) return "Best Seller";
  if (tags.some((t) => t.includes("festival") || t.includes("festive")))
    return "Festival Special";
  if (tags.some((t) => t.includes("limited"))) return "Limited Edition";
  if (tags.some((t) => t.includes("new"))) return "New";
  return null; // no badge when nothing applies
}

const BADGE_STYLES: Record<
  Exclude<BadgeKind, null>,
  { bg: string; text: string }
> = {
  "Best Seller": { bg: "bg-accent", text: "text-accent-foreground" },
  "Festival Special": { bg: "bg-[#7C3AED]", text: "text-white" },
  "Limited Edition": { bg: "bg-foreground/85 backdrop-blur", text: "text-background" },
  New: { bg: "bg-emerald-500", text: "text-white" },
  "Made to Order": { bg: "bg-card/90 backdrop-blur", text: "text-foreground/70" },
};

// ─── Component ────────────────────────────────────────────────────────────────
export function ProductCard({
  product,
  rating,
}: {
  product: ProductDTO;
  /**
   * Real approved-review summary, or undefined when the product has none — the
   * rating row is then omitted entirely rather than showing invented stars.
   * Fetched in one grouped query per page (see getReviewSummaries).
   */
  rating?: { average: number; count: number };
}) {
  const discount =
    product.compareAtPrice && product.compareAtPrice > product.price
      ? Math.round(
          ((product.compareAtPrice - product.price) / product.compareAtPrice) *
            100
        )
      : 0;

  const badge = resolveBadge(product);

  // One photo per design, not the whole gallery. `product.images` is the union
  // of every variant gallery plus the common photos, which made a 2-design
  // product swipe through 20 shots (and buried the designs among packaging).
  const images = useMemo(() => variantPreviewImages(product), [product]);
  const many = images.length > 1;

  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIdx, setActiveIdx] = useState(0);

  function handleScroll() {
    if (!scrollRef.current) return;
    const scrollLeft = scrollRef.current.scrollLeft;
    const width = scrollRef.current.clientWidth;
    // Don't update if width is 0 to avoid NaN
    if (width > 0) {
      setActiveIdx(Math.round(scrollLeft / width));
    }
  }

  function scrollToIndex(idx: number, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!scrollRef.current) return;
    const width = scrollRef.current.clientWidth;
    scrollRef.current.scrollTo({ left: width * idx, behavior: "smooth" });
  }

  return (
    <div className="group flex flex-col">
      {/* ── Image area (Swappable gallery) ── */}
      <div className="card-lift relative block aspect-[4/5] overflow-hidden rounded-2xl bg-muted ring-1 ring-border/60 transition-shadow group-hover:ring-primary/25">
        <Link href={`/product/${product.slug}`} className="absolute inset-0 z-10" aria-label={product.name} />
        
        {images.length > 0 ? (
          <div 
            ref={scrollRef}
            onScroll={handleScroll}
            className="no-scrollbar relative z-20 flex h-full w-full snap-x snap-mandatory overflow-x-auto scroll-smooth"
          >
            {images.map((url, i) => {
              const alt = product.media?.find((m) => m.url === url)?.alt || product.name;
              return (
              <Link href={`/product/${product.slug}`} key={url} className="relative h-full w-full flex-shrink-0 snap-center snap-always block">
                <Image
                  src={decodeURI(url)}
                  alt={alt}
                  fill
                  className="object-cover transition-transform duration-500 group-hover:scale-105"
                  sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                />
              </Link>
            )})}
          </div>
        ) : (
          <div className="absolute inset-0 grid place-items-center text-muted-foreground text-sm">
            No image
          </div>
        )}

        {/* Hover arrows (desktop) */}
        {many && (
          <>
            <button
              type="button"
              onClick={(e) => scrollToIndex(Math.max(0, activeIdx - 1), e)}
              className={cn(
                "absolute left-2 top-1/2 z-30 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-background/80 text-foreground shadow-md backdrop-blur transition-all hover:scale-110 hover:bg-background opacity-0 md:group-hover:opacity-100",
                activeIdx === 0 && "hidden"
              )}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={(e) => scrollToIndex(Math.min(images.length - 1, activeIdx + 1), e)}
              className={cn(
                "absolute right-2 top-1/2 z-30 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full bg-background/80 text-foreground shadow-md backdrop-blur transition-all hover:scale-110 hover:bg-background opacity-0 md:group-hover:opacity-100",
                activeIdx === images.length - 1 && "hidden"
              )}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </>
        )}

        {/* Dot indicators (mobile & desktop) */}
        {many && (
          <div className="absolute bottom-2.5 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/20 px-2 py-1 backdrop-blur-sm">
            {images.map((_, i) => (
              <div
                key={i}
                className={cn(
                  "h-1.5 rounded-full transition-all duration-300",
                  i === activeIdx ? "w-3 bg-white" : "w-1.5 bg-white/60"
                )}
              />
            ))}
          </div>
        )}

        {/* Discount badge — top left (berry chip, matches primary CTA) */}
        {discount > 0 && (
          <span className="animate-pop absolute left-2 top-2 z-30 rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground shadow-md shadow-primary/30 sm:left-3 sm:top-3 sm:px-2.5 sm:py-1 sm:text-xs">
            −{discount}%
          </span>
        )}

        {/* Context badge — top left (after discount) */}
        {badge && !discount && (
          <span
            className={`animate-pop absolute left-2 top-2 z-30 rounded-full px-2 py-0.5 text-[10px] font-semibold shadow-md sm:left-3 sm:top-3 sm:px-2.5 sm:py-1 sm:text-xs ${BADGE_STYLES[badge].bg} ${BADGE_STYLES[badge].text}`}
          >
            {badge}
          </span>
        )}

        {/* Sold out */}
        {product.stock <= 0 && (
          <span className="absolute right-2 top-2 z-30 rounded-full bg-foreground/85 px-2 py-0.5 text-[10px] font-medium text-background backdrop-blur sm:right-3 sm:top-3 sm:px-2.5 sm:py-1 sm:text-xs">
            Sold out
          </span>
        )}
      </div>

      {/* ── Info area ── */}
      <div className="mt-2 flex flex-1 flex-col sm:mt-3">
        {/* Category — subtle */}
        <p className="truncate text-[9px] uppercase tracking-widest gold-text sm:text-[10px]">
          {product.category}
        </p>

        {/* Product name — prominent */}
        <Link
          href={`/product/${product.slug}`}
          className="mt-0.5 line-clamp-2 font-serif text-sm leading-snug transition-colors hover:text-accent sm:text-base"
        >
          {product.name}
        </Link>

        {/* Rating row — only when there are approved reviews */}
        {rating && (
          <div className="mt-0.5 flex items-center gap-1 sm:mt-1">
            <Star className="h-3 w-3 fill-accent text-accent" />
            <span className="text-[11px] font-medium tabular-nums text-foreground/80">
              {rating.average}
            </span>
            <span className="text-[10px] text-muted-foreground">({rating.count})</span>
          </div>
        )}

        {/* Price row */}
        <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm font-semibold sm:text-base">
            {formatINR(product.price)}
          </span>
          {discount > 0 && (
            <span className="text-xs text-muted-foreground line-through">
              {formatINR(product.compareAtPrice!)}
            </span>
          )}
        </div>

        {/* CTA row — always "View Product" + WhatsApp icon */}
        <div className="mt-2 flex items-center gap-2 sm:mt-3">
          <Link
            href={`/product/${product.slug}`}
            className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full border border-border text-xs font-medium transition-all duration-200 hover:border-primary hover:bg-primary hover:text-primary-foreground hover:shadow-lg hover:shadow-primary/25 active:scale-[0.97] sm:h-10 sm:text-sm"
          >
            View Product
          </Link>
          <WhatsAppProductButton product={product} variant="icon" />
        </div>
      </div>
    </div>
  );
}
