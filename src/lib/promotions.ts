/**
 * promotions — the one place that decides which promotion is on the store.
 *
 * The brief for this feature was "don't over-promo", so restraint is the
 * feature rather than a limitation of it. Three rules follow from that and
 * they all live here:
 *
 * 1. **At most one promotion is ever live.** Not "the active ones" — *the*
 *    active one. `getLivePromotion()` returns a single row or `null`, and both
 *    storefront surfaces (the banner and the first-visit popup) render from
 *    that same value, passed down from `(store)/layout.tsx`. There is no second
 *    query and no second opinion, so two promotions cannot end up on screen
 *    together however the admin fills the table.
 *
 * 2. **Ordering is priority first, then most recently created.** Priority is
 *    the deliberate lever; `createdAt` is the tie-break because it is stable —
 *    fixing a typo in an old promotion must not silently promote it over a
 *    newer one, which is what ordering on `updatedAt` would do.
 *
 * 3. **A failure shows nothing.** Unlike `getProductBySlug` — which must throw
 *    so a database blip becomes a 500 and not a 404 (see CLAUDE.md) — a
 *    promotion is decoration. If it cannot be read, the store renders exactly
 *    as it does when no promotion is scheduled. Failing closed is the whole
 *    posture of this feature.
 *
 * Window boundaries match the coupon engine exactly, because an admin running
 * a sale will set both to the same times and they have to mean the same thing:
 * **`startsAt` is inclusive, `endsAt` is exclusive.** The promotion is gone the
 * instant the clock reaches its end.
 *
 * This module reaches the database, so it is server-only. The pieces the
 * browser needs live elsewhere on purpose:
 *   - status wording + the pure status rule → `@/components/admin/promotion-summary`
 *   - dismissal storage + suppressed paths   → `@/components/store/promo-banner`
 */

import { cache } from "react";
import { prisma } from "./prisma";

/** Which surface(s) a promotion is allowed to use. */
export type PromotionKind = "banner" | "popup" | "both";

export const PROMOTION_KINDS: readonly PromotionKind[] = ["banner", "popup", "both"];

/**
 * `kind` is a plain `String` column, so anything could be in it — a hand-edited
 * row, or a value written by an older build. Narrow it rather than cast, and
 * fall back to the quietest surface: an unrecognised value should never be the
 * reason a popup appears.
 */
export function asPromotionKind(value: unknown): PromotionKind {
  return PROMOTION_KINDS.includes(value as PromotionKind)
    ? (value as PromotionKind)
    : "banner";
}

/**
 * What the storefront needs, and nothing else.
 *
 * Deliberately not the Prisma row: this crosses the server/client boundary as a
 * prop, so it has to be serialisable (no `Date`s) and it should not ship the
 * admin's scheduling fields to every visitor's browser.
 */
export type LivePromotion = {
  id: string;
  title: string;
  body: string;
  ctaLabel: string | null;
  ctaHref: string | null;
  kind: PromotionKind;
  /** Days a dismissal sticks for. 0 means "this browsing session only". */
  dismissDays: number;
};

/** Empty strings and whitespace-only values read as "not set". */
function trimmedOrNull(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

/**
 * The single live promotion, or `null`.
 *
 * Wrapped in React `cache()` for per-request dedup, the same way `getSettings`
 * and `getProductBySlug` are: the store layout renders on every route and this
 * must not become a second round trip to Mumbai (see the region note in
 * CLAUDE.md) if anything else ever asks for it in the same request.
 *
 * The window is filtered in SQL rather than in JS so the database returns one
 * row, not the whole table.
 */
export const getLivePromotion = cache(async (): Promise<LivePromotion | null> => {
  const now = new Date();

  try {
    const row = await prisma.promotion.findFirst({
      where: {
        isActive: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          // `gt`, not `gte`: the end of the window is exclusive, so a promotion
          // ending at 23:59 is over the moment the clock shows 23:59.
          { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
        ],
      },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        title: true,
        body: true,
        ctaLabel: true,
        ctaHref: true,
        kind: true,
        dismissDays: true,
      },
    });

    if (!row) return null;

    const ctaLabel = trimmedOrNull(row.ctaLabel);
    const ctaHref = trimmedOrNull(row.ctaHref);

    return {
      id: row.id,
      title: row.title.trim(),
      body: row.body.trim(),
      // A button with no destination is a dead control, and a destination with
      // no label is invisible. Both or neither — the editor enforces the same
      // pairing, this is the backstop for rows that predate it.
      ctaLabel: ctaLabel && ctaHref ? ctaLabel : null,
      ctaHref: ctaLabel && ctaHref ? ctaHref : null,
      kind: asPromotionKind(row.kind),
      // A negative `dismissDays` would make every dismissal instantly stale.
      dismissDays: Number.isFinite(row.dismissDays) ? Math.max(0, row.dismissDays) : 0,
    };
  } catch (error) {
    // Decoration, not content. See rule 3 in the header.
    console.error("[promotions] could not read the live promotion:", error);
    return null;
  }
});
