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
import { allCombinations, comboKey } from "./options";
import { stockStateOf, type StockLevel, type StockState } from "./inventory-types";

/* ------------------------------------------------------------------ */
/*  Live stock — what a tracked product can actually sell, per size    */
/* ------------------------------------------------------------------ */

/**
 * `SiteSettings.lowStockThreshold` — the line a size without its own
 * `lowStockAt` reads as low at. Once per request (`cache()`), and only asked
 * for when a tracked size actually needs it, so a page of untracked products
 * costs no extra round trip. 5 is the schema default.
 */
export const getLowStockThreshold = cache(async (): Promise<number> => {
  const row = await prisma.siteSettings.findUnique({
    where: { id: "main" },
    select: { lowStockThreshold: true },
  });
  return row?.lowStockThreshold ?? 5;
});

/**
 * **The one definition of a size's stock state**, for every screen outside
 * Admin → Inventory: `stockStateOf()` against the size's own `lowStockAt`,
 * else the store's `lowStockThreshold`. The storefront's "Only N left", the
 * admin products filter and the dashboard all come through here, so they
 * cannot disagree about which sizes are low.
 */
export function unitStockState(
  row: StockLevel & { lowStockAt: number | null },
  storeLine: number
): StockState {
  return stockStateOf(row, row.lowStockAt ?? storeLine);
}

/** The `ProductVariant` columns a stock reading needs. */
export type UnitStockRow = StockLevel & { comboKey: string; lowStockAt: number | null };

/**
 * One product's stock state, for a screen with one row per product (the admin
 * products table and its filter). Built on `unitStockState`, so a size that
 * reads low here is the size that says "Only N left" on the storefront.
 *
 * - **oversold** — a tracked size has promised more than it holds. It wins
 *   over everything: it is the one state with customers' orders at stake.
 * - **out** — nobody can buy it: `Product.stock ≤ 0`. For a tracked product
 *   that is the engine's mirror, Σ of every active size's positive
 *   `available`, so it means exactly "every size is sold out" — the
 *   storefront's rule, the dashboard's count and the finance tile's.
 * - **low** — still buyable, but some size is at or under its line. A sold-out
 *   size counts: a tee with no M left is running low, not fine.
 *   Untracked: its one number at or under the store's line.
 * - **ok**
 *
 * `rows` are the product's active variant rows; ignored while untracked, when
 * their counters mean nothing yet.
 */
export function productStockState(
  p: { trackInventory: boolean; stock: number },
  rows: (StockLevel & { lowStockAt: number | null })[],
  storeLine: number
): StockState {
  if (!p.trackInventory) {
    // The legacy counter has no reservations, so it cannot be "oversold" in
    // the ledger's sense; at or below zero it is simply out.
    return stockStateOf({ onHand: p.stock, reserved: 0, available: Math.max(0, p.stock) }, storeLine);
  }
  if (rows.some((r) => r.available < 0)) return "oversold";
  if (p.stock <= 0) return "out";
  return rows.some((r) => unitStockState(r, storeLine) !== "ok") ? "low" : "ok";
}

/**
 * The live variant rows of the **tracked** products on one page, in one
 * `WHERE productId IN (…)` — a grid of forty cards is one statement, never
 * forty.
 *
 * A separate read rather than an `include` on the product query, and that is
 * measured, not taste: Prisma runs an include's relation reads one after
 * another, so a `variantRows` include put a whole extra round trip on every
 * shop load (216 → 353 ms median from a dev machine) even while no product
 * is tracked — which is every product today. Asked only when the page holds a
 * tracked product, an untracked page makes exactly the queries it made before
 * inventory existed.
 *
 * Active rows only: a retired size is not for sale, and a size with no row
 * reads as sold out — `reserveForOrder` refuses a tracked line with no row, so
 * offering it would sell something checkout then turns down.
 */
async function loadLiveStockRows(productIds: string[]): Promise<Map<string, UnitStockRow[]>> {
  const rows = await prisma.productVariant.findMany({
    where: { productId: { in: productIds }, isActive: true },
    select: {
      productId: true,
      comboKey: true,
      onHand: true,
      reserved: true,
      available: true,
      lowStockAt: true,
    },
  });
  const byProduct = new Map<string, UnitStockRow[]>();
  for (const { productId, ...row } of rows) {
    const list = byProduct.get(productId);
    if (list) list.push(row);
    else byProduct.set(productId, [row]);
  }
  return byProduct;
}

/** What a shopper may know about one unit of a tracked product. */
export type ShopperStock = {
  /** `ProductVariant.available`, floored at 0 — a shopper has no use for "−2". */
  available: number;
  /**
   * `unitStockState()`, with `oversold` folded into `out`: to a shopper an
   * oversold size is simply sold out, and "we promised more than we hold" is
   * the owner's business, not the product page's.
   */
  state: "out" | "low" | "ok";
};

/** A ProductDTO as the storefront loaders return it. */
export type StorefrontProduct = ProductDTO & {
  /**
   * Present **only** for a tracked product: one entry per combination, keyed
   * by `comboKey` (`""` for a product without options).
   *
   * Absent means the product sells from its single `stock` number exactly as
   * it did before inventory existed — nothing in this file touches it.
   */
  liveStock?: Record<string, ShopperStock>;
};

type StorefrontRow = Product & {
  productImages?: {
    slot: string;
    variantValue: string | null;
    sortOrder: number;
    media: any;
  }[];
};

