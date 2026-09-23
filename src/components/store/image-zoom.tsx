"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import { ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@/lib/utils";

const VIDEO = /\.(mp4|webm|mov)$/i;

/** How far in a tap/click zooms. 2.5× is about the limit before a 1080px-wide
 *  source starts showing its own pixels on a retina phone. */
const ZOOMED = 2.5;

/* ── Desktop hover magnifier ───────────────────────────────────────────────
   A layer over the main gallery image that shows the same photo scaled up and
   anchored to the cursor. It exists only where a cursor does: on a coarse
   pointer it renders nothing at all, which is what keeps the gallery's
   swipe-to-paginate drag working untouched on phones.

   The layer deliberately owns its own mousemove state. Hanging the handler on
   the gallery instead would re-render the whole gallery — AnimatePresence,
   arrows, dots and all — on every pointer move.
   ------------------------------------------------------------------------ */
export function HoverZoom({
  src,
  alt,
  onOpen,
}: {
  src: string;
  alt: string;
  onOpen: () => void;
}) {
  const [fine, setFine] = useState(false);
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    setFine(window.matchMedia("(hover: hover) and (pointer: fine)").matches);
  }, []);

  if (!fine || VIDEO.test(src)) return null;

  return (
    <div
      className="absolute inset-0 z-[5] cursor-zoom-in"
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        setAt({
          x: ((e.clientX - r.left) / r.width) * 100,
          y: ((e.clientY - r.top) / r.height) * 100,
        });
      }}
      onMouseLeave={() => setAt(null)}
      onClick={onOpen}
      aria-hidden
    >
      {at && (
        <div className="absolute inset-0 overflow-hidden">
          <Image
            src={src}
            alt={alt}
            fill
            // A bigger source than the box needs, so magnifying it has real
            // detail to show rather than an upscaled thumbnail.
            sizes="100vw"
            className="object-cover"
            style={{
              transform: `scale(${ZOOMED})`,
              transformOrigin: `${at.x}% ${at.y}%`,
            }}
          />
        </div>
      )}
    </div>
  );
}

/* ── Lightbox ──────────────────────────────────────────────────────────────
   Conditionally rendered by the caller (`{open && <ImageLightbox …/>}`) and
   animated on opacity alone — the Modal pattern in CLAUDE.md. The size guide
   was once "hidden" with translateY(100%), which from a centred resting
   position only moves a sheet down by its own height and leaves it on screen;
   nothing here depends on a transform completing.

   Portalled to <body> because (store)/template.tsx wraps every page in a
   framer-motion transform, and a transformed ancestor becomes the containing
   block for `position: fixed`.
   ------------------------------------------------------------------------ */
export function ImageLightbox({
  images,
  index,
  alt,
  onIndex,
  onClose,
}: {
  images: string[];
  index: number;
  alt: string;
  onIndex: (next: number) => void;
  onClose: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [zoom, setZoom] = useState(1);
  const pane = useRef<HTMLDivElement | null>(null);

  useEffect(() => setMounted(true), []);

  const src = images[Math.min(index, images.length - 1)] ?? "";
  const isVideo = VIDEO.test(src);
  const many = images.length > 1;

  const step = useCallback(
    (dir: number) => {
      if (!many) return;
      onIndex((index + dir + images.length) % images.length);
    },
    [index, images.length, many, onIndex]
  );

  // A new photo always arrives un-zoomed; carrying a 2.5× pan across a
  // pagination leaves the customer looking at a random crop of a new image.
  useEffect(() => setZoom(1), [index]);

  // Escape closes, arrows paginate, and the page behind must not scroll.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
    }
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose, step]);

  /**
   * Toggle between fit and 2.5×, keeping whatever was under the finger under
   * the finger. The scroll offsets can only be set once the bigger box has been
   * laid out, hence the rAF.
   */
  function toggleZoom(e: React.MouseEvent) {
    const el = pane.current;
    if (!el || isVideo) return;
    if (zoom > 1) {
      setZoom(1);
      return;
    }
    const r = el.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width;
    const fy = (e.clientY - r.top) / r.height;
    setZoom(ZOOMED);
    requestAnimationFrame(() => {
      el.scrollLeft = fx * (el.scrollWidth - el.clientWidth);
      el.scrollTop = fy * (el.scrollHeight - el.clientHeight);
    });
  }

  if (!mounted) return null;

  const chrome =
    "grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white backdrop-blur transition-colors hover:bg-white/20";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${alt} — enlarged`}
      className="fixed inset-0 z-[80] flex flex-col bg-black/95 animate-[fadeIn_0.18s_ease-out_both]"
    >
      {/* Safe areas: this is `fixed`, so it ignores the `pt-safe px-safe` on
          <body> and has to clear the Dynamic Island and home indicator itself. */}
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 pt-safe">
        <div className="flex h-14 items-center gap-2">
          {many && (
            <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-white backdrop-blur">
              {index + 1} / {images.length}
            </span>
          )}
          {!isVideo && (
            <span className="hidden text-xs text-white/60 sm:inline">
              {zoom > 1 ? "Drag to pan · tap to fit" : "Tap the photo to zoom"}
            </span>
          )}
        </div>
        <div className="flex h-14 items-center gap-2">
          {!isVideo && (
            <button
              type="button"
              onClick={() => setZoom((z) => (z > 1 ? 1 : ZOOMED))}
              className={chrome}
              aria-label={zoom > 1 ? "Zoom out" : "Zoom in"}
            >
              {zoom > 1 ? (
                <ZoomOut className="h-5 w-5" />
              ) : (
                <ZoomIn className="h-5 w-5" />
              )}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className={chrome}
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1">
        {/* `m-auto` on the child rather than `justify-center` on the scroller:
            a centred flex item that overflows its scroll container has its
            leading edge clipped and unreachable. Margin auto centres without
            that. `pinch-zoom` is left in touch-action so the browser's own
            pinch still works on top of the tap-to-zoom. */}
        <div
          ref={pane}
          className={cn(
            "flex flex-1 overflow-auto overscroll-contain",
            !isVideo && (zoom > 1 ? "cursor-zoom-out" : "cursor-zoom-in")
          )}
          style={{ touchAction: "pan-x pan-y pinch-zoom" }}
          onClick={toggleZoom}
        >
          <div
            className="relative m-auto shrink-0"
            style={
              zoom === 1
                ? { width: "100%", height: "100%" }
                : { width: `${zoom * 100}%`, height: `${zoom * 100}%` }
            }
          >
            {isVideo ? (
              <video
                src={src}
                autoPlay
                loop
                muted
                playsInline
                controls
                className="absolute inset-0 h-full w-full object-contain"
              />
            ) : (
              <Image
                src={src}
                alt={alt}
                fill
                sizes="100vw"
                className="object-contain"
                priority
              />
            )}
          </div>
        </div>

        {many && (
          <>
            <button
              type="button"
              onClick={() => step(-1)}
              aria-label="Previous image"
              className={cn(chrome, "absolute left-3 top-1/2 -translate-y-1/2")}
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => step(1)}
              aria-label="Next image"
              className={cn(chrome, "absolute right-3 top-1/2 -translate-y-1/2")}
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </>
        )}
      </div>

      <div className="h-4 shrink-0 pb-safe" />
    </div>,
    document.body
  );
}
