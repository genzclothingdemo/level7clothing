"use client";

import { useState, useEffect, useMemo } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Play } from "lucide-react";
import { useProductView } from "@/context/product-view";
import { cn } from "@/lib/utils";
import type { ProductDTO, MediaDTO } from "@/lib/types";
import { galleryForSelection } from "@/lib/variants";
import { comboKey } from "@/lib/options";

export function ProductGallery({
  product,
  media,
}: {
  product: ProductDTO;
  media: MediaDTO[];
}) {
  const { selection } = useProductView();

  // Resolve the gallery for the current selection from the relational media
  // rows (source of truth), de-duplicated (the same photo can legitimately be
  // picked into more than one source).
  const selKey = comboKey(selection);
  const activeImages = useMemo(
    () => Array.from(new Set(galleryForSelection(product, selection))),
    [product, selection]
  );

  const [activeIndex, setActiveIndex] = useState(0);
  const [direction, setDirection] = useState(0);

  // Snap back to the first photo only when the selected variant actually changes.
  // (Keying the reset on the array reference re-fired on every render as soon as
  // the source returned a fresh array — breaking next/prev navigation.)
  useEffect(() => {
    setActiveIndex(0);
  }, [selKey]);

  if (!activeImages.length) {
    return (
      <div className="aspect-[4/5] w-full rounded-2xl bg-muted flex items-center justify-center">
        <span className="text-muted-foreground text-sm font-medium tracking-wide">
          NO IMAGES
        </span>
      </div>
    );
  }

  const currentUrl = activeImages[Math.min(activeIndex, activeImages.length - 1)];
  const isVideo = currentUrl?.match(/\.(mp4|webm|mov)$/i);

  function paginate(newDirection: number) {
    setDirection(newDirection);
    setActiveIndex((prev) => {
      let next = prev + newDirection;
      if (next < 0) next = activeImages.length - 1;
      if (next >= activeImages.length) next = 0;
      return next;
    });
  }

  return (
    <div className="sticky top-24 flex flex-col gap-3">
      <div className="relative aspect-[4/5] w-full overflow-hidden rounded-2xl bg-muted">
        {/* Directional crossfade: the incoming photo slides in from the side
            being paginated towards while the old one fades under it. */}
        <AnimatePresence initial={false} custom={direction} mode="popLayout">
          <motion.div
            key={currentUrl}
            custom={direction}
            drag={activeImages.length > 1 ? "x" : false}
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.12}
            onDragEnd={(_, info) => {
              // Swipe past ~60px (or a fast flick) advances the gallery — the
              // gesture mobile shoppers reach for before the arrows.
              if (info.offset.x < -60 || info.velocity.x < -450) paginate(1);
              else if (info.offset.x > 60 || info.velocity.x > 450) paginate(-1);
            }}
            variants={{
              enter: (dir: number) => ({
                opacity: 0,
                x: dir * 48,
                scale: 1.02,
              }),
              center: { opacity: 1, x: 0, scale: 1 },
              exit: (dir: number) => ({
                opacity: 0,
                x: dir * -32,
                scale: 0.99,
              }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              "absolute inset-0",
              activeImages.length > 1 && "cursor-grab active:cursor-grabbing"
            )}
          >
            {isVideo ? (
              <video
                src={currentUrl}
                autoPlay
                loop
                muted
                playsInline
                className="h-full w-full object-cover"
              />
            ) : (
              <Image
                src={currentUrl || ""}
                alt={product.name}
                fill
                className="object-cover"
                priority
                sizes="(max-width: 768px) 100vw, 50vw"
              />
            )}
          </motion.div>
        </AnimatePresence>
        
        {activeImages.length > 1 && (
          <>
            <button
              onClick={() => paginate(-1)}
              className="absolute left-4 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/80 p-2 text-black shadow-md backdrop-blur transition-all duration-300 hover:scale-110 hover:bg-white active:scale-95"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              onClick={() => paginate(1)}
              className="absolute right-4 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/80 p-2 text-black shadow-md backdrop-blur transition-all duration-300 hover:scale-110 hover:bg-white active:scale-95"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
            {/* Dots for a handful of photos; a counter once a strip of dots
                stops being readable. */}
            {activeImages.length <= 8 ? (
              <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 gap-1.5">
                {activeImages.map((_, i) => (
                  <div
                    key={i}
                    className={cn(
                      "h-1.5 rounded-full transition-all duration-300",
                      i === activeIndex ? "w-4 bg-white" : "w-1.5 bg-white/50"
                    )}
                  />
                ))}
              </div>
            ) : (
              <div className="absolute bottom-3 right-3 z-10 rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur">
                {activeIndex + 1} / {activeImages.length}
              </div>
            )}
          </>
        )}
      </div>

      {/* Thumbnail strip — a scrolling row rather than a 6-up grid, so a variant
          with 12 photos doesn't turn into two cramped rows of 40px squares. */}
      {activeImages.length > 1 && (
        <div className="-mx-5 sm:mx-0">
          <div className="no-scrollbar flex gap-2 overflow-x-auto px-5 pb-1 sm:px-0">
          {activeImages.map((url, i) => {
            const thumbIsVideo = url.match(/\.(mp4|webm|mov)$/i);
            return (
              <button
                key={url + i}
                onClick={() => {
                  setDirection(i > activeIndex ? 1 : -1);
                  setActiveIndex(i);
                }}
                aria-label={`View image ${i + 1}`}
                className={cn(
                  "relative h-[68px] w-[68px] shrink-0 overflow-hidden rounded-lg bg-muted transition-all duration-300 hover:-translate-y-0.5 md:h-[76px] md:w-[76px]",
                  i === activeIndex
                    ? "ring-2 ring-primary ring-offset-1"
                    : "opacity-70 hover:opacity-100 hover:shadow-md"
                )}
              >
                {thumbIsVideo ? (
                  <div className="flex h-full w-full items-center justify-center bg-black/10">
                    <Play className="h-4 w-4 text-foreground/50" />
                  </div>
                ) : (
                  <Image
                    src={url}
                    alt=""
                    fill
                    className="object-cover"
                    sizes="100px"
                  />
                )}
              </button>
            );
          })}
          </div>
        </div>
      )}
    </div>
  );
}
