import { prisma } from "./prisma";
import type { ProductDTO, MediaDTO } from "./types";
import { toDTO } from "./products";
import { variantPreviewImages } from "./variants";

/**
 * The browsing hierarchy: Category → Subcategory → Product.
 *
 * "T-Shirts" (category) shows "Oversized Tees" (subcategory) as if
 * it were a product — name, photo, price range — and clicking it lists the
 * actual tees. The rule the owner asked for: a group holding more than one
 * piece is shown as a group; a group holding exactly one piece IS that piece,
 * so single items never cost the shopper an extra click.
 */

export type SubcategoryTile = {
  kind: "subcategory";
  id: string;
  name: string;
  slug: string;
  /** Needed to build the link, since Shop-all mixes several categories. */
  categoryName: string;
  /** Own cover photos, or borrowed from the products inside. */
  images: string[];
  priceMin: number;
  priceMax: number;
  productCount: number;
  media?: MediaDTO[];
};

export type ProductTile = { kind: "product"; product: ProductDTO };
export type CategoryTile = SubcategoryTile | ProductTile;

/**
 * Cheapest and dearest a product can actually be bought for. Variants each
 * carry their own price, so a piece offered from ₹500 to ₹2,000 reports both
 * ends rather than just its base price.
 */
export function productPriceRange(p: ProductDTO): { min: number; max: number } {
  const prices = [p.price];
  for (const v of p.variants) {
    if (v.available && Number.isFinite(v.price)) prices.push(v.price);
  }
  return { min: Math.min(...prices), max: Math.max(...prices) };
}

/** Range across a set of products, ignoring any manual override. */
export function computedRange(products: ProductDTO[]) {
  if (products.length === 0) return { min: 0, max: 0 };
  const ranges = products.map(productPriceRange);
  return {
    min: Math.min(...ranges.map((r) => r.min)),
    max: Math.max(...ranges.map((r) => r.max)),
  };
}

type SubcategoryRow = {
  id: string;
  name: string;
  slug: string;
  images: string[];
  priceMin: number | null;
  priceMax: number | null;
  category: { name: string };
};

/** The columns every tile builder needs from a subcategory row. */
const SUBCATEGORY_SELECT = {
  id: true,
  name: true,
  slug: true,
  images: true,
  priceMin: true,
  priceMax: true,
  category: { select: { name: true } },
} as const;

/**
 * Cover photos for a group. Its own pick wins; otherwise ONE photo per product
 * inside stands in — four tees in "Oversized Tees" give four covers — so a photo
 * already attached to a product never has to be re-picked for the group.
 *
 * Borrowing takes each product's leading variant preview rather than
 * `p.images[0]`: the flat list is the union of every gallery, so its first entry
 * could be a packaging shot, and a product whose photos are all relational (an
 * empty `images` column) contributed nothing at all.
 */
const MAX_COVERS = 6;

function coverImages(
  sub: { images: string[] },
  products: ProductDTO[]
): string[] {
  const own = sub.images.filter(Boolean);
  if (own.length > 0) return own.slice(0, MAX_COVERS);
  const borrowed: string[] = [];
  for (const p of products) {
    const [preview] = variantPreviewImages(p, 1);
    if (preview && !borrowed.includes(preview)) borrowed.push(preview);
    if (borrowed.length === MAX_COVERS) break;
  }
  return borrowed;
}

function toTile(sub: SubcategoryRow, products: ProductDTO[]): SubcategoryTile {
  const auto = computedRange(products);
  return {
    kind: "subcategory",
    id: sub.id,
    name: sub.name,
    slug: sub.slug,
    categoryName: sub.category.name,
    images: coverImages(sub, products),
    // A manual override on either end wins; the other end still comes from the
    // live products, so a half-filled override can't produce a broken range.
    priceMin: sub.priceMin ?? auto.min,
    priceMax: sub.priceMax ?? auto.max,
    productCount: products.length,
  };
}

/**
 * Fold a flat product list into what a shopper should actually see: one tile
 * per group, one tile per ungrouped piece.
 *
 * `sort` only reorders the loose products — groups always lead, in their
 * configured order, so the shelf structure stays stable as stock changes.
 */
function buildTiles(
  products: ProductDTO[],
  subs: SubcategoryRow[],
  sort?: "newest" | "price-asc" | "price-desc" | "featured"
): CategoryTile[] {
  const tiles: CategoryTile[] = [];
  const grouped = new Set<string>();

  for (const sub of subs) {
    const inside = products.filter((p) => p.subcategoryId === sub.id);
    if (inside.length === 0) continue; // nothing to sell yet — hide it
    for (const p of inside) grouped.add(p.id);
    if (inside.length === 1) {
      // Exactly one piece: it IS the product, not a group.
      tiles.push({ kind: "product", product: inside[0] });
    } else {
      tiles.push(toTile(sub, inside));
    }
  }

  const loose = products.filter((p) => !grouped.has(p.id));
  sortProducts(loose, sort);
  for (const p of loose) tiles.push({ kind: "product", product: p });

  return tiles;
}

