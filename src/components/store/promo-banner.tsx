"use client";

/**
 * The promotion banner — the quiet surface.
 *
 * ---------------------------------------------------------------------------
 * Where it sits, and why
 * ---------------------------------------------------------------------------
 *
 * Directly **below** `AnnouncementBar` and **above** `Navbar`. That order is
 * deliberate:
 *
 * - The announcement bar is permanent chrome. It is the store's masthead and
 *   it is on every page forever, so it keeps the top edge. Pushing it down for
 *   a two-week sale would change the site's silhouette on every page.
 * - This banner is temporary and dismissible, so it belongs *under* the
 *   permanent thing. Dismissing it then collapses the stack cleanly with
 *   nothing above it moving.
 * - Neither bar may be mistaken for the other, so they are drawn differently
 *   on purpose: the announcement bar is inverted ink (`bg-foreground`), this is
 *   a tonal violet strip. Two full-width inverted bars stacked would read as a
 *   template, which is the exact failure mode CLAUDE.md warns about.
 *
 * There is also a literal de-duplication guard: if the admin has typed the
 * same line into Settings → Announcement and into a promotion, the banner
 * stands down rather than saying it twice.
 *
 * ---------------------------------------------------------------------------
 * Why the banner is not in the server HTML
 * ---------------------------------------------------------------------------
 *
 * Dismissal lives in the browser, so the server cannot know whether to render
 * it. The snapshot below therefore starts as "suppressed" and the banner
 * appears after hydration. That costs one layout shift at the very top of the
 * page; the alternative — render it server-side and remove it once storage is
 * read — flashes a banner at someone who already dismissed it, which is worse
 * for exactly the shopper this feature is supposed to respect.
 */

import { useCallback, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowRight, X } from "lucide-react";
import type { LivePromotion } from "@/lib/promotions";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  The dismissal contract (shared with promo-popup.tsx)               */
/* ------------------------------------------------------------------ */

/**
 * This lives here rather than in `@/lib/promotions` because that module reads
 * the database and so cannot be imported by a client component. The popup
 * imports it from here so there is one implementation of "has this shopper
 * already said no", not two that can disagree.
 */

export type PromoSurface = "banner" | "popup";

const DAY_MS = 86_400_000;

/** Matches the `l7:` prefix used by the push prompt and the update watcher. */
function storageKey(surface: PromoSurface, id: string): string {
  return `l7:promo-${surface}:${id}`;
}

/**
 * `dismissDays: 0` means "this browsing session only", and `sessionStorage` is
 * the only honest way to express that — a timestamp in `localStorage` would
 * still be there tomorrow. Everything else goes to `localStorage`.
 *
 * Reading `window.sessionStorage` can itself throw, which is why even picking
 * the store is inside the try/catch at each call site.
 */
function storeFor(promo: LivePromotion): Storage {
  return promo.dismissDays > 0 ? window.localStorage : window.sessionStorage;
}

/**
 * Has this shopper already been shown, or already waved away, this promotion
 * on this surface?
 *
 * The record holds **when** it happened, not when it expires. Expiry is
 * recomputed from the promotion's current `dismissDays` on every read, so
 * shortening the window in the admin takes effect immediately instead of being
 * frozen into records written under the old setting.
 *
 * Every path fails **closed**. A browser that cannot remember a dismissal is a
 * browser that would be nagged on every single page load, so "storage is
 * unavailable" resolves to "don't show it" — per requirement, and per the same
 * reasoning as `readDismissed` in `push-core.ts`.
 */
function readSuppressed(promo: LivePromotion, surface: PromoSurface): boolean {
  let raw: string | null;
  try {
    raw = storeFor(promo).getItem(storageKey(surface, promo.id));
  } catch {
    return true;
  }

  if (raw === null) return false;
  // Session-scoped: the record existing at all is the whole answer, because
  // the browser throws it away when the tab closes.
  if (promo.dismissDays <= 0) return true;

  const at = Number(raw);
  // A corrupted record is treated as a dismissal rather than as an invitation
  // to start showing the popup again.
  if (!Number.isFinite(at)) return true;
  return Date.now() - at < promo.dismissDays * DAY_MS;
}

