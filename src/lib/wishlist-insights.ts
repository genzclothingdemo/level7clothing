/**
 * Wishlists — saved intent, pivoted two ways.
 *
 * Admin → Interested customers answers *who put this in a cart*. This is its
 * twin for the other signal the store records: **a save**. The owner asked for
 * both directions of the same question —
 *
 *   "green tees kitne user ne wishlist kiya hai"   → by product
 *   "jeel ne kitne product wishlist me add kiye"   → by person
 *
 * — so neither direction is the real one. Both are built from the same list of
 * saves, which is what stops the two views ever disagreeing about a total.
 *
 * ── One save, two groupings ──────────────────────────────────────────────────
 *
 * `getWishlistInsights()` produces a flat `WishlistSave[]` and nothing else
 * that matters. Filtering happens on **individual saves**, and only then does
 * `groupByProduct()` / `groupByPerson()` rebuild a view. That ordering is the
 * whole design: "green tees, out of stock" selects the same saves whichever
 * pivot is on screen, so switching pivot re-arranges the answer instead of
 * changing it. Filter-then-group also makes a filter *inside* a group work —
 * asking "who wants something that is out of stock" narrows each person's
 * pieces rather than silently showing all of them.
 *
 * ── Identity is not decided here ─────────────────────────────────────────────
 *
 * Every person on this screen comes from `lib/customers.ts`, already merged.
 * This module never looks at an email or a phone number and never asks who
 * somebody is; it reads `CustomerRecord.wishlist` off a record the merge has
 * finished with. Writing a second identity rule here is the one change that
 * would let this screen and Customers name different people — the same trap
 * the customers/guests split is documented to avoid.
 *
 * A consequence worth knowing, and stated on the screen: `WishlistItem.userId`
 * is **required**, so a save can only exist against an account. Everyone here
 * is `kind: "customer"`. Interested customers is mostly the opposite — guests
 * who left a contact detail at add-to-cart. The two screens are looking at
 * different halves of the same funnel, which is why they are two tabs and not
 * one list.
 */

import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { fuzzyFilter } from "@/lib/search";
import { adminLink, getCustomers } from "@/lib/customers";
import type { BadgeTone } from "@/components/admin/order-ui";

/* ------------------------------------------------------------------ */
/*  Pivot                                                              */
/* ------------------------------------------------------------------ */

export const WISHLIST_PIVOTS = ["product", "person"] as const;

export type WishlistPivot = (typeof WISHLIST_PIVOTS)[number];

export function isWishlistPivot(v: string): v is WishlistPivot {
  return (WISHLIST_PIVOTS as readonly string[]).includes(v);
}

export const WISHLIST_PIVOT_LABEL: Record<WishlistPivot, string> = {
  product: "By product",
  person: "By person",
};

export const WISHLIST_PIVOT_HELP: Record<WishlistPivot, string> = {
  product:
    "One card per piece: how many people saved it, who they are, and whether it can still be bought. This is the view for deciding what to restock or push.",
  person:
    "One card per shopper: how many pieces they saved and which ones. This is the view for a follow-up — everything one person is waiting on, in one place.",
};

/* ------------------------------------------------------------------ */
/*  Availability                                                       */
/* ------------------------------------------------------------------ */

/**
 * Can somebody act on this save right now?
 *
 * Deliberately three states rather than a boolean, because the three want
 * different things done. `in` is a nudge, `out` is a restock decision, `off`
 * is a piece somebody is holding a dead link to.
 */
export const WISHLIST_AVAILABILITIES = ["in", "out", "off"] as const;

export type WishlistAvailability = (typeof WISHLIST_AVAILABILITIES)[number];

export function isWishlistAvailability(v: string): v is WishlistAvailability {
  return (WISHLIST_AVAILABILITIES as readonly string[]).includes(v);
}

export const WISHLIST_AVAILABILITY_LABEL: Record<WishlistAvailability, string> = {
  in: "In stock",
  out: "Out of stock",
  off: "Not for sale",
};