/** What to render on a category page: group tiles plus one-off products. */
export async function getCategoryTiles(
  categoryName: string,
  sort?: "newest" | "price-asc" | "price-desc" | "featured"
): Promise<CategoryTile[]> {
  try {
    const category = await prisma.category.findFirst({
      where: { name: categoryName },
      select: { id: true },
    });

    // A category page shows pieces whose primary OR secondary category matches.
    const products = (
      await prisma.product.findMany({
        where: {
          isActive: true,
          OR: [
            { category: categoryName },
            { secondaryCategory: categoryName },
          ],
        },
        orderBy: { createdAt: "desc" },
        include: { productImages: { include: { media: true } } },
      })
    ).map(toDTO);

    const subs: SubcategoryRow[] = category
      ? await prisma.subcategory.findMany({
          where: { categoryId: category.id, isActive: true },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          select: SUBCATEGORY_SELECT,
        })
      : [];

    // Anything not inside one of THIS category's groups sits on the page
    // directly — including a piece that only appears here as a secondary
    // category while its group lives elsewhere.
    return buildTiles(products, subs, sort);
  } catch (err) {
    console.error("[catalog] getCategoryTiles failed:", err);
    return [];
  }
}

/**
 * Shop-all, folded the same way. Five tees that belong to one group show up
 * as the single "Oversized Tees" tile here too — browsing the whole store
 * should not mean scrolling past twenty near-identical listings.
 */
export async function getShopTiles(
  sort?: "newest" | "price-asc" | "price-desc" | "featured"
): Promise<CategoryTile[]> {
  try {
    const [products, subs] = await Promise.all([
      prisma.product
        .findMany({
          where: { isActive: true },
          orderBy: { createdAt: "desc" },
          // Cards derive their swipe gallery from the relational rows, so the
          // list queries must load them — without this a card silently degrades
          // to a single photo.
          include: { productImages: { include: { media: true } } },
        })
        .then((rows) => rows.map(toDTO)),
      prisma.subcategory.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: SUBCATEGORY_SELECT,
      }),
    ]);
    return buildTiles(products, subs, sort);
  } catch (err) {
    console.error("[catalog] getShopTiles failed:", err);
    return [];
  }
}

function sortProducts(products: ProductDTO[], sort?: string) {
  switch (sort) {
    case "price-asc":
      products.sort((a, b) => a.price - b.price);
      break;
    case "price-desc":
      products.sort((a, b) => b.price - a.price);
      break;
    case "featured":
      products.sort((a, b) => Number(b.isFeatured) - Number(a.isFeatured));
      break;
    // "newest" is the order they arrive in from the query.
  }
}

export type SubcategoryView = {
  id: string;
  name: string;
  slug: string;
  categoryName: string;
  images: string[];
  priceMin: number;
  priceMax: number;
  products: ProductDTO[];
};

/** One group and the real pieces inside it, for the drill-down page. */
export async function getSubcategoryView(
  categoryName: string,
  subSlug: string,
  sort?: "newest" | "price-asc" | "price-desc" | "featured"
): Promise<SubcategoryView | null> {
  try {
    const sub = await prisma.subcategory.findFirst({
      where: { slug: subSlug, isActive: true, category: { name: categoryName } },
      select: SUBCATEGORY_SELECT,
    });
    if (!sub) return null;

    const products = (
      await prisma.product.findMany({
        where: { isActive: true, subcategoryId: sub.id },
        orderBy: { createdAt: "desc" },
        include: { productImages: { include: { media: true } } },
      })
    ).map(toDTO);
    sortProducts(products, sort);

    const tile = toTile(sub, products);
    return {
      id: sub.id,
      name: sub.name,
      slug: sub.slug,
      categoryName: sub.category.name,
      images: tile.images,
      priceMin: tile.priceMin,
      priceMax: tile.priceMax,
      products,
    };
  } catch (err) {
    console.error("[catalog] getSubcategoryView failed:", err);
    return null;
  }
}

/**
 * The group a product sits in, for its breadcrumb — so someone looking at one
 * tee can get back to the other nineteen in a click.
 */
export async function getProductCrumb(subcategoryId: string | null) {
  if (!subcategoryId) return null;
  try {
    const sub = await prisma.subcategory.findUnique({
      where: { id: subcategoryId },
      select: {
        name: true,
        slug: true,
        isActive: true,
        category: { select: { name: true } },
        _count: { select: { products: { where: { isActive: true } } } },
      },
    });
    // A group of one collapses on the storefront — linking to it would send
    // the shopper to a page holding only the product they are already on.
    if (!sub || !sub.isActive || sub._count.products < 2) return null;
    return {
      name: sub.name,
      slug: sub.slug,
      categoryName: sub.category.name,
      href: `/shop?category=${encodeURIComponent(sub.category.name)}&sub=${
        sub.slug
      }`,
    };
  } catch {
    return null;
  }
}

/** Admin: every group in a category, with a live count and price range. */
export async function getSubcategoriesForAdmin(categoryId: string) {
  const subs = await prisma.subcategory.findMany({
    where: { categoryId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  const products = (
    await prisma.product.findMany({
      where: { subcategoryId: { in: subs.map((s) => s.id) } },
      include: { productImages: { include: { media: true } } },
    })
  ).map(toDTO);

  return subs.map((sub) => {
    const inside = products.filter((p) => p.subcategoryId === sub.id);
    const auto = computedRange(inside);
    return {
      ...sub,
      productCount: inside.length,
      autoPriceMin: auto.min,
      autoPriceMax: auto.max,
      coverImages: coverImages(sub, inside),
    };
  });
}
