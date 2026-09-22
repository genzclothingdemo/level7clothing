import { cache } from "react";
import { prisma } from "./prisma";
import type { Prisma, Product } from "@prisma/client";
import type {
  ProductDTO,
  ProductOption,
  VariantPrice,
  Variant,
  PaymentMode,
  Attribute,
  SellableVariant,
  ProductVideo,
} from "./types";
import { deriveVariantModel } from "./variants";
import { searchProducts } from "./search";

/** Normalise a Prisma product row into a ProductDTO (coerces the JSON columns). */
export function toDTO(
  p: Product & {
    productImages?: {
      slot: string;
      variantValue: string | null;
      sortOrder: number;
      media: any;
    }[];
  }
): ProductDTO {
  const storedAttributes = Array.isArray(p.attributes)
    ? (p.attributes as unknown as Attribute[])
    : [];
  const storedSellable = Array.isArray(p.sellableVariants)
    ? (p.sellableVariants as unknown as SellableVariant[])
    : [];
  // Products saved before the admin model was bridged to the storefront read model
  // have empty attributes/sellableVariants. Derive them on read from options/variants
  // so every existing product works without needing a re-save.
  const derived =
    storedAttributes.length === 0
      ? deriveVariantModel({
          options: p.options,
          variants: p.variants,
          price: p.price,
          stock: p.stock,
        })
      : null;

  const storedSellableRemapped = storedSellable;

  // Drop the raw Prisma relation before spreading `p` — otherwise its
  // un-typed `media.url` values ride along on the DTO (ProductDTO has no
  // `productImages` field, so nothing reads them) and get serialized into the
  // RSC payload anyway once the product is passed to a client component.
  const { productImages: _rawProductImages, ...rest } = p;

  return {
    ...rest,
    images: p.images,
    media: p.productImages?.map((pi) => ({
      id: pi.media.id,
      url: pi.media.url,
      alt: pi.media.alt,
      width: pi.media.width,
      height: pi.media.height,
      // Relational gallery metadata — the storefront's source of truth for
      // ordering (sortOrder) and per-variant scoping (variantValue).
      slot: pi.slot,
      variantValue: pi.variantValue,
      sortOrder: pi.sortOrder,
    })),
    options: Array.isArray(p.options)
      ? (p.options as unknown as ProductOption[])
      : [],
    variantPrices: Array.isArray(p.variantPrices)
      ? (p.variantPrices as unknown as VariantPrice[])
      : [],
    variants: Array.isArray(p.variants)
      ? (p.variants as unknown as Variant[])
      : [],
    videos: Array.isArray(p.videos) ? (p.videos as unknown as ProductVideo[]) : [],
    paymentModes: (Array.isArray(p.paymentModes)
      ? p.paymentModes
      : ["prepaid", "cod"]) as PaymentMode[],
    // New rule engine fields — stored as JSON, cast to proper types
    attributes: derived ? derived.attributes : storedAttributes,
    propertyModules: (p.propertyModules as any) ?? {},
    rules: (p.rules as any) ?? {},
    sellableVariants: derived ? derived.sellableVariants : storedSellableRemapped,
  };
}

/**
 * The relational gallery every list/detail query needs. ProductCard and the
 * subcategory tiles read `product.media` (one preview per design); a query that
 * forgets this include degrades those cards to one photo with no error.
 */
const GALLERY_INCLUDE = {
  include: { productImages: { include: { media: true }, orderBy: { sortOrder: "asc" } } },
} as const;

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
        include: {
          productImages: {
            include: { media: true },
            orderBy: { sortOrder: "asc" },
          },
        },
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
        include: {
          productImages: {
            include: { media: true },
            orderBy: { sortOrder: "asc" },
          },
        },
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
    // GALLERY_INCLUDE on every list query: ProductCard builds its swipe gallery
    // from the relational rows (one preview per design), so omitting it makes the
    // card fall back to a single cover photo.
    const products = await prisma.product.findMany({
      where: { isActive: true, isFeatured: true },
      orderBy: { createdAt: "desc" },
      take: limit,
      ...GALLERY_INCLUDE,
    });
    if (products.length === 0) {
      return (
        await prisma.product.findMany({
          where: { isActive: true },
          orderBy: { createdAt: "desc" },
          take: limit,
          ...GALLERY_INCLUDE,
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
 * One live product by slug, or `null` when there genuinely isn't one.
 *
 * **It does not catch database errors, and must not start.** Callers turn
 * `null` into `notFound()`, so swallowing a connection blip told Google a live
 * product had been deleted. Letting it throw gives a 500, which crawlers
 * retry. A try/catch here came back in with the upstream V2 port (851c099) —
 * CLAUDE.md names this, and `promotions.ts` and `getProductsBySlugs` both
 * carry comments that say "unlike getProductBySlug, this DOES swallow errors",
 * so the surrounding code was relying on a rule the function had stopped
 * keeping.
 *
 * `cache()` is per-request dedup, not a cross-request cache: the product page
 * asks for the same row twice — once in `generateMetadata`, once in the body —
 * and without this that is two round trips to Mumbai for one page view.
 */
export const getProductBySlug = cache(async function getProductBySlug(
  slug: string
): Promise<ProductDTO | null> {
  const product = await prisma.product.findUnique({
    where: { slug },
    include: {
      productImages: {
        include: { media: true },
        orderBy: { sortOrder: "asc" },
      },
    },
  });
  if (!product || !product.isActive) return null;
  return toDTO(product);
});

/**
 * Look up several products by slug at once, returning them in the order the
 * slugs were given. Backs the wishlist and the recommendations endpoint, both
 * of which store slugs in localStorage rather than ids.
 *
 * Unlike getProductBySlug this DOES swallow errors: a failed lookup here means
 * an empty wishlist rail, not a page that should 500.
 */
export async function getProductsBySlugs(
  slugs: string[]
): Promise<ProductDTO[]> {
  if (slugs.length === 0) return [];
  try {
    const products = await prisma.product.findMany({
      where: { slug: { in: slugs }, isActive: true },
      ...GALLERY_INCLUDE,
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
  secondaryCategory?: string | null,
  subcategoryId?: string | null
): Promise<ProductDTO[]> {
  try {
    const cats = [category, secondaryCategory].filter(Boolean) as string[];

    // Siblings in the same group come first — the closest match to what the
    // shopper is looking at is another design of the same thing.
    const siblings = subcategoryId
      ? await prisma.product.findMany({
          where: { isActive: true, id: { not: excludeId }, subcategoryId },
          take: limit,
          orderBy: { createdAt: "desc" },
          ...GALLERY_INCLUDE,
        })
      : [];
    if (siblings.length >= limit) return siblings.slice(0, limit).map(toDTO);

    const seen = new Set([excludeId, ...siblings.map((p) => p.id)]);
    const rest = await prisma.product.findMany({
      where: {
        isActive: true,
        id: { notIn: [...seen] },
        OR: [{ category: { in: cats } }, { secondaryCategory: { in: cats } }],
      },
      take: limit - siblings.length,
      orderBy: { createdAt: "desc" },
      ...GALLERY_INCLUDE,
    });
    return [...siblings, ...rest].map(toDTO);
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