export const WISHLIST_AVAILABILITY_TONE: Record<WishlistAvailability, BadgeTone> = {
  in: "success",
  out: "warn",
  off: "neutral",
};

export const WISHLIST_AVAILABILITY_HELP: Record<WishlistAvailability, string> = {
  in: "On the storefront with stock on hand. A message to everyone who saved it can be acted on the moment they read it.",
  out: "On the storefront with nothing left. These are the saves worth restocking for — the demand is already recorded, by name.",
  off: "Hidden from the storefront, or gone from the catalogue altogether. Anyone who saved it is holding a link to a page that no longer sells anything.",
};

/* ------------------------------------------------------------------ */
/*  Sorting                                                            */
/* ------------------------------------------------------------------ */

export const WISHLIST_SORTS = [
  { value: "saves", label: "Most saved" },
  { value: "recent", label: "Most recent" },
  { value: "name", label: "A–Z" },
] as const;

export type WishlistSort = (typeof WISHLIST_SORTS)[number]["value"];

export function isWishlistSort(v: string): v is WishlistSort {
  return WISHLIST_SORTS.some((s) => s.value === v);
}

/* ------------------------------------------------------------------ */
/*  Shapes                                                             */
/* ------------------------------------------------------------------ */

/**
 * The piece a save is about.
 *
 * `id` is null when nothing in the catalogue matches the slug any more — the
 * wishlist stores a slug rather than a foreign key precisely so a deleted
 * product degrades instead of dangling (see the model comment). A null `id`
 * means `href` is null too: the row prints the slug as plain text rather than
 * offering a link to an editor for a product that is not there.
 */
export type WishlistPiece = {
  slug: string;
  id: string | null;
  /** The product's name, or the slug when the piece has been deleted. */
  name: string;
  image: string | null;
  price: number | null;
  stock: number | null;
  category: string | null;
  availability: WishlistAvailability;
  /** The admin editor for this piece, or null when there is nothing to open. */
  href: string | null;
};

/** The person, exactly as `lib/customers.ts` already resolved them. */
export type WishlistSaver = {
  /** The customer record's URL id — not a `User.id`. */
  id: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  location: string | null;
  orderCount: number;
  href: string;
};

export type WishlistSave = {
  /** `<customer id>:<slug>` — unique by construction, `@@unique([userId, slug])`. */
  id: string;
  savedAt: Date;
  saver: WishlistSaver;
  piece: WishlistPiece;
  /**
   * They have since ordered this exact piece.
   *
   * Matched on `productId` inside the order's line items, over every order
   * that was not cancelled. A piece that has been deleted from the catalogue
   * has no id to match, so it can never read as converted — which is honest
   * rather than wrong: there is no longer anything to compare against.
   */
  converted: boolean;
};

export type WishlistProductGroup = {
  /** The slug — the selection key for this row. */
  id: string;
  piece: WishlistPiece;
  saves: WishlistSave[];
  /** One person can only save a piece once, so this is also `saves.length`. */
  savers: number;
  converted: number;
  lastSavedAt: Date;
  /** List price × saves that have not converted. See `openValue`. */
  openValue: number;
};

export type WishlistPersonGroup = {
  /** The customer record id — the selection key for this row. */
  id: string;
  saver: WishlistSaver;
  saves: WishlistSave[];
  pieces: number;
  converted: number;
  lastSavedAt: Date;
  openValue: number;
};

export type WishlistTotals = {
  saves: number;
  /** Distinct pieces. */
  pieces: number;
  /** Distinct people. */
  people: number;
  converted: number;
  /** Saves sitting on a piece nobody can buy right now — `out` or `off`. */
  unavailable: number;
  /**
   * Σ list price over saves that have not converted.
   *
   * A ceiling, not a forecast: it assumes every open save becomes one sale at
   * full price, which is not what happens. It is here because it puts the
   * queue in the same unit as everything else on the admin, so "23 saves" can
   * be weighed against an order.
   */
  openValue: number;
};

