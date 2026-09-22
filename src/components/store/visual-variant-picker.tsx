"use client";

import Image from "next/image";
import { useMemo } from "react";
import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { previewImageForValue } from "@/lib/variants";
import type { ProductDTO } from "@/lib/types";

/**
 * The image-card selector for a product's *visual* attribute — the option whose
 * value swaps the gallery (Design, Colour, Finish, Stone… whatever the admin
 * marked as image-driving). Nothing here is product-specific: the heading reads
 * "Choose {attribute}" and each card's thumbnail comes from that value's
 * preview image.
 *
 * Layout is a one-row horizontal snap strip, so 4 values and 24 values look the
 * same and neither pushes the buy button off the screen.
 */
export function VisualVariantPicker({
  product,
  attributeName,
  values,
  selected,
  onSelect,
  isEnabled,
  index,
}: {
  product: ProductDTO;
  attributeName: string;
  values: string[];
  selected: string | undefined;
  onSelect: (value: string) => void;
  isEnabled: (value: string) => boolean;
  /** 1-based step number shown before the heading. */
  index?: number;
}) {
  // Preview thumbnails are pure derivations of the media rows — memo so a
  // gallery swap doesn't re-scan the media array for every card.
  const previews = useMemo(
    () =>
      Object.fromEntries(
        values.map((v) => [v, previewImageForValue(product, v)])
      ) as Record<string, string | null>,
    [product, values]
  );

  return (
    <section aria-label={`Choose ${attributeName}`}>
      <div className="mb-2.5 flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold">
          {index ? `${index}. ` : ""}Choose {attributeName}
          {selected && (
            <span className="ml-1.5 font-normal text-muted-foreground">
              — {selected}
            </span>
          )}
        </p>
        {values.length > 4 && (
          <span className="shrink-0 text-xs text-muted-foreground">
            {values.length} options
          </span>
        )}
      </div>

      {/* Full-bleed on mobile so the strip can scroll edge-to-edge.

          The wrapper is a flex row and the scroller is `min-w-0 flex-1`, which
          is what actually keeps this rail inside the page. `overflow-x-auto`
          clips and scrolls, but it does NOT stop the strip's min-content width
          (values × 84px + gaps + padding) escaping into whichever ancestor is
          intrinsically sized — a grid item, a flex item, a table cell. That is
          how this rail widened the whole document to 500px at a 375px viewport.
          A flex item with an explicit `min-width: 0` has a zero automatic
          minimum size, so the rail contributes nothing upwards and can only
          ever scroll inside itself. Don't collapse this back to a bare div. */}
      <div className="-mx-5 flex sm:mx-0">
        <div className="no-scrollbar flex min-w-0 flex-1 snap-x snap-mandatory gap-2.5 overflow-x-auto px-5 pb-1 sm:px-0">
          {values.map((val) => {
            const isActive = selected === val;
            const enabled = isEnabled(val);
            const src = previews[val];

            return (
              <motion.button
                key={val}
                type="button"
                disabled={!enabled}
                whileTap={enabled ? { scale: 0.97 } : undefined}
                onClick={() => onSelect(val)}
                aria-pressed={isActive}
                title={enabled ? val : `${val} — unavailable`}
                className={cn(
                  "group relative w-[84px] shrink-0 snap-start overflow-hidden rounded-xl border bg-card text-left transition-all",
                  isActive
                    ? "border-primary ring-1 ring-primary"
                    : "border-border hover:border-foreground/30",
                  !enabled && "cursor-not-allowed opacity-45"
                )}
              >
                <div className="relative aspect-[4/5] w-full overflow-hidden bg-muted">
                  {src ? (
                    <Image
                      src={src}
                      alt={val}
                      fill
                      className={cn(
                        "object-cover transition-transform duration-300",
                        enabled && "group-hover:scale-105"
                      )}
                      sizes="96px"
                    />
                  ) : (
                    <span className="absolute inset-0 grid place-items-center px-1 text-center text-[10px] font-medium leading-tight text-muted-foreground">
                      {val}
                    </span>
                  )}

                  {isActive && (
                    <span className="absolute right-1 top-1 grid h-4.5 w-4.5 place-items-center rounded-full bg-primary p-0.5 text-primary-foreground shadow">
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </span>
                  )}

                  {!enabled && (
                    <span className="absolute inset-0 grid place-items-center bg-background/55">
                      <span className="rounded bg-background/90 px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Sold out
                      </span>
                    </span>
                  )}
                </div>

                <span
                  className={cn(
                    "block truncate px-1.5 py-1.5 text-center text-[11px] font-medium leading-tight",
                    isActive ? "text-primary" : "text-muted-foreground"
                  )}
                >
                  {val}
                </span>
              </motion.button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
