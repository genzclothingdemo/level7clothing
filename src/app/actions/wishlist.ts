"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getUserSession } from "@/lib/user-auth";

/**
 * Server-backed wishlist.
 *
 * The wishlist used to live only in `localStorage`, which meant it vanished on
 * a new device, could not survive clearing site data, and was invisible to the
 * admin — so "saved for later" told the store nothing.
 *
 * Signed in, the `WishlistItem` rows are the source of truth. Guests still use
 * localStorage; `mergeWishlist` folds those slugs in on sign-in so nothing a
 * guest saved is lost when they make an account.
 *
 * Slugs, not product ids, to match how the storefront addresses products — and
 * so a deleted product degrades to "no longer available" rather than a
 * dangling join.
 */

const MAX_ITEMS = 200;

/** Every saved slug for the signed-in customer, newest first. Empty for guests. */
export async function getMyWishlist(): Promise<string[]> {
  const session = await getUserSession();
  if (!session) return [];

  const rows = await prisma.wishlistItem
    .findMany({
      where: { userId: session.id },
      orderBy: { createdAt: "desc" },
      select: { slug: true },
    })
    .catch(() => []);

  return rows.map((r) => r.slug);
}

/**
 * Save or unsave one product.
 *
 * Returns `{ ok: false, guest: true }` for a signed-out visitor rather than
 * throwing — the client then keeps its local copy, which is the correct
 * behaviour, not an error.
 */
export async function setWishlistItem(slug: string, saved: boolean) {
  const session = await getUserSession();
  if (!session) return { ok: false as const, guest: true as const };

  const clean = slug.trim();
  if (!clean) return { ok: false as const, guest: false as const };

  try {
    if (saved) {
      const count = await prisma.wishlistItem.count({ where: { userId: session.id } });
      if (count >= MAX_ITEMS) {
        return { ok: false as const, guest: false as const, error: "Wishlist is full" };
      }
      // Idempotent: double-tapping the heart must not throw on the unique key.
      await prisma.wishlistItem.upsert({
        where: { userId_slug: { userId: session.id, slug: clean } },
        update: {},
        create: { userId: session.id, slug: clean },
      });
    } else {
      await prisma.wishlistItem.deleteMany({
        where: { userId: session.id, slug: clean },
      });
    }
  } catch {
    return { ok: false as const, guest: false as const, error: "Could not save" };
  }

  revalidatePath("/wishlist");
  return { ok: true as const, guest: false as const };
}

/**
 * Fold a guest's locally-saved slugs into their account.
 *
 * A union, never a replace: someone who saved three things on their phone as a
 * guest and two on their laptop while signed in should end up with five.
 * Returns the merged list so the client can adopt the server's view.
 */
export async function mergeWishlist(slugs: string[]): Promise<string[]> {
  const session = await getUserSession();
  if (!session) return [];

  const clean = Array.from(
    new Set(slugs.map((s) => String(s ?? "").trim()).filter(Boolean))
  ).slice(0, MAX_ITEMS);

  if (clean.length > 0) {
    await prisma.wishlistItem
      .createMany({
        data: clean.map((slug) => ({ userId: session.id, slug })),
        // Anything already saved simply stays — that's the union.
        skipDuplicates: true,
      })
      .catch(() => null);
  }

  revalidatePath("/wishlist");
  return getMyWishlist();
}

export async function clearMyWishlist() {
  const session = await getUserSession();
  if (!session) return { ok: false as const, guest: true as const };

  await prisma.wishlistItem.deleteMany({ where: { userId: session.id } }).catch(() => null);
  revalidatePath("/wishlist");
  return { ok: true as const, guest: false as const };
}