export type WishlistInsights = {
  /** Every save, newest first. Both pivots are built from this one list. */
  saves: WishlistSave[];
  /** Categories present among the saved pieces — the filter's options. */
  categories: string[];
  totals: WishlistTotals;
};

/* ------------------------------------------------------------------ */
/*  Pieces                                                             */
/* ------------------------------------------------------------------ */

/**
 * Resolve every saved slug to a piece, in one query.
 *
 * `isActive` is deliberately NOT in the `where`: `getProductsBySlugs` filters
 * inactive pieces out because the storefront must not link to them, and using
 * it here would make a retired product indistinguishable from a deleted one —
 * collapsing the two states this screen exists to tell apart.
 *
 * The thumbnail prefers a hand-picked `slot: "preview"` row and falls back to
 * the legacy `images[0]` mirror, which is what `/admin/products` uses. Only 7
 * of this store's 127 `ProductImage` rows are previews, so the fallback is the
 * common path rather than a safety net.
 */
async function resolvePieces(slugs: string[]): Promise<Map<string, WishlistPiece>> {
  const out = new Map<string, WishlistPiece>();
  if (slugs.length === 0) return out;

  try {
    const rows = await prisma.product.findMany({
      where: { slug: { in: slugs } },
      select: {
        id: true,
        slug: true,
        name: true,
        price: true,
        stock: true,
        isActive: true,
        category: true,
        images: true,
        productImages: {
          where: { slot: "preview" },
          orderBy: { sortOrder: "asc" },
          take: 1,
          select: { media: { select: { url: true } } },
        },
      },
    });

    for (const p of rows) {
      out.set(p.slug, {
        slug: p.slug,
        id: p.id,
        name: p.name,
        image: p.productImages[0]?.media.url ?? p.images[0] ?? null,
        price: p.price,
        stock: p.stock,
        category: p.category,
        availability: !p.isActive ? "off" : p.stock > 0 ? "in" : "out",
        href: adminLink.product(p.id),
      });
    }
  } catch (err) {
    // Same bargain the customer directory makes: a reporting screen that is
    // missing a column is still worth opening, and the admin is where you go
    // *when* something is broken. Unresolved slugs fall through to the
    // "deleted piece" shape below, which is the truthful reading of "the
    // catalogue has no row for this".
    console.error("[wishlist-insights] product lookup failed:", err);
  }

  return out;
}

/** A save whose product is no longer in the catalogue. */
function missingPiece(slug: string): WishlistPiece {
  return {
    slug,
    id: null,
    name: slug,
    image: null,
    price: null,
    stock: null,
    category: null,
    availability: "off",
    href: null,
  };
}

/* ------------------------------------------------------------------ */
/*  The read                                                           */
/* ------------------------------------------------------------------ */

/**
 * Every save in the store, with its person and its piece attached.
 *
 * Two queries' worth of work on top of the customer directory: the directory
 * itself (six parallel reads, already `cache()`d and shared with Admin →
 * Customers if both run in one request) and one product lookup bounded to the
 * slugs that were actually saved.
 *
 * Wrapped in `cache()` for per-request dedup, because the page reads it once
 * for the tiles and the list is built from the same object.
 */