const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // `storage` only fires in *other* tabs, which is what stops a dismissal in
  // one window leaving the banner sitting in another.
  const onStorage = () => onChange();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/**
 * Read the dismissal through `useSyncExternalStore`, not an effect.
 *
 * Storage is exactly what that hook is for, and it avoids the
 * `react-hooks/set-state-in-effect` cascade this repo already carries too much
 * of. The **server snapshot is `true`**, so neither surface is ever in the
 * server-rendered HTML and there is nothing for hydration to disagree about.
 */
export function usePromoSuppressed(
  promo: LivePromotion | null,
  surface: PromoSurface
): boolean {
  const snapshot = useCallback(
    () => (promo ? readSuppressed(promo, surface) : true),
    [promo, surface]
  );
  return useSyncExternalStore(subscribe, snapshot, () => true);
}

/**
 * Record that this promotion is done with, on one or more surfaces.
 *
 * The popup calls this the moment it *opens* — not only when it is closed —
 * which is what makes it a first-visit popup rather than one that reappears on
 * every navigation. The banner calls it only on an explicit dismissal, because
 * a passive strip has not interrupted anyone and can wait to be told.
 */
export function suppressPromo(
  promo: LivePromotion,
  surfaces: PromoSurface[] = ["banner", "popup"]
): void {
  try {
    const store = storeFor(promo);
    const stamp = String(Date.now());
    for (const surface of surfaces) store.setItem(storageKey(surface, promo.id), stamp);
  } catch {
    /* Private mode. `readSuppressed` already fails closed, so nothing reappears. */
  }
  for (const listener of listeners) listener();
}

/* ------------------------------------------------------------------ */
/*  Where a promotion may not appear                                   */
/* ------------------------------------------------------------------ */

/**
 * The popup's exclusions are the strict list: interrupting someone who is
 * paying you is indefensible, and so is interrupting them while they read
 * their own order.
 *
 * The banner's list is shorter because a passive strip is not an interruption.
 * It still stands down on checkout and on the order pages, where a discount
 * offer either sends someone off to hunt for a code mid-payment or tells them
 * they have just overpaid.
 *
 * `/admin` is in both as a backstop only — the admin panel has its own layout
 * and never mounts either surface.
 */
