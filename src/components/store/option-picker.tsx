"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { visualAttributeName } from "@/lib/variants";
import { VariantCards } from "@/components/store/visual-variant-picker";
import type { ProductDTO } from "@/lib/types";

/**
 * ONE option selector for every attribute on the product page, in two skins.
 *
 * It used to be two separate selectors living in product-purchase.tsx: the
 * "visual" attribute got image cards and everything else got a `flex-wrap` pill
 * grid. Both were wrong past about four values, in different ways — and which
 * one a customer got was decided by an accident of the data (see `modeFor`).
 *
 * The header, the rail, the sold-out treatment and the price hint are now
 * written once and shared, which is also what makes the size guide safe to hang
 * off the heading: CLAUDE.md warns that anything attached to the size selector
 * has to live outside the cards/pills branch or it vanishes for half the
 * catalogue. There is no longer a branch to fall down — `aside` renders in the
 * one shared header regardless of skin.
 */

export type OptionChoice = {
  value: string;
  enabled: boolean;
  /** Price difference if the customer swapped to this value, e.g. "+₹80". */
  hint: string | null;
  /** Card thumbnail. Only read in "cards" mode. */
  preview: string | null;
};

export type PickerMode = "cards" | "pills";

/**
 * Cards or pills — decided by the data, not by which attribute happens to be
 * first.
 *
 * `visualAttributeName()` falls back to `attributes[0]` whenever
 * `propertyModules.images` was never declared, and on this catalogue the first
 * attribute is "Size" on every single product. The result was that 21 of 22
 * products rendered S/M/L/XL/2XL as five 84×130px image cards — and because no
 * size has photography of its own, `previewImageForValue` fell through to the
 * same cover still for all five. Five identical photographs, 164px of vertical
 * space, and the only distinguishing mark was an 11px caption. That is the
 * "it corrupts" the owner reported: not a wrapping bug so much as a picture
 * carrying no information, repeated until it pushed the buy button off-screen.
 *
 * So an image card has to be *earned*: the values must resolve to more than one
 * distinct preview. A genuine Colour/Design attribute does; a size run does not.
 * Deliberately not a `/size/i` test — a store that photographs each size on a
 * fit model should get cards for it, and a two-value "Colour" whose admin
 * pointed both values at one photo should not.
 */
export function modeFor(
  product: ProductDTO,
  attributeName: string,
  choices: OptionChoice[]
): PickerMode {
  if (visualAttributeName(product) !== attributeName) return "pills";
  const distinct = new Set(choices.map((c) => c.preview).filter(Boolean));
  return distinct.size > 1 ? "cards" : "pills";
}

export function OptionPicker({
  product,
  attributeName,
  choices,
  selected,
  onSelect,
  index,
  aside,
}: {
  product: ProductDTO;
  attributeName: string;
  choices: OptionChoice[];
  selected: string | undefined;
  onSelect: (value: string) => void;
  /** 1-based step number, shown only when the product has more than one group. */
  index?: number;
  /** Header-right slot — the size guide link for whichever group is the sizes. */
  aside?: React.ReactNode;
}) {
  const mode = modeFor(product, attributeName, choices);

  return (
    <section aria-label={`Choose ${attributeName}`}>
      <div className="mb-2.5 flex items-center justify-between gap-3">
        {/* Answer-forward: the attribute name is the quiet part and the chosen
            value is the loud one, so "which size am I buying" is legible in the
            heading instead of being inferred by hunting for the outlined card. */}
        <p className="min-w-0 truncate text-sm">
          <span className="text-muted-foreground">
            {index ? `${index}. ` : ""}
            {attributeName}:
          </span>{" "}
          {selected ? (
            <span className="font-semibold">{selected}</span>
          ) : (
            <span className="font-medium text-danger">Select one</span>
          )}
        </p>
        <div className="flex shrink-0 items-center gap-3">
          {choices.length > 4 && (
            <span className="text-xs text-muted-foreground">
              {choices.length} options
            </span>
          )}
          {aside}
        </div>
      </div>

      <OptionRail activeValue={selected} snap={mode === "cards"}>
        {mode === "cards" ? (
          <VariantCards
            choices={choices}
            selected={selected}
            onSelect={onSelect}
          />
        ) : (
          choices.map((c) => (
            <OptionPill
              key={c.value}
              choice={c}
              active={selected === c.value}
              onSelect={onSelect}
            />
          ))
        )}
      </OptionRail>
    </section>
  );
}

/* ── The rail ──────────────────────────────────────────────────────────────
   A horizontal scroller that keeps the selected value in view and — the part
   that is easy to get wrong — cannot widen the page.

   `overflow-x-auto` clips and scrolls, but it does NOT stop the strip's
   min-content width (values × card width + gaps + padding) escaping upwards
   into whichever ancestor is intrinsically sized: a grid item, a flex item, a
   table cell. That is how this rail once widened the whole document to 500px at
   a 375px viewport. A flex item with an explicit `min-width: 0` has a zero
   automatic minimum size, so the rail contributes nothing upwards and can only
   ever scroll inside itself. The `-mx-5 flex` wrapper + `min-w-0 flex-1`
   scroller is that fix; don't collapse it back to a bare div. The same pattern
   is in product-gallery.tsx's thumbnail strip and the "You may also love" row.
   ------------------------------------------------------------------------ */
