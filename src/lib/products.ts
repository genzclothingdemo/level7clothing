import { prisma } from "./prisma";
import type { Prisma, Product } from "@prisma/client";
import type {
  ProductDTO,
  ProductOption,
  VariantPrice,
  Variant,
  PaymentMode,
} from "./types";
import { searchProducts } from "./search";

/** Normalise a Prisma product row into a ProductDTO (coerces the JSON columns). */
function toDTO(p: Product): ProductDTO {
  return {
    ...p,
    options: Array.isArray(p.options)
      ? (p.options as unknown as ProductOption[])
      : [],
    variantPrices: Array.isArray(p.variantPrices)
      ? (p.variantPrices as unknown as VariantPrice[])
      : [],
    variants: Array.isArray(p.variants)
      ? (p.variants as unknown as Variant[])
      : [],
    paymentModes: (Array.isArray(p.paymentModes)
      ? p.paymentModes
      : ["prepaid", "cod"]) as PaymentMode[],
  };
}

export type ShopQuery = {
  category?: string;
  q?: string;
  sort?: "newest" | "price-asc" | "price-desc" | "featured";
};

function orderBy(
  sort?: ShopQuery["sort"]
): Prisma.ProductOrderByWithRelationInput {
  switch (sort) {
    case "price-asc":
      return { price: "asc" };
    case "price-desc":
      return { price: "desc" };
    case "featured":
      return { isFeatured: "desc" };
    default:
      return { createdAt: "desc" };
  }
}

export async function getProducts(query: ShopQuery = {}): Promise<ProductDTO[]> {
  try {
    const and: Prisma.ProductWhereInput[] = [{ isActive: true }];
    // A category page shows pieces whose primary OR secondary category matches.
    if (query.category && query.category !== "All") {
      and.push({
        OR: [
          { category: query.category },
          { secondaryCategory: query.category },
        ],
      });
    }

    const products = (
      await prisma.product.findMany({
        where: { AND: and },
        orderBy: orderBy(query.sort),
      })
    ).map(toDTO);

    // Typo-tolerant fuzzy search (keeps the chosen sort when there's no query).
    if (query.q && query.q.trim()) {
      return searchProducts(products, query.q);
    }
    return products;
  } catch (err) {
    console.error("[products] getProducts failed:", err);
    return [];
  }
}

/** Compact catalogue for the live search dropdown (typo-tolerant). */
export async function searchCatalogue(
  q: string,
  limit = 6
): Promise<ProductDTO[]> {
  try {
    const products = (
      await prisma.product.findMany({
        where: { isActive: true },
        orderBy: { isFeatured: "desc" },
      })
    ).map(toDTO);
    return searchProducts(products, q, limit);
  } catch (err) {
    console.error("[products] searchCatalogue failed:", err);
    return [];
  }
}

export async function getFeatured(limit = 4): Promise<ProductDTO[]> {
  try {
    const products = await prisma.product.findMany({
      where: { isActive: true, isFeatured: true },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    if (products.length === 0) {
      return (
        await prisma.product.findMany({
          where: { isActive: true },
          orderBy: { createdAt: "desc" },
          take: limit,
        })
      ).map(toDTO);
    }
    return products.map(toDTO);
  } catch (err) {
    console.error("[products] getFeatured failed:", err);
    return [];
  }
}

/**
 * Look up a single product.
 *
 * Deliberately does NOT swallow database errors: callers turn `null` into a
 * 404, so returning null on a transient connection failure would tell search
 * engines a live product had been deleted. A thrown error surfaces as a 500
 * instead, which is both accurate and retried rather than deindexed.
 */
export async function getProductBySlug(
  slug: string
): Promise<ProductDTO | null> {
  const product = await prisma.product.findUnique({ where: { slug } });
  return product ? toDTO(product) : null;
}

/** Fetch active products for a set of slugs, preserving the given slug order. */
export async function getProductsBySlugs(
  slugs: string[]
): Promise<ProductDTO[]> {
  if (slugs.length === 0) return [];
  try {
    const products = await prisma.product.findMany({
      where: { slug: { in: slugs }, isActive: true },
    });
    const bySlug = new Map(products.map((p) => [p.slug, toDTO(p)]));
    return slugs
      .map((s) => bySlug.get(s))
      .filter((p): p is ProductDTO => Boolean(p));
  } catch (err) {
    console.error("[products] getProductsBySlugs failed:", err);
    return [];
  }
}

export async function getRelated(
  category: string,
  excludeId: string,
  limit = 4,
  secondaryCategory?: string | null
): Promise<ProductDTO[]> {
  try {
    const cats = [category, secondaryCategory].filter(Boolean) as string[];
    const products = await prisma.product.findMany({
      where: {
        isActive: true,
        id: { not: excludeId },
        OR: [
          { category: { in: cats } },
          { secondaryCategory: { in: cats } },
        ],
      },
      take: limit,
      orderBy: { createdAt: "desc" },
    });
    return products.map(toDTO);
  } catch {
    return [];
  }
}

export async function getCategoryCounts(): Promise<
  { category: string; count: number }[]
> {
  try {
    // Count a product under BOTH its primary and secondary category.
    const products = await prisma.product.findMany({
      where: { isActive: true },
      select: { category: true, secondaryCategory: true },
    });
    const tally = new Map<string, number>();
    for (const p of products) {
      tally.set(p.category, (tally.get(p.category) ?? 0) + 1);
      if (p.secondaryCategory) {
        tally.set(
          p.secondaryCategory,
          (tally.get(p.secondaryCategory) ?? 0) + 1
        );
      }
    }
    return [...tally.entries()].map(([category, count]) => ({
      category,
      count,
    }));
  } catch {
    return [];
  }
}
