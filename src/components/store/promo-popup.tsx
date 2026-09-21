"use client";

/**
 * The promotion popup — the loud surface, kept on a very short leash.
 *
 * A popup that fires on page load is the fastest way to lose a customer, so
 * every rule below exists to make this one appear at most once, late, and
 * never while someone is busy:
 *
 * - **Never before first paint.** `open` starts `false` and can only be set
 *   from a timer or a scroll handler, so the popup is not in the server HTML
 *   and cannot be the first thing a shopper sees.
 * - **Intent first.** It waits for either six seconds of *visible* dwell (time
 *   in a background tab does not count) or a scroll a quarter of the way down
 *   the page — whichever comes first. Someone who bounced in three seconds
 *   never sees it.
 * - **Once.** The "seen" record is written the moment it opens, not when it is
 *   closed, so walking away from it is as final as dismissing it. The record
 *   persists for the promotion's `dismissDays`.
 * - **Not over a task.** It stands down entirely on checkout, cart, account
 *   and order pages, and it will not stack on top of a drawer or dialog the
 *   shopper opened themselves.
 *
 * The overlay follows CLAUDE.md's Modal pattern exactly: conditionally
 * rendered (never hidden in place with a transform), opacity-only entrance,
 * resting position from layout alone.
 */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import type { LivePromotion } from "@/lib/promotions";
import {
  PromoLink,
  isPromoPathBlocked,
  suppressPromo,
  usePromoSuppressed,
} from "@/components/store/promo-banner";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Timing                                                             */
/* ------------------------------------------------------------------ */

/**
 * Six seconds of attention, or a quarter of the page — whichever lands first.
 *
 * Six is long enough that a bounce never triggers it and short enough that it
 * still reaches someone reading the homepage. The scroll route exists because
 * a shopper who has already started moving down the page has shown more intent
 * than one who has merely been present.
 */
const DWELL_MS = 6_000;
const SCROLL_FRACTION = 0.25;
/** How often dwell is sampled. Coarse on purpose — this is not a stopwatch. */
const TICK_MS = 500;

/** True if the shopper already has something of their own open. */
function hasOpenOverlay(): boolean {
  return !!document.querySelector("[role='dialog'], [aria-modal='true'], dialog[open]");
}

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/* ------------------------------------------------------------------ */
/*  The panel                                                          */
/* ------------------------------------------------------------------ */

/**
 * The popup's markup with no behaviour attached, so the admin preview shows
 * the real thing rather than a drawing of it. The portal, backdrop, focus trap
 * and scroll lock all belong to `PromoPopup` below — a preview must not lock
 * the admin's page.
 */