const BLOCKED: Record<PromoSurface, RegExp[]> = {
  banner: [/^\/checkout/, /^\/order\//, /^\/admin/],
  popup: [/^\/checkout/, /^\/cart/, /^\/account/, /^\/order\//, /^\/admin/],
};

export function isPromoPathBlocked(
  pathname: string | null | undefined,
  surface: PromoSurface
): boolean {
  return BLOCKED[surface].some((re) => re.test(pathname || "/"));
}

/* ------------------------------------------------------------------ */
/*  Shared bits of presentation                                        */
/* ------------------------------------------------------------------ */

/**
 * An admin can point a CTA at their own store or at somewhere else entirely.
 * A relative path gets `next/link` (client navigation, prefetch); anything
 * else is treated as off-site and opened safely.
 *
 * With no `href` — or when `inert`, which is how the admin preview renders it
 * — this degrades to a plain `<span>` rather than a link to nowhere, so the
 * same markup serves a promotion that has no call to action.
 */
export function PromoLink({
  href,
  className,
  onNavigate,
  inert = false,
  children,
}: {
  href?: string | null;
  className?: string;
  onNavigate?: () => void;
  /** Renders a non-navigating copy — used by the admin preview. */
  inert?: boolean;
  children: React.ReactNode;
}) {
  if (!href || inert) {
    return <span className={className}>{children}</span>;
  }

  if (href.startsWith("/")) {
    return (
      <Link href={href} onClick={onNavigate} className={className}>
        {children}
      </Link>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onNavigate}
      className={className}
    >
      {children}
    </a>
  );
}

/**
 * The banner's markup with no behaviour attached, so the admin preview renders
 * the real thing rather than a drawing of it. Anything that changes here
 * changes in both places at once.
 */
export function PromoBannerShell({
  title,
  body,
  ctaLabel,
  ctaHref,
  onDismiss,
  onNavigate,
  inert = false,
  className,
}: {
  title: string;
  body: string;
  ctaLabel?: string | null;
  ctaHref?: string | null;
  onDismiss?: () => void;
  onNavigate?: () => void;
  inert?: boolean;
  className?: string;
}) {
  const cta = ctaLabel && ctaHref ? { label: ctaLabel, href: ctaHref } : null;

  return (
    <div
      className={cn(
        // Tonal, not inverted — see the header note on not being a second
        // announcement bar. The bottom rule is what separates it from the
        // navbar underneath.
        "border-b border-accent/20 bg-accent/10 text-foreground",
        className
      )}
    >
      {/*
        `min-h-11` is the whole height: it is the 44px tap-target floor, and
        making it the row height means the dismiss button fits exactly with no
        vertical padding to add to it. A promo strip taller than the navbar
        would not be "slim", so the bar stays one line at every width and the
        copy gives way instead.
      */}
      <div className="container-px mx-auto flex min-h-11 max-w-7xl items-center gap-2">
        {/*
          The copy and the call to action are ONE link, not two: a second link
          to the same place is just a second thing for a screen reader to read
          out, and on a phone the whole strip being tappable is what makes the
          offer reachable without a visible button.
        */}
        <PromoLink
          href={cta?.href}
          onNavigate={onNavigate}
          inert={inert}
          className={cn(
            // `min-w-0` is what lets the text truncate instead of widening the
            // flex row — without it this overflows at 320px and takes the page
            // with it.
            "flex min-h-11 min-w-0 flex-1 items-center gap-2",
            cta && !inert && "cursor-pointer",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          )}
        >
          <span className="min-w-0 flex-1 truncate text-xs leading-none">
            <span className="font-medium tracking-wide">{title}</span>
            {body && (
              // The body is the first thing to go on a narrow screen: the
              // title carries the offer, the body only qualifies it.
              <span className="hidden text-muted-foreground sm:inline"> — {body}</span>
            )}
          </span>

          {cta && (
            <>
              <span className="hidden shrink-0 text-[11px] font-medium uppercase tracking-widest text-accent sm:inline">
                {cta.label}
              </span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
            </>
          )}
        </PromoLink>

        {/* One obvious control, a full 44px square, never a 10px cross. */}
        <button
          type="button"
          onClick={onDismiss}
          disabled={inert}
          tabIndex={inert ? -1 : undefined}
          aria-hidden={inert || undefined}
          aria-label="Dismiss this offer"
          className={cn(
            "-mr-2.5 grid h-11 w-11 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors",
            !inert && "cursor-pointer hover:bg-accent/10 hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          )}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  The live banner                                                    */
/* ------------------------------------------------------------------ */

/** Normalised so punctuation and casing don't hide a duplicated line. */
function pitch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function PromoBanner({
  promotion,
  /** The announcement bar's current copy, so the two can't say the same thing. */
  announcement,
}: {
  promotion: LivePromotion | null;
  announcement?: string | null;
}) {
  const pathname = usePathname();
  const suppressed = usePromoSuppressed(promotion, "banner");

  if (!promotion) return null;
  if (promotion.kind === "popup") return null;
  if (suppressed) return null;
  if (isPromoPathBlocked(pathname, "banner")) return null;

  // Don't be the second voice saying the same sentence.
  const said = pitch(announcement ?? "");
  if (said && (said === pitch(promotion.title) || said === pitch(promotion.body))) {
    return null;
  }

  return (
    <PromoBannerShell
      title={promotion.title}
      body={promotion.body}
      ctaLabel={promotion.ctaLabel}
      ctaHref={promotion.ctaHref}
      // Only the banner is suppressed here. Waving away the quiet strip is a
      // "no" to the offer, so it silences the popup too — but not the reverse.
      onDismiss={() => suppressPromo(promotion, ["banner", "popup"])}
      // Opacity only. Its resting position comes from the document flow, so an
      // interrupted animation can never strand it (see CLAUDE.md, Modal pattern).
      className="animate-[fadeIn_0.2s_ease-out_both] motion-reduce:animate-none"
    />
  );
}
