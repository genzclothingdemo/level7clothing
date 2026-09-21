"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Clamps long copy to N lines behind a "View more" toggle.
 *
 * Two rules it exists to enforce:
 *
 * 1. **The text is never unmounted.** It is clipped visually with
 *    `line-clamp`, so crawlers and Ctrl-F still see the full copy — important
 *    on product and policy pages, which is exactly where the long copy lives.
 * 2. **The toggle only appears when it is earned.** Content that fits inside
 *    the clamp renders with no control at all, so a two-line description never
 *    grows a pointless "View more".
 *
 * Measurement happens after mount, so the server renders the clamped copy with
 * no toggle — no layout shift beyond the control fading in.
 */

/**
 * Written out in full because Tailwind scans source text: a class name built at
 * runtime (`line-clamp-${n}`) would never be generated.
 */
const CLAMP = {
  2: "line-clamp-2",
  3: "line-clamp-3",
  4: "line-clamp-4",
  5: "line-clamp-5",
  6: "line-clamp-6",
  8: "line-clamp-8",
  10: "line-clamp-10",
  12: "line-clamp-12",
} as const;

export type ClampLines = keyof typeof CLAMP;

/** Rounding slack — `clientHeight` is integral, so an exact compare reports
 *  phantom overflow at some line-heights. */
const SLACK = 4;

/** Must match the `duration-300` on the content element. */
const COLLAPSE_MS = 300;

export function ExpandableText({
  children,
  lines = 6,
  moreLabel = "View more",
  lessLabel = "View less",
  className,
  contentClassName,
}: {
  children: React.ReactNode;
  /** Lines shown while collapsed. */
  lines?: ClampLines;
  moreLabel?: string;
  lessLabel?: string;
  /** On the wrapper (content + toggle). */
  className?: string;
  /** On the clamped element itself — e.g. `whitespace-pre-line`. */
  contentClassName?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  /**
   * Set while the panel is travelling back down. The clamp has to be held off
   * for that moment: re-applying it immediately would cut the copy to N lines
   * on the spot and leave the height animation with nothing to animate.
   */
  const [collapsing, setCollapsing] = useState(false);
  /** Height of exactly `lines` lines. Only knowable while the clamp is on. */
  const [clampedH, setClampedH] = useState<number | null>(null);
  /** Height the copy wants. Re-measured as the layout reflows. */
  const [fullH, setFullH] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();

  const clampOn = !expanded && !collapsing;
  // Read by `measure`, which runs from listeners that must not be torn down and
  // rebuilt every time the panel opens.
  const clampOnRef = useRef(true);
  useEffect(() => {
    clampOnRef.current = clampOn;
  }, [clampOn]);

  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (collapseTimer.current) clearTimeout(collapseTimer.current);
    },
    []
  );

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;

    // Lift our own cap before reading. max-height pins the box, so leaving it
    // on would mask the very reflow being measured — the copy re-wrapping at a
    // breakpoint, say, where the clamp gets taller but clientHeight cannot.
    // Restored in the same synchronous block, so nothing paints in between.
    const capped = el.style.maxHeight;
    el.style.maxHeight = "";
    // scrollHeight is the content height whether or not the copy is clipped.
    const full = el.scrollHeight;
    // clientHeight is the N-line height only while the clamp is applied.
    const clamped = clampOnRef.current ? el.clientHeight : null;
    el.style.maxHeight = capped;

    setFullH((prev) => (prev === full ? prev : full));
    if (clamped !== null) {
      setClampedH((prev) => (prev === clamped ? prev : clamped));
    }
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // max-height pins the element's own box, so the observer can sleep through
    // a reflow while expanded. A plain resize listener always fires.
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  const overflows =
    clampedH !== null && fullH !== null && fullH - clampedH > SLACK;

  // Both states resolve to a pixel value, which is what lets the height
  // interpolate in either direction. Two pixels of slack when open so a
  // sub-pixel line never gets shaved off.
  const maxHeight = overflows
    ? expanded
      ? (fullH as number) + 2
      : (clampedH as number)
    : undefined;

  function toggle() {
    // Copy can change between observer callbacks; the moment of expanding is
    // the one time a stale height would actually be visible.
    measure();
    if (collapseTimer.current) clearTimeout(collapseTimer.current);
    if (expanded) {
      setCollapsing(true);
      // A timer rather than `transitionend`: under prefers-reduced-motion the
      // transition is off and that event would never arrive, which would strand
      // the copy permanently open.
      collapseTimer.current = setTimeout(() => setCollapsing(false), COLLAPSE_MS);
    } else {
      setCollapsing(false);
    }
    setExpanded((v) => !v);
  }

  /**
   * Clamped copy can still contain links and info tips, and those stay in the
   * tab order even when clipped — `inert` is not an option here because the
   * visible lines must stay interactive. So a keyboard user who tabs into the
   * clipped part opens the panel instead of focusing something invisible.
   */
  function onFocusCapture(e: React.FocusEvent<HTMLDivElement>) {
    if (expanded || !overflows) return;
    const el = ref.current;
    const target = e.target as HTMLElement;
    if (!el || target === el) return;
    // Below the clamp line only — tabbing to a visible link shouldn't spring
    // the panel open.
    if (target.getBoundingClientRect().bottom <= el.getBoundingClientRect().bottom) {
      return;
    }
    setExpanded(true);
  }

  return (
    <div className={className}>
      <div
        id={id}
        ref={ref}
        onFocusCapture={onFocusCapture}
        style={maxHeight === undefined ? undefined : { maxHeight }}
        className={cn(
          "overflow-hidden transition-[max-height] duration-300 ease-out motion-reduce:transition-none",
          clampOn && CLAMP[lines],
          contentClassName
        )}
      >
        {children}
      </div>

      {overflows && (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={expanded}
          aria-controls={id}
          className={cn(
            "mt-2 inline-flex cursor-pointer items-center gap-1 rounded-sm text-[11px] font-medium uppercase tracking-widest text-accent",
            "transition-colors hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          )}
        >
          {expanded ? lessLabel : moreLabel}
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "h-3.5 w-3.5 transition-transform duration-200 motion-reduce:transition-none",
              expanded && "rotate-180"
            )}
          />
        </button>
      )}
    </div>
  );
}