export function PromoPopupPanel({
  title,
  body,
  ctaLabel,
  ctaHref,
  onClose,
  onNavigate,
  titleId,
  bodyId,
  inert = false,
  className,
  panelRef,
}: {
  title: string;
  body: string;
  ctaLabel?: string | null;
  ctaHref?: string | null;
  onClose?: () => void;
  onNavigate?: () => void;
  titleId?: string;
  bodyId?: string;
  inert?: boolean;
  className?: string;
  panelRef?: React.Ref<HTMLDivElement>;
}) {
  const cta = ctaLabel && ctaHref ? { label: ctaLabel, href: ctaHref } : null;

  return (
    <div
      ref={panelRef}
      // The preview is a picture of the popup, not a dialog: giving it these
      // would announce a modal that has not opened, and would make the live
      // popup's own "is something already open?" check see a phantom.
      role={inert ? undefined : "dialog"}
      aria-modal={inert ? undefined : true}
      aria-labelledby={inert ? undefined : titleId}
      aria-describedby={inert ? undefined : bodyId}
      tabIndex={inert ? undefined : -1}
      className={cn(
        "relative w-full max-w-md rounded-xl border border-border bg-background p-5 shadow-2xl sm:p-7",
        // dvh, never vh: on a phone the panel has to shrink when the browser
        // chrome collapses or a keyboard opens, and `vh` does neither.
        !inert && "max-h-[min(85dvh,44rem)] overflow-y-auto overscroll-contain",
        "focus-visible:outline-none",
        className
      )}
    >
      {/*
        The corner control is a full 44px square, not a decorative cross. It is
        the convenience; the labelled button at the bottom is the obvious one.
      */}
      <button
        type="button"
        onClick={onClose}
        disabled={inert}
        tabIndex={inert ? -1 : undefined}
        aria-hidden={inert || undefined}
        aria-label="Close"
        className={cn(
          "absolute right-1.5 top-1.5 grid h-11 w-11 place-items-center rounded-lg text-muted-foreground transition-colors",
          !inert && "cursor-pointer hover:bg-muted hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        )}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>

      {/* `pr-11` keeps long copy clear of the corner control at 320px. */}
      <div className="pr-11">
        <p className="eyebrow text-accent">Offer</p>
        <h2
          id={titleId}
          className="mt-2 break-words font-serif text-xl leading-tight sm:text-2xl"
        >
          {title}
        </h2>
      </div>

      {body && (
        <p
          id={bodyId}
          className="mt-2 break-words text-sm leading-relaxed text-muted-foreground"
        >
          {body}
        </p>
      )}

      {/*
        Stacked, full-width, both 44px. `flex-col` rather than a side-by-side
        pair because at 320px two uppercase wide-tracked buttons on one row
        either wrap mid-word or push the panel wider than the viewport.
      */}
      <div className="mt-6 flex flex-col gap-2">
        {cta && (
          <PromoLink
            href={cta.href}
            onNavigate={onNavigate}
            inert={inert}
            className={cn(
              "inline-flex min-h-11 items-center justify-center rounded-lg bg-foreground px-6 text-center text-[11px] font-medium uppercase tracking-widest text-background transition-opacity",
              !inert && "cursor-pointer hover:opacity-90"
            )}
          >
            {cta.label}
          </PromoLink>
        )}

        <button
          type="button"
          onClick={onClose}
          disabled={inert}
          tabIndex={inert ? -1 : undefined}
          className={cn(
            "inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-6 text-[11px] font-medium uppercase tracking-widest transition-colors",
            !inert && "cursor-pointer hover:bg-muted",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          )}
        >
          {cta ? "No thanks" : "Close"}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  The live popup                                                     */
/* ------------------------------------------------------------------ */

export function PromoPopup({ promotion }: { promotion: LivePromotion | null }) {
  const pathname = usePathname();
  const suppressed = usePromoSuppressed(promotion, "popup");
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const ids = useId();
  const titleId = `${ids}-title`;
  const bodyId = `${ids}-body`;

  const close = useCallback(() => {
    setOpen(false);
    // Re-stamped on close so the window runs from the moment they said no,
    // not from the moment it appeared.
    if (promotion) suppressPromo(promotion, ["popup"]);
  }, [promotion]);

  /* ---- The intent gate ---- */
  useEffect(() => {
    if (open) return;
    if (!promotion) return;
    if (promotion.kind === "banner") return;
    if (suppressed) return;
    if (isPromoPathBlocked(pathname, "popup")) return;

    let dwell = 0;
    let since = Date.now();
    let armed = true;

    // `timer` is declared at the bottom, after the handlers it schedules.
    // Hoisted declarations make the order legible rather than circular, and
    // nothing here runs before the listeners are actually registered.
    function disarm() {
      armed = false;
      clearInterval(timer);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVisibility);
    }

    function fire() {
      if (!armed) return;
      if (document.visibilityState !== "visible") return;
      // Never stack on the cart drawer, the chat panel or the size guide.
      // The gate stays armed, so it simply tries again on the next tick.
      if (hasOpenOverlay()) return;

      disarm();
      // Written on OPEN, not on close: walking away has to count as having
      // seen it, or every navigation would be another chance to fire.
      if (promotion) suppressPromo(promotion, ["popup"]);
      setOpen(true);
    }

    function onVisibility() {
      // Re-baseline so the time spent hidden is not banked on the next tick.
      since = Date.now();
    }

    function onScroll() {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      if (scrollable <= 0) return;
      if (window.scrollY / scrollable >= SCROLL_FRACTION) fire();
    }

    function tick() {
      const now = Date.now();
      if (document.visibilityState === "visible") dwell += now - since;
      since = now;
      if (dwell >= DWELL_MS) fire();
    }

    const timer = setInterval(tick, TICK_MS);
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);

    return disarm;
  }, [promotion, suppressed, pathname, open]);

  // A path that became off-limits (a back gesture into the cart, say) hides
  // the popup without unsetting `open`; the effect below then unwinds the
  // scroll lock and the focus trap through its normal cleanup.
  const showing =
    open && !!promotion && !isPromoPathBlocked(pathname, "popup");

  /* ---- Focus trap, scroll lock, Escape ---- */
  useEffect(() => {
    if (!showing) return;
    const panel = panelRef.current;
    if (!panel) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    // `getClientRects()` rather than `offsetParent`, which is null for
    // anything inside a `position: fixed` subtree.
    const focusable = () =>
      Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.getClientRects().length > 0
      );

    (focusable()[0] ?? panel).focus();

    // An arrow rather than a `function` declaration on purpose: a hoisted
    // declaration is created before the `if (!panel) return` above it, so
    // TypeScript refuses to carry the narrowing into it.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        // Stop here: nothing behind this overlay should also act on Escape.
        e.stopPropagation();
        close();
        return;
      }
      if (e.key !== "Tab") return;

      const items = focusable();
      if (items.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      // Tab must not escape the dialog in either direction, and focus that has
      // somehow landed outside is pulled back in.
      if (!active || !panel.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    // Capture phase so the trap sees the key before any page-level handler.
    document.addEventListener("keydown", onKeyDown, true);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      // Focus goes back where it came from — usually <body>, since nothing was
      // clicked to open this.
      previouslyFocused?.focus?.();
    };
  }, [showing, close]);

  if (!showing || !promotion) return null;
  if (typeof document === "undefined") return null;

  /*
   * Portalled to <body>. `(store)/template.tsx` wraps page content in a
   * framer-motion transform, and a transformed ancestor becomes the containing
   * block for `position: fixed` — the size guide and the sticky buy bar portal
   * for exactly the same reason.
   */
  return createPortal(
    <div className="fixed inset-0 z-[75] flex items-center justify-center p-4">
      {/*
        Inert to keyboard and assistive tech: it is a mouse convenience, and
        the panel already carries two real, labelled dismiss controls.
      */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={close}
        className="absolute inset-0 cursor-default bg-black/50 animate-[fadeIn_0.2s_ease-out_both] motion-reduce:animate-none"
      />

      <PromoPopupPanel
        panelRef={panelRef}
        title={promotion.title}
        body={promotion.body}
        ctaLabel={promotion.ctaLabel}
        ctaHref={promotion.ctaHref}
        titleId={titleId}
        bodyId={promotion.body ? bodyId : undefined}
        onClose={close}
        // Following the offer is not a dismissal, but the popup has to get out
        // of the way of the page it just sent them to.
        onNavigate={() => setOpen(false)}
        // Opacity only, and honoured by `motion-reduce`. The panel's resting
        // position is the flex centring, never the end of an animation.
        className="animate-[fadeIn_0.22s_ease-out_both] motion-reduce:animate-none"
      />
    </div>,
    document.body
  );
}
