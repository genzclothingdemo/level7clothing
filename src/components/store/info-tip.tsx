"use client";

import { Fragment, useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A small "(i)" button that explains a term a shopper may not know — billable
 * weight, COD, partial payment, the return window.
 *
 * Three decisions worth keeping:
 *
 * 1. **Tap, not hover.** The trigger is a real `<button>` driven by `onClick`,
 *    so it works identically on touch, mouse and keyboard. A hover-only tooltip
 *    is dead weight on a phone, and most of this store's traffic is phones.
 * 2. **Conditionally rendered, opacity-only entrance** — see the "Modal pattern"
 *    note in CLAUDE.md. Nothing is parked offscreen with a transform: the bubble
 *    simply does not exist while closed, and its resting position comes from
 *    computed `top`/`left`, never from an animation that has to finish.
 * 3. **Portalled to `<body>`.** Tips sit inside accordions and reveal wrappers
 *    that clip with `overflow-hidden`; an absolutely positioned bubble would be
 *    sliced in half by them. Fixed positioning against the viewport also makes
 *    the 320px clamp exact.
 */

/** Viewport gutter always kept clear, so the bubble never touches an edge. */
const GUTTER = 8;
/** Widest the bubble ever gets. It shrinks to fit narrower screens. */
const MAX_WIDTH = 288;
/** Below this much room underneath the trigger, the bubble opens upward. */
const FLIP_THRESHOLD = 170;

type Placement = {
  left: number;
  width: number;
  /** Exactly one of these is set — `bottom` when the bubble opens upward. */
  top?: number;
  bottom?: number;
};

export function InfoTip({
  term,
  children,
  className,
}: {
  /** The term being explained. Titles the bubble and names the button. */
  term: string;
  /** The explanation — a sentence or two, plain text. */
  children: React.ReactNode;
  className?: string;
}) {
  // `null` is the closed state, so there is exactly one source of truth: a
  // bubble can never be open without a measured position.
  const [place, setPlace] = useState<Placement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const id = useId();
  const open = place !== null;

  /**
   * Position from the trigger's live rect, clamped inside the viewport. Called
   * on open and again on scroll/resize so the bubble stays pinned to its "(i)".
   */
  const reposition = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();

    const width = Math.min(MAX_WIDTH, window.innerWidth - GUTTER * 2);
    // Left-aligned to the trigger, then pulled back inside both gutters. At
    // 320px the bubble is 304px wide, so this always resolves to the gutter.
    const left = Math.min(
      Math.max(GUTTER, r.left),
      Math.max(GUTTER, window.innerWidth - width - GUTTER)
    );

    const roomBelow = window.innerHeight - r.bottom;
    // Anchoring the flipped bubble by `bottom` means we never need to know how
    // tall it is — no measure-then-reposition flash.
    const flip = roomBelow < FLIP_THRESHOLD && r.top > roomBelow;

    setPlace(
      flip
        ? { left, width, bottom: window.innerHeight - r.top + GUTTER }
        : { left, width, top: r.bottom + GUTTER }
    );
  }, []);

  const close = useCallback(() => setPlace(null), []);

  useEffect(() => {
    if (!open) return;

    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      close();
      triggerRef.current?.focus();
    }
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (bubbleRef.current?.contains(target)) return;
      close();
    }
    function onReflow() {
      reposition();
    }

    document.addEventListener("keydown", onKey);
    // Capture phase: catches the press before any handler can stop it, and also
    // closes this tip when a different tip's trigger is pressed.
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("resize", onReflow);
    // Capture again so scrolling inside a nested scroller counts, not just the page.
    window.addEventListener("scroll", onReflow, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
  }, [open, close, reposition]);

  return (
    <span className={cn("relative inline-flex align-middle", className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close() : reposition())}
        aria-expanded={open}
        aria-label={`What ${term} means`}
        aria-describedby={open ? id : undefined}
        className={cn(
          // 24px hit area for thumbs, pulled back with a negative margin so the
          // visible 16px circle still sits tight against the word it follows.
          "group -my-1 mx-0.5 inline-grid h-6 w-6 shrink-0 cursor-pointer place-items-center rounded-full",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        )}
      >
        <span
          className={cn(
            "grid h-4 w-4 place-items-center rounded-full border transition-colors",
            open
              ? "border-accent text-accent"
              : "border-border text-muted-foreground group-hover:border-accent group-hover:text-accent"
          )}
        >
          <Info className="h-2.5 w-2.5" aria-hidden="true" />
        </span>
      </button>

      {/* Mounted only while open — never hidden in place. */}
      {open && typeof document !== "undefined" &&
        createPortal(
          <span
            ref={bubbleRef}
            id={id}
            role="tooltip"
            style={{
              left: place.left,
              width: place.width,
              top: place.top,
              bottom: place.bottom,
            }}
            className={cn(
              "fixed z-[80] block rounded-lg border border-border bg-card p-3 text-left shadow-xl",
              // Opacity only. The bubble's resting position is its computed
              // top/left, so an interrupted animation can never strand it.
              "animate-[fadeIn_0.15s_ease-out_both] motion-reduce:animate-none"
            )}
          >
            <span className="block text-[10px] font-medium uppercase tracking-widest text-foreground">
              {term}
            </span>
            <span className="mt-1.5 block text-xs leading-relaxed text-muted-foreground">
              {children}
            </span>
          </span>,
          document.body
        )}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Glossary                                                           */
/* ------------------------------------------------------------------ */

/**
 * Store jargon that shoppers regularly ask about. Kept here rather than in the
 * pages so the wording stays identical wherever a term appears — the admin can
 * write "Cash on Delivery" in any product's copy and the same explanation
 * follows it.
 *
 * Patterns are deliberately non-global: `exec` is called repeatedly below and a
 * `/g/` regex would carry `lastIndex` between calls.
 */
const GLOSSARY: { key: string; term: string; pattern: RegExp; body: string }[] = [
  {
    key: "cod",
    term: "Cash on Delivery",
    pattern: /cash on delivery|\bCOD\b/i,
    body:
      "Pay the courier when the parcel reaches you, in cash or by UPI at the door. Available on eligible pin codes only, and the order still has to be confirmed before we dispatch it.",
  },
  {
    key: "partial",
    term: "Partial payment",
    pattern: /partial payment|part payment/i,
    body:
      "Pay a small amount online now to confirm the order, and the balance to the courier on delivery. It keeps the COD convenience while confirming you actually want the parcel.",
  },
  {
    key: "prepaid",
    term: "Prepaid",
    pattern: /\bprepaid\b/i,
    body:
      "Paid in full online before dispatch — UPI, card or net banking. Prepaid orders skip any cash-handling fee and are packed first.",
  },
  {
    key: "return-window",
    term: "Return window",
    pattern: /return window/i,
    body:
      "The number of days after delivery in which you can raise a return. It starts the day the courier marks your order delivered, not the day you ordered.",
  },
  {
    key: "billable-weight",
    term: "Billable weight",
    pattern: /billable weight|volumetric weight|chargeable weight/i,
    body:
      "Couriers charge the greater of the parcel's real weight and its volumetric weight (length × breadth × height ÷ 5000), so a light but bulky parcel is billed as a heavier one.",
  },
  {
    key: "business-days",
    term: "Business days",
    pattern: /business days/i,
    body:
      "Working days only. Sundays and public holidays are not counted, so an order placed on a Friday evening starts its clock on Monday.",
  },
];

/**
 * Renders a plain string, attaching an `InfoTip` after the first mention of each
 * glossary term. First mention only — a term explained three times in one
 * paragraph is noise, not help. Text with no known terms passes through
 * untouched, so this is safe to wrap around any admin-authored copy.
 */
export function GlossaryText({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  const used = new Set<string>();
  let rest = text;

  for (;;) {
    // Earliest match wins, so tips land in reading order.
    let hit: { entry: (typeof GLOSSARY)[number]; index: number; length: number } | null =
      null;
    for (const entry of GLOSSARY) {
      if (used.has(entry.key)) continue;
      const m = entry.pattern.exec(rest);
      if (m && (hit === null || m.index < hit.index)) {
        hit = { entry, index: m.index, length: m[0].length };
      }
    }
    if (hit === null) break;

    const end = hit.index + hit.length;
    parts.push(
      <Fragment key={`t-${used.size}`}>{rest.slice(0, end)}</Fragment>
    );
    parts.push(
      <InfoTip key={hit.entry.key} term={hit.entry.term}>
        {hit.entry.body}
      </InfoTip>
    );
    rest = rest.slice(end);
    used.add(hit.entry.key);
  }

  if (rest) parts.push(<Fragment key="tail">{rest}</Fragment>);
  return <>{parts}</>;
}