export const getWishlistInsights = cache(async (): Promise<WishlistInsights> => {
  const { customers } = await getCustomers();

  const withSaves = customers.filter((c) => c.wishlist.length > 0);
  const slugs = [...new Set(withSaves.flatMap((c) => c.wishlist.map((w) => w.slug)))];
  const pieces = await resolvePieces(slugs);

  const saves: WishlistSave[] = [];

  for (const c of withSaves) {
    const saver: WishlistSaver = {
      id: c.id,
      displayName: c.displayName,
      email: c.email,
      phone: c.phone,
      location: c.location,
      orderCount: c.stats.orderCount,
      href: adminLink.customer(c.id),
    };

    // What this person has actually bought, by product id. Cancelled orders
    // are dropped: an order that was cancelled did not convert the save, and
    // counting it would quietly close a piece of demand that is still open.
    const bought = new Set<string>();
    for (const o of c.orders) {
      if (o.status === "cancelled") continue;
      for (const i of o.items) if (i.productId) bought.add(i.productId);
    }

    for (const w of c.wishlist) {
      const piece = pieces.get(w.slug) ?? missingPiece(w.slug);
      saves.push({
        id: `${c.id}:${w.slug}`,
        savedAt: w.createdAt,
        saver,
        piece,
        converted: piece.id != null && bought.has(piece.id),
      });
    }
  }

  saves.sort((a, b) => b.savedAt.getTime() - a.savedAt.getTime());

  const categories = [
    ...new Set(
      saves.map((s) => s.piece.category).filter((c): c is string => !!c)
    ),
  ].sort();

  return { saves, categories, totals: totalsFor(saves) };
});

/* ------------------------------------------------------------------ */
/*  Totals                                                             */
/* ------------------------------------------------------------------ */

/**
 * Computed over whatever list it is given, so the tiles can describe the
 * filtered view rather than a store-wide figure the reader is not looking at.
 */
export function totalsFor(saves: WishlistSave[]): WishlistTotals {
  const pieces = new Set<string>();
  const people = new Set<string>();
  let converted = 0;
  let unavailable = 0;
  let openValue = 0;

  for (const s of saves) {
    pieces.add(s.piece.slug);
    people.add(s.saver.id);
    if (s.converted) converted++;
    else if (s.piece.price != null) openValue += s.piece.price;
    if (s.piece.availability !== "in") unavailable++;
  }

  return {
    saves: saves.length,
    pieces: pieces.size,
    people: people.size,
    converted,
    unavailable,
    openValue,
  };
}

/* ------------------------------------------------------------------ */
/*  Filtering — on saves, before either grouping                       */
/* ------------------------------------------------------------------ */

export type WishlistFilter = {
  q: string;
  category: string | null;
  availability: WishlistAvailability | null;
};

/**
 * One search box across both sides of the pivot.
 *
 * The product is weighted above the person because the product view is the
 * default and "green tees" is the query the owner actually asked for, but a
 * name, an email or a phone number matches too — so "jeel" finds their saves
 * without switching pivot first. Typo-tolerant, via the same ranker the
 * storefront and the products list use.
 */
export function searchSaves(saves: WishlistSave[], query: string): WishlistSave[] {
  return fuzzyFilter(saves, query, [
    { name: "piece.name", weight: 0.4 },
    { name: "piece.slug", weight: 0.1 },
    { name: "piece.category", weight: 0.1 },
    { name: "saver.displayName", weight: 0.2 },
    { name: "saver.email", weight: 0.15 },
    { name: "saver.phone", weight: 0.05 },
  ]);
}

/**
 * Narrow the saves. **Every filter is applied here and nowhere else**, which
 * is what makes the two pivots two arrangements of one answer.
 */
export function filterSaves(
  saves: WishlistSave[],
  filter: WishlistFilter
): WishlistSave[] {
  let out = saves;
  if (filter.category) out = out.filter((s) => s.piece.category === filter.category);
  if (filter.availability) {
    out = out.filter((s) => s.piece.availability === filter.availability);
  }
  // Search last, so the ranker orders what survived the facets rather than
  // ranking rows that are about to be thrown away.
  return filter.q.trim() ? searchSaves(out, filter.q) : out;
}

/** How many of these saves sit in each availability state — for the chips. */
export function availabilityCounts(
  saves: WishlistSave[]
): Record<string, number> {
  const counts: Record<string, number> = { all: saves.length };
  for (const a of WISHLIST_AVAILABILITIES) counts[a] = 0;
  for (const s of saves) counts[s.piece.availability]++;
  return counts;
}

