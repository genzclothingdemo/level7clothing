// Customer reviews — shared config plus the read helpers the storefront uses.
// Ratings on the storefront come from THIS table only. There is no synthetic
// fallback: a product with no approved reviews shows no rating at all, because a
// star count a shopper can't trace to a real review is worse than none.

import { prisma } from "./prisma";

export const REVIEW_FILTERS = ["all", "pending", "approved", "featured"] as const;
export type ReviewFilter = (typeof REVIEW_FILTERS)[number];

export const REVIEW_FILTER_LABEL: Record<ReviewFilter, string> = {
  all: "All",
  pending: "Awaiting approval",
  approved: "Published",
  featured: "Pinned",
};

export function isReviewFilter(v: string): v is ReviewFilter {
  return (REVIEW_FILTERS as readonly string[]).includes(v);
}

/** One product's public rating, or null when it has no approved reviews. */
export type ReviewSummary = { average: number; count: number };

export type PublicReview = {
  id: string;
  name: string;
  rating: number;
  title: string | null;
  body: string;
  verified: boolean;
  featured: boolean;
  createdAt: string;
};

/** Round to one decimal the way the UI prints it (4.66 → 4.7). */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Approved-review summaries for a batch of products, keyed by productId.
 * Products with no approved reviews are simply absent from the map — callers
 * must treat "missing" as "no rating yet", not as zero stars.
 *
 * One grouped query for the whole page rather than a query per card.
 */
export async function getReviewSummaries(
  productIds: string[]
): Promise<Map<string, ReviewSummary>> {
  const map = new Map<string, ReviewSummary>();
  if (productIds.length === 0) return map;
  try {
    const grouped = await prisma.review.groupBy({
      by: ["productId"],
      where: { approved: true, productId: { in: productIds } },
      _avg: { rating: true },
      _count: { _all: true },
    });
    for (const g of grouped) {
      const avg = g._avg.rating;
      if (avg == null || g._count._all === 0) continue;
      map.set(g.productId, { average: round1(avg), count: g._count._all });
    }
  } catch (err) {
    // A reviews outage must not take the shop down — cards just lose their stars.
    console.error("[reviews] getReviewSummaries failed:", err);
  }
  return map;
}

/** Summary for a single product (null when it has no approved reviews). */
export async function getReviewSummary(
  productId: string
): Promise<ReviewSummary | null> {
  const map = await getReviewSummaries([productId]);
  return map.get(productId) ?? null;
}

/**
 * Approved reviews for a product page: pinned ones first, then newest. The star
 * distribution is computed here too so the panel can show the 5→1 breakdown
 * without a second pass.
 */
export async function getProductReviews(
  productId: string,
  limit = 20
): Promise<{
  summary: ReviewSummary | null;
  items: PublicReview[];
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
}> {
  const empty = {
    summary: null,
    items: [] as PublicReview[],
    distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<1 | 2 | 3 | 4 | 5, number>,
  };
  try {
    const rows = await prisma.review.findMany({
      where: { productId, approved: true },
      orderBy: [{ featured: "desc" }, { createdAt: "desc" }],
      take: limit,
      select: {
        id: true,
        name: true,
        rating: true,
        title: true,
        body: true,
        verified: true,
        featured: true,
        createdAt: true,
      },
    });
    if (rows.length === 0) return empty;

    const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<1 | 2 | 3 | 4 | 5, number>;
    let total = 0;
    for (const r of rows) {
      const star = Math.min(5, Math.max(1, r.rating)) as 1 | 2 | 3 | 4 | 5;
      distribution[star] += 1;
      total += r.rating;
    }

    return {
      // Averaged over the rows fetched. `limit` caps the list, so for a product
      // with more reviews than that the panel's average is of the page shown —
      // the headline figure everywhere else comes from getReviewSummary().
      summary: { average: round1(total / rows.length), count: rows.length },
      items: rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
      })),
      distribution,
    };
  } catch (err) {
    console.error("[reviews] getProductReviews failed:", err);
    return empty;
  }
}

/**
 * Has this person actually bought the product? Drives the "Verified buyer"
 * badge, so it is decided server-side from delivered orders and never from
 * anything the reviewer submits.
 *
 * Matches on the account when signed in, else on the email used at checkout.
 */
export async function hasPurchased(
  productId: string,
  who: { userId?: string | null; email?: string | null }
): Promise<boolean> {
  if (!who.userId && !who.email) return false;
  try {
    const orders = await prisma.order.findMany({
      where: {
        status: "delivered",
        ...(who.userId
          ? { userId: who.userId }
          : { email: { equals: who.email!, mode: "insensitive" } }),
      },
      select: { items: true },
      take: 100,
    });
    return orders.some((o) => {
      const items = Array.isArray(o.items) ? (o.items as { productId?: string }[]) : [];
      return items.some((i) => i?.productId === productId);
    });
  } catch {
    return false;
  }
}