function OptionRail({
  activeValue,
  snap,
  children,
}: {
  activeValue: string | undefined;
  snap: boolean;
  children: React.ReactNode;
}) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  // Edge fades, so "there is more to the right" is visible without scrolling
  // first. Both are false when the rail doesn't overflow, which is the common
  // case — nothing is drawn for four sizes on a wide screen.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    let alive = true;
    let raf = 0;
    const update = () => {
      if (!alive) return;
      const max = el.scrollWidth - el.clientWidth;
      setEdges({ left: el.scrollLeft > 1, right: el.scrollLeft < max - 1 });
    };
    // A frame later, never a microtask. The first measurement has to happen
    // after layout, and scheduling it with an already-resolved promise instead
    // runs it inside the same commit, which React rejects outright: "Can't
    // perform a React state update on a component that hasn't mounted yet" —
    // thrown before the listeners below are ever attached, so the fades then
    // never update again.
    const later = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };

    later();
    el.addEventListener("scroll", update, { passive: true });

    // Observe the CHILDREN, not just the rail.
    //
    // This is the whole trick. The rail is full-width at every viewport, so its
    // own border box never changes and a ResizeObserver on it alone fires once
    // and never again. What decides whether the fades should show is
    // `scrollWidth` — which belongs to the pills. Measuring on mount, or a
    // frame later, read a scrollWidth that was not yet final, so both fades sat
    // hidden over a rail that plainly overflowed and only an actual scroll ever
    // corrected them. Watching each option means the measurement re-runs the
    // moment the pills reach their real size, whatever made them late — a
    // webfont swapping in, an image decoding, a hint appearing. That is also
    // why there is no `document.fonts.ready` here: it covered one cause of the
    // same symptom, and `.then()` on an already-resolved `ready` fires inside
    // the commit, which React rejects as a state update on a component that
    // has not mounted — and that threw before this listener was ever attached.
    const ro = new ResizeObserver(update);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);

  // Keep the selected value on screen.
  //
  // Two deliberate choices here, both learned the hard way:
  //
  // 1. Scroll the rail's own box, never `Element.scrollIntoView()`. That walks
  //    up and scrolls every scrollable ancestor, so picking an off-screen size
  //    would also jump the *page* out from under the customer.
  // 2. The scroll is INSTANT. A rail that animates itself sideways is exactly
  //    the unasked-for motion CLAUDE.md says was stripped out of this store on
  //    purpose, and a plain `scrollLeft` assignment also cannot be silently
  //    dropped the way a smooth scroll can — a smooth programmatic scroll does
  //    nothing at all in any context that isn't producing animation frames.
  useEffect(() => {
    const el = scroller.current;
    if (!el || activeValue == null) return;
    const btn = el.querySelector<HTMLElement>(
      `[data-option-value="${CSS.escape(activeValue)}"]`
    );
    if (!btn) return;

    const pad = 12;
    const rail = el.getBoundingClientRect();
    const box = btn.getBoundingClientRect();
    let delta = 0;
    if (box.left < rail.left + pad) delta = box.left - rail.left - pad;
    else if (box.right > rail.right - pad) delta = box.right - rail.right + pad;
    if (delta !== 0) el.scrollLeft += delta;
  }, [activeValue]);

  return (
    <div className="relative -mx-5 flex sm:mx-0">
      <div
        ref={scroller}
        className={cn(
          "no-scrollbar flex min-w-0 flex-1 items-stretch gap-2.5 overflow-x-auto px-5 pb-1 sm:px-0",
          // Proximity, not mandatory: a mandatory snap re-snaps after the
          // programmatic scroll above and can drag the selected value back
          // out of view.
          snap && "snap-x snap-proximity"
        )}
      >
        {children}
      </div>

      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-background to-transparent transition-opacity duration-200 sm:hidden",
          edges.left ? "opacity-100" : "opacity-0"
        )}
      />
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-background to-transparent transition-opacity duration-200 sm:hidden",
          edges.right ? "opacity-100" : "opacity-0"
        )}
      />
    </div>
  );
}

/* ── Pills — the skin for plain text values ─────────────────────────────── */
function OptionPill({
  choice,
  active,
  onSelect,
}: {
  choice: OptionChoice;
  active: boolean;
  onSelect: (value: string) => void;
}) {
  const { value, enabled, hint } = choice;
  return (
    <button
      type="button"
      data-option-value={value}
      disabled={!enabled}
      onClick={() => onSelect(value)}
      aria-pressed={active}
      title={enabled ? value : `${value} — sold out`}
      className={cn(
        // Squared, uppercase, wide-tracked and colour-change only — the design
        // system in CLAUDE.md. No scale or lift on press.
        "relative flex min-w-12 shrink-0 flex-col items-center justify-center rounded-lg border px-3.5 py-2 text-sm font-medium uppercase tracking-wide transition-colors",
        active
          ? "border-primary bg-primary/5 text-primary"
          : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
        !enabled && "text-muted-foreground/60"
      )}
    >
      <span className="relative z-10 leading-tight">{value}</span>
      {hint && (
        <span className="relative z-10 text-[11px] font-normal normal-case tracking-normal text-muted-foreground">
          {hint}
        </span>
      )}
      {!enabled && (
        <>
          <StrikeThrough />
          <span className="sr-only"> — sold out</span>
        </>
      )}
    </button>
  );
}

/**
 * The sold-out mark. A diagonal rule across the pill reads at a glance and
 * survives being the only cue on a 48px chip — dimming alone is ambiguous next
 * to the muted colour an *unselected* pill already carries.
 */
export function StrikeThrough() {
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
      <line
        x1="0"
        y1="100%"
        x2="100%"
        y2="0"
        stroke="currentColor"
        strokeWidth="1"
        strokeOpacity="0.45"
      />
    </svg>
  );
}
