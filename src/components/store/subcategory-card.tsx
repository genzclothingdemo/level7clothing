"use client";

import { useState, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { Star, Layers, ChevronLeft, ChevronRight } from "lucide-react";
import { formatINR, cn } from "@/lib/utils";
import type { SubcategoryTile } from "@/lib/catalog";

/**
 * A group tile shown in place of the individual products it contains.
 * Matches ProductCard's layout exactly: same CTA ("View Product"), same
 * rating stub position, same swappable image area — so the two can sit in the same
 * grid without visual inconsistency.
 */
export function SubcategoryCard({ tile }: { tile: SubcategoryTile }) {
  const category = tile.categoryName;
  const href = `/shop?category=${encodeURIComponent(category)}&sub=${tile.slug}`;
  const range =
    tile.priceMin === tile.priceMax
      ? formatINR(tile.priceMin)
      : `${formatINR(tile.priceMin)} – ${formatINR(tile.priceMax)}`;

  const images = (tile.images ?? []).filter(Boolean);
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
      <div className="card-lift relative block aspect-[4/5] overflow-hidden rounded-2xl bg-muted">
        <Link href={href} className="absolute inset-0 z-10" aria-label={tile.name} />
        
        {images.length > 0 ? (
          <div 
            ref={scrollRef}
            onScroll={handleScroll}
            className="no-scrollbar relative z-20 flex h-full w-full snap-x snap-mandatory overflow-x-auto scroll-smooth"
          >
            {images.map((img, i) => {
              const alt = tile.media?.find((m) => m.url === img)?.alt || `${tile.name} - image ${i + 1}`;
              return (
              <Link href={href} key={i} className="relative h-full w-full shrink-0 snap-center block">
                <Image
                  src={img}
                  alt={alt}
                  fill
                  sizes="(max-width: 768px) 50vw, 25vw"
                  className="object-cover"
                />
              </Link>
            )})}
          </div>
        ) : (
          <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
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

        {/* Design count chip — top left */}
        <span className="absolute left-2 top-2 z-30 inline-flex items-center gap-1 rounded-full bg-card/90 px-2 py-0.5 text-[10px] font-medium shadow-sm backdrop-blur sm:left-3 sm:top-3 sm:px-2.5 sm:py-1 sm:text-[11px]">
          <Layers className="h-3 w-3" />
          {tile.productCount} designs
        </span>
      </div>

      {/* ── Info area ── */}
      <div className="mt-2 flex flex-1 flex-col sm:mt-3">
        {/* Category */}
        <p className="truncate text-[10px] uppercase tracking-widest gold-text sm:text-xs">
          {category}
        </p>

        {/* Name */}
        <Link
          href={href}
          className="mt-0.5 line-clamp-2 font-serif text-sm leading-snug transition-colors hover:text-accent sm:text-base"
        >
          {tile.name}
        </Link>

        {/* Rating stub row (parity with ProductCard) */}
        <div className="mt-0.5 flex items-center gap-1 sm:mt-1">
          <Star className="h-3 w-3 fill-accent text-accent" />
          <span className="text-[11px] font-medium text-foreground/80">
            {tile.productCount} designs
          </span>
        </div>

        {/* Price range */}
        <div className="mt-1">
          <span className="text-sm font-semibold sm:text-base">{range}</span>
        </div>

        {/* CTA row — same "View Product" as ProductCard */}
        <div className="mt-2 sm:mt-3">
          <Link
            href={href}
            className="flex h-9 w-full items-center justify-center gap-1.5 rounded-full border border-border text-xs font-medium transition-all duration-150 hover:border-foreground/40 hover:bg-muted active:scale-[0.97] sm:h-10 sm:text-sm"
          >
            View Product
          </Link>
        </div>
      </div>
    </div>
  );
}