/**
 * Put a tracked product's **live** per-size stock onto the read model the
 * storefront already consumes, so the existing picker logic does the rest:
 *
 * - `sellableVariants` gets one entry per combination. Its `stock` becomes the
 *   size's live `available`, and `available` becomes *offered and in stock* —
 *   so `isChoiceEnabled` strikes a sold-out size through and
 *   `firstAvailableSelection` lands the page on one that can be bought. The
 *   stored entries are a snapshot from the last save; stock moves on every
 *   order, so the rows win.
 * - A combination with no stored entry inherits exactly what checkout charges
 *   for it (`sellable.price ?? product.price`), so the overlay can never
 *   change a price.
 * - `stock` becomes the sum over sizes that are offered **and** in stock, so a
 *   product reads sold out only when every size is.
 *
 * `Product.stock` (the engine's mirror) is not used for this: it sums every
 * active row, including a size the admin has switched off, and it is one
 * number where the page needs one per size.
 */
function overlayLiveStock(dto: ProductDTO, rows: UnitStockRow[], storeLine: number): StorefrontProduct {
  const byKey = new Map(rows.map((r) => [r.comboKey, r]));
  const liveStock: Record<string, ShopperStock> = {};
  const unit = (key: string): ShopperStock => {
    const r = byKey.get(key);
    const u: ShopperStock = r
      ? { available: Math.max(0, r.available), state: toShopper(unitStockState(r, storeLine)) }
      : { available: 0, state: "out" };
    liveStock[key] = u;
    return u;
  };

  const combos = allCombinations(dto.attributes ?? []);
  if (combos.length === 0) {
    // No options: one unit, keyed "" — the same key an order line with no
    // options resolves to in `reserveForOrder`.
    return { ...dto, stock: unit("").available, liveStock };
  }

  const stored = new Map((dto.sellableVariants ?? []).map((v) => [v.id, v]));
  let sellableTotal = 0;
  const sellableVariants: SellableVariant[] = combos.map((combo) => {
    const id = comboKey(combo);
    const base = stored.get(id);
    const u = unit(id);
    // The admin's own "not offered" switch still wins over stock on hand.
    const available = (base ? base.available !== false : true) && u.available > 0;
    if (available) sellableTotal += u.available;
    return {
      ...base,
      id,
      combo: base?.combo ?? combo,
      price: base?.price ?? dto.price,
      images: base?.images ?? [],
      weight: base?.weight ?? 0,
      stock: u.available,
      available,
    };
  });

  return { ...dto, sellableVariants, stock: sellableTotal, liveStock };
}

function toShopper(state: StockState): ShopperStock["state"] {
  return state === "oversold" ? "out" : state;
}

/**
 * Rows → storefront DTOs, with live stock laid over the tracked ones. **Every
 * storefront list and detail loader goes through this**, here and in
 * `catalog.ts` — a loader that went back to `.map(toDTO)` would sell a
 * tracked product's sold-out sizes.
 *
 * With no tracked product among `rows` it is exactly `rows.map(toDTO)`: no
 * query, nothing changed — every page today. Otherwise one batched read of the
 * tracked products' sizes, alongside the store's low-stock line (cached per
 * request), in parallel.
 */
export async function toStorefrontDTOs(rows: StorefrontRow[]): Promise<StorefrontProduct[]> {
  const trackedIds = rows.filter((r) => r.trackInventory).map((r) => r.id);
  if (trackedIds.length === 0) return rows.map((r) => toDTO(r));

  const [stockRows, storeLine] = await Promise.all([
    loadLiveStockRows(trackedIds),
    getLowStockThreshold(),
  ]);
  return rows.map((r) => {
    const dto = toDTO(r);
    return r.trackInventory ? overlayLiveStock(dto, stockRows.get(r.id) ?? [], storeLine) : dto;
  });
}

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

  // Drop the raw Prisma relations before spreading `p` — otherwise its
  // un-typed `media.url` values ride along on the DTO (ProductDTO has no
  // `productImages` field, so nothing reads them) and get serialized into the
  // RSC payload anyway once the product is passed to a client component.
  // `costPrice` is what a unit cost the store. The schema says it is never
  // shown to a customer, and a spread is how it would be: every product page
  // hands this object to a client component, and every field on it lands in
  // the page source. It is null everywhere today, which is exactly when a leak
  // like this goes unnoticed until the first real number is typed in.
  const { productImages: _rawProductImages, costPrice: _costPrice, ...rest } = p;

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

    const products = await toStorefrontDTOs(
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
    );

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

/**
 * Compact catalogue for the live search dropdown (typo-tolerant).
 *
 * Plain `toDTO`, no live stock: its one caller (`/api/search`) returns name,
 * price and a photo, never stock. Anything that starts showing stock from here
 * must go through `toStorefrontDTOs` like every other loader.
 */
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
      return await toStorefrontDTOs(
        await prisma.product.findMany({
          where: { isActive: true },
          orderBy: { createdAt: "desc" },
          take: limit,
          ...GALLERY_INCLUDE,
        })
      );
    }
    return await toStorefrontDTOs(products);
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
): Promise<StorefrontProduct | null> {
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
  const [dto] = await toStorefrontDTOs([product]);
  return dto;
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
    const products = await toStorefrontDTOs(
      await prisma.product.findMany({
        where: { slug: { in: slugs }, isActive: true },
        ...GALLERY_INCLUDE,
      })
    );
    const bySlug = new Map(products.map((p) => [p.slug, p]));
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
    if (siblings.length >= limit) return await toStorefrontDTOs(siblings.slice(0, limit));

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
    return await toStorefrontDTOs([...siblings, ...rest]);
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