/* ------------------------------------------------------------------ */
/*  Grouping                                                           */
/* ------------------------------------------------------------------ */

/** Σ list price over the saves that have not converted. */
function openValueOf(saves: WishlistSave[]): number {
  return saves.reduce(
    (n, s) => n + (!s.converted && s.piece.price != null ? s.piece.price : 0),
    0
  );
}

export function groupByProduct(saves: WishlistSave[]): WishlistProductGroup[] {
  const map = new Map<string, WishlistSave[]>();
  for (const s of saves) {
    const list = map.get(s.piece.slug);
    if (list) list.push(s);
    else map.set(s.piece.slug, [s]);
  }

  const out: WishlistProductGroup[] = [];
  for (const [slug, list] of map) {
    out.push({
      id: slug,
      piece: list[0].piece,
      saves: list,
      savers: list.length,
      converted: list.filter((s) => s.converted).length,
      lastSavedAt: list[0].savedAt, // `saves` arrives newest-first
      openValue: openValueOf(list),
    });
  }
  return out;
}

export function groupByPerson(saves: WishlistSave[]): WishlistPersonGroup[] {
  const map = new Map<string, WishlistSave[]>();
  for (const s of saves) {
    const list = map.get(s.saver.id);
    if (list) list.push(s);
    else map.set(s.saver.id, [s]);
  }

  const out: WishlistPersonGroup[] = [];
  for (const [id, list] of map) {
    out.push({
      id,
      saver: list[0].saver,
      saves: list,
      pieces: list.length,
      converted: list.filter((s) => s.converted).length,
      lastSavedAt: list[0].savedAt,
      openValue: openValueOf(list),
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Sorting                                                            */
/* ------------------------------------------------------------------ */

/**
 * The same three orders for both pivots, so the control does not change
 * meaning when the pivot does. "Most saved" counts people on the product side
 * and pieces on the person side — which is the same number, read from the
 * other end.
 */
export function sortGroups<T extends { saves: WishlistSave[]; lastSavedAt: Date }>(
  groups: T[],
  sort: WishlistSort,
  nameOf: (g: T) => string
): T[] {
  const out = [...groups];
  if (sort === "name") {
    out.sort((a, b) => nameOf(a).localeCompare(nameOf(b), "en"));
  } else if (sort === "recent") {
    out.sort((a, b) => b.lastSavedAt.getTime() - a.lastSavedAt.getTime());
  } else {
    // Ties on count break on recency, so an equal-sized group that moved today
    // sits above one that has not changed in a month.
    out.sort(
      (a, b) =>
        b.saves.length - a.saves.length ||
        b.lastSavedAt.getTime() - a.lastSavedAt.getTime()
    );
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Contact list                                                       */
/* ------------------------------------------------------------------ */

/**
 * The email addresses behind a selection, deduped and lowercased.
 *
 * This is the whole point of the selection on this screen: a restock is worth
 * announcing to the people who already asked for it, and the only thing
 * stopping that today is that their addresses are spread over N cards. One
 * rule, used by both pivots, so "copy emails" cannot mean two things.
 *
 * Deliberately returns addresses rather than sending anything. Reverse-leg
 * emails do not exist yet (see CLAUDE.md) and a one-click blast to real
 * customers from an admin list is not something to add behind a checkbox.
 *
 * Typed on the narrowest shape it actually reads rather than on `WishlistSave`,
 * so the table can call it on its own pre-formatted view rows. Two copies of
 * "which addresses does this selection mean" is exactly how the two pivots
 * would end up copying different lists.
 */
export function emailsOf(saves: { saver: { email: string | null } }[]): string[] {
  const seen = new Set<string>();
  for (const s of saves) {
    const e = s.saver.email?.trim().toLowerCase();
    if (e) seen.add(e);
  }
  return [...seen].sort();
}
