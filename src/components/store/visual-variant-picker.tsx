"use client";

import Image from "next/image";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OptionChoice } from "@/components/store/option-picker";

/**
 * The image-card *skin* — the one reserved for a genuinely visual attribute,
 * i.e. the option whose value swaps the gallery AND whose values actually look
 * different from one another (Design, Colour, Finish… whatever the admin marked
 * as image-driving). `modeFor()` in option-picker.tsx decides when that is true;
 * this file only knows how to draw a card.
 *
 * Nothing here is product-specific, and nothing here owns layout beyond the card
 * itself: the cards are emitted as bare flex children so the shared rail in
 * option-picker.tsx provides the scrolling, the edge fades and the
 * keep-the-selection-in-view behaviour. That is also why there is no wrapper
 * element — adding one would put a non-`shrink-0` box between the rail and its
 * cards and quietly squash them.
 */
export function VariantCards({
  choices,
  selected,
  onSelect,
}: {
  choices: OptionChoice[];
  selected: string | undefined;
  onSelect: (value: string) => void;
}) {
  return (
    <>
      {choices.map(({ value, enabled, hint, preview }) => {
        const isActive = selected === value;

        return (
          <button
            key={value}
            type="button"
            data-option-value={value}
            disabled={!enabled}
            onClick={() => onSelect(value)}
            aria-pressed={isActive}
            title={enabled ? value : `${value} — sold out`}
            className={cn(
              // Colour-change only on state, per the design system: no lift, no
              // scale, and no hover zoom on the thumbnail.
              "group relative w-[84px] shrink-0 snap-start overflow-hidden rounded-lg border bg-card text-left transition-colors",
              isActive
                ? "border-primary ring-1 ring-primary"
                : "border-border hover:border-foreground/40",
              !enabled && "cursor-not-allowed opacity-50"
            )}
          >
            {/* Portrait 4/5, the fashion standard this store uses everywhere. */}
            <div className="relative aspect-[4/5] w-full overflow-hidden bg-muted">
              {preview ? (
                <Image
                  src={preview}
                  alt={value}
                  fill
                  className="object-cover"
                  sizes="96px"
                />
              ) : (
                <span className="absolute inset-0 grid place-items-center px-1 text-center text-[10px] font-medium leading-tight text-muted-foreground">
                  {value}
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
                "block truncate px-1.5 pt-1.5 text-center text-[11px] font-medium leading-tight",
                hint ? "pb-0" : "pb-1.5",
                isActive ? "text-primary" : "text-muted-foreground"
              )}
            >
              {value}
            </span>
            {hint && (
              <span className="block truncate px-1.5 pb-1.5 text-center text-[10px] leading-tight text-muted-foreground">
                {hint}
              </span>
            )}
          </button>
        );
      })}
    </>
  );
}
