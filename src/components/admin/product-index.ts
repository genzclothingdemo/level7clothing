import { prisma } from "@/lib/prisma";
import type { CustomerRecord } from "@/lib/customers";

/**
 * Every product a customer has touched, **with its photo** — in one query.
 *
 * ## Why this exists beside `getCustomerProducts`
 *
 * `getCustomerProducts()` in `lib/customers.ts` already does exactly this, and
 * its select is `{ id, slug, name, price, isActive }` — no `images`. Leading a
 * row with the product means rendering a thumbnail, and a thumbnail needs that
 * one column.
 *
 * So this is that function plus `images`, and the customer sections call **this
 * one instead of** the other — never both. That matters more than the
 * duplication does: the store is one network hop from Mumbai and the customer
 * 360 is the page CLAUDE.md names as the first to fall over under a tight
 * connection pool, so the rule is *no extra round trip for a picture*. Query
 * count is unchanged; only the select got one column wider.
 *
 * **Delete this file** the moment `getCustomerProducts` can take `images: true`
 * — the shape below is deliberately a superset of `CustomerProduct`, so every
 * caller is a one-line revert. Two resolvers for one question is a drift
 * hazard, and it is only tolerable while it is this small and this documented.
 */

export type AdminProductLookup = {
  id: string;
  slug: string;
  name: string;
  price: number;
  isActive: boolean;
  /** The product's own first photo. Null when it has none at all. */
  image: string | null;
};

export type AdminProductIndex = {
  byId: Map<string, AdminProductLookup>;
  bySlug: Map<string, AdminProductLookup>;
};

const EMPTY: AdminProductIndex = { byId: new Map(), bySlug: new Map() };

/**
 * Ids come from order lines, returns and cart leads; slugs come from the
 * wishlist, which stores a slug rather than an id (see the model comment). Both
 * are resolved in the same `findMany` so a customer page still costs one
 * product query however many sections are on it.
 */
export async function getAdminProductIndex(
  customer: CustomerRecord
): Promise<AdminProductIndex> {
  const ids = new Set<string>();
  for (const o of customer.orders) {
    for (const i of o.items) if (i.productId) ids.add(i.productId);
  }
  for (const r of customer.returns) if (r.productId) ids.add(r.productId);
  for (const l of customer.leads) if (l.productId) ids.add(l.productId);

  const slugs = new Set(customer.wishlist.map((w) => w.slug));
  if (ids.size === 0 && slugs.size === 0) return EMPTY;

  const rows = await prisma.product
    .findMany({
      where: { OR: [{ id: { in: [...ids] } }, { slug: { in: [...slugs] } }] },
      select: {
        id: true,
        slug: true,
        name: true,
        price: true,
        isActive: true,
        images: true,
      },
    })
    // Same rule as every other read on these pages: a missing photo is a
    // thumbnail placeholder, never a 500. The admin panel is where you go
    // *when* something is broken.
    .catch(() => []);

  const byId = new Map<string, AdminProductLookup>();
  const bySlug = new Map<string, AdminProductLookup>();
  for (const p of rows) {
    const entry: AdminProductLookup = {
      id: p.id,
      slug: p.slug,
      name: p.name,
      price: p.price,
      isActive: p.isActive,
      image: p.images[0] ?? null,
    };
    byId.set(p.id, entry);
    bySlug.set(p.slug, entry);
  }
  return { byId, bySlug };
}
