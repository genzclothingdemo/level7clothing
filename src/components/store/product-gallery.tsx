"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, ZoomIn, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useProductView } from "@/context/product-view";
import { unionImages, variantForImage } from "@/lib/variants";
import type { ProductDTO, Variant } from "@/lib/types";

export function ProductGallery({
  product,
  variants,
  name,
}: {
  product: ProductDTO;
  variants: Variant[];
  name: string;
}) {
  const { selection, setSelection } = useProductView();

  const list = unionImages(product, selection, product.images).filter(Boolean);
  const safe = list.length ? list : [""];

  const [activeUrl, setActiveUrl] = useState<string>(safe[0]);
  const [zoomed, setZoomed] = useState(false);

  // Horizontal thumbnail strip: one shared rail for mobile + desktop.
  const stripRef = useRef<HTMLDivElement | null>(null);
  const thumbRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  if (safe.length && !safe.includes(activeUrl)) {
    setActiveUrl(safe[0]);
  }
  const current = Math.max(0, safe.indexOf(activeUrl));
  const many = safe.length > 1;

  // Track which strip arrows apply (i.e. the rail is wider than its viewport).
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    // Ignore a trivially small overflow: 8 thumbs overrun a 563px rail by ~5px,
    // and an arrow that scrolls 5px is worse than no arrow at all.
    const EDGE = 10;
    const sync = () => {
      setCanLeft(el.scrollLeft > EDGE);
      setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - EDGE);
    };
    sync();
    el.addEventListener("scroll", sync, { passive: true });
    // Observe the children too, not just the rail: the rail's own box never
    // changes as layout settles, so container-only observation can miss a
    // narrow overflow (8 thumbs overflow a 563px rail by just 5px) and leave
    // the arrows wrongly hidden.
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    for (const child of el.children) ro.observe(child);
    const raf = requestAnimationFrame(sync);
    return () => {
      el.removeEventListener("scroll", sync);
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [safe.length]);

  /**
   * Centre a thumb inside the strip. Deliberately not scrollIntoView() — that
   * also scrolls the page vertically, which yanked the photo out of view.
   */
  function revealThumb(index: number) {
    const strip = stripRef.current;
    const thumb = thumbRefs.current[index];
    if (!strip || !thumb) return;
    strip.scrollTo({
      left: thumb.offsetLeft - strip.clientWidth / 2 + thumb.clientWidth / 2,
      behavior: "smooth",
    });
  }

  function nudgeStrip(dir: 1 | -1) {
    const strip = stripRef.current;
    if (!strip) return;
    strip.scrollBy({ left: dir * strip.clientWidth * 0.8, behavior: "smooth" });
  }

  function goTo(index: number) {
    const wrapped = (index + safe.length) % safe.length;
    setActiveUrl(safe[wrapped]);
    revealThumb(wrapped);
  }

  function pickPhoto(img: string, index: number) {
    setActiveUrl(img);
    const v = variantForImage(variants, img);
    if (v) setSelection({ ...v.combo });
    revealThumb(index);
  }

  return (
    <>
      <div className="relative">
        {/* ── MAIN PHOTO — true 1:1 at every width, never cropped ── */}
        <div className="group relative aspect-[4/5] w-full overflow-hidden rounded-lg bg-muted ring-1 ring-border/70">
          <AnimatePresence initial={false} mode="popLayout">
            <motion.div
              key={activeUrl || "empty"}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22, ease: "easeInOut" }}
              drag={many ? "x" : false}
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.15}
              onDragEnd={(_e, info) => {
                if (info.offset.x < -60) goTo(current + 1);
                else if (info.offset.x > 60) goTo(current - 1);
              }}
              className="absolute inset-0 touch-pan-y"
              style={{ cursor: many ? "grab" : "default" }}
            >
              {safe[current] ? (
                <Image
                  src={safe[current]}
                  alt={name}
                  fill
                  className="pointer-events-none select-none object-contain"
                  sizes="(max-width:768px) 100vw, 45vw"
                  priority
                  draggable={false}
                />
              ) : (
                <div className="grid h-full place-items-center text-sm text-muted-foreground">
                  No image
                </div>
              )}
            </motion.div>
          </AnimatePresence>

          {many && (
            <>
              <button
                type="button"
                onClick={() => goTo(current - 1)}
                aria-label="Previous photo"
                className="absolute left-2 top-1/2 z-10 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-background/80 text-foreground shadow-md backdrop-blur transition-all hover:scale-110 hover:bg-background md:opacity-0 md:group-hover:opacity-100"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => goTo(current + 1)}
                aria-label="Next photo"
                className="absolute right-2 top-1/2 z-10 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-background/80 text-foreground shadow-md backdrop-blur transition-all hover:scale-110 hover:bg-background md:opacity-0 md:group-hover:opacity-100"
              >
                <ChevronRight className="h-4 w-4" />
              </button>

              <div className="absolute bottom-2.5 left-1/2 z-10 -translate-x-1/2 rounded-full bg-background/75 px-3 py-0.5 backdrop-blur">
                <span className="text-[11px] font-medium tabular-nums text-foreground/70">
                  {current + 1} / {safe.length}
                </span>
              </div>
            </>
          )}

          {safe[current] && (
            <button
              type="button"
              onClick={() => setZoomed(true)}
              aria-label="Zoom image"
              className="absolute right-2 top-2 z-10 grid h-9 w-9 place-items-center rounded-full bg-background/80 text-foreground shadow-md backdrop-blur transition-all hover:scale-110 hover:bg-background md:opacity-0 md:group-hover:opacity-100"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* ════════════════════════════════════════════════════════════════
            THUMBNAIL STRIP — horizontal scroll, identical on mobile + desktop.

            Mini fixed-size thumbs (shrink-0) so 3 images or 30 lay out the
            same and the strip never reflows the page. Active state is a ring,
            not a transform: a scaled child inside a scroll container forces
            the cross-axis overflow to `auto`, which is what produced the
            stray scrollbar next to the old vertical rail.
        ════════════════════════════════════════════════════════════════ */}
        {many && (
          <div className="relative mt-3">
            {/* Desktop-only strip arrows, shown only when there's overflow */}
            {canLeft && (
              <button
                type="button"
                onClick={() => nudgeStrip(-1)}
                aria-label="Scroll thumbnails left"
                className="absolute -left-1 top-1/2 z-20 hidden h-7 w-7 -translate-y-1/2 place-items-center rounded-full bg-background/90 text-foreground shadow-md ring-1 ring-border backdrop-blur transition hover:bg-background md:grid"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
            )}
            {canRight && (
              <button
                type="button"
                onClick={() => nudgeStrip(1)}
                aria-label="Scroll thumbnails right"
                className="absolute -right-1 top-1/2 z-20 hidden h-7 w-7 -translate-y-1/2 place-items-center rounded-full bg-background/90 text-foreground shadow-md ring-1 ring-border backdrop-blur transition hover:bg-background md:grid"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            )}

            {/* Edge fades hint that more photos exist off-screen */}
            {canLeft && (
              <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-8 bg-gradient-to-r from-background to-transparent" />
            )}
            {canRight && (
              <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-background to-transparent" />
            )}

            <div
              ref={stripRef}
              // No scroll-snap here on purpose: mandatory snapping fights a
              // small overflow (it springs the last few px back to the nearest
              // thumb), which made the arrow visible but unable to scroll.
              className="no-scrollbar flex gap-2 overflow-x-auto scroll-smooth py-1"
            >
              {safe.map((img, i) => {
                const isActive = current === i;
                return (
                  <button
                    key={`t-${i}`}
                    ref={(el) => {
                      thumbRefs.current[i] = el;
                    }}
                    type="button"
                    onClick={() => pickPhoto(img, i)}
                    aria-label={`View photo ${i + 1}`}
                    aria-pressed={isActive}
                    className={cn(
                      "relative aspect-[4/5] h-16 w-[52px] shrink-0 overflow-hidden rounded-md md:h-20 md:w-16",
                      "cursor-pointer transition-all duration-200",
                      isActive
                        ? "ring-2 ring-accent ring-offset-1 ring-offset-background"
                        : "opacity-60 ring-1 ring-border/50 hover:opacity-100 hover:ring-border"
                    )}
                  >
                    {img && (
                      <Image
                        src={img}
                        alt={`${name} view ${i + 1}`}
                        fill
                        sizes="64px"
                        className="object-cover"
                        loading={i <= 5 ? "eager" : "lazy"}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════════════
          FULLSCREEN ZOOM LIGHTBOX
      ════════════════════════════════════════════════════════════════ */}
      {zoomed && safe[current] && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-sm"
          onClick={() => setZoomed(false)}
        >
          <button
            type="button"
            onClick={() => setZoomed(false)}
            aria-label="Close zoom"
            className="absolute right-4 top-4 z-10 grid h-10 w-10 place-items-center rounded-full bg-white/20 text-white hover:bg-white/30"
          >
            <X className="h-5 w-5" />
          </button>

          {many && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  goTo(current - 1);
                }}
                aria-label="Previous photo"
                className="absolute left-3 top-1/2 z-10 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white/20 text-white hover:bg-white/30"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  goTo(current + 1);
                }}
                aria-label="Next photo"
                className="absolute right-3 top-1/2 z-10 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white/20 text-white hover:bg-white/30"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </>
          )}

          <div
            className="relative h-[85vmin] w-[85vmin] max-h-[90dvh] max-w-[90dvw]"
            onClick={(e) => e.stopPropagation()}
          >
            <Image
              src={safe[current]}
              alt={name}
              fill
              sizes="90vw"
              className="object-contain"
              priority
            />
          </div>

          <span className="absolute bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap text-sm text-white/60">
            {current + 1}&nbsp;/&nbsp;{safe.length}&nbsp;·&nbsp;Tap outside to close
          </span>
        </div>
      )}
    </>
  );
}
