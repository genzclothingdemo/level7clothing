import Link from "next/link";
import { Plus, Package, Download } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fuzzyFilter } from "@/lib/search";
import {
  getLowStockThreshold,
  productStockState,
  unitStockState,
} from "@/lib/products";
import type { StockState } from "@/lib/inventory-types";
import { axisOrderOf, variantLabel } from "@/components/admin/inventory-ui";
import { ProductsTable } from "@/components/admin/products-table";
import { ProductFilters } from "@/components/admin/product-filters";

export const dynamic = "force-dynamic";
export const metadata = { title: "Products" };

type SP = {
  q?: string;
  category?: string;
  /** A subcategory id, or "__none" for pieces not in any group. */
  subcategoryId?: string;
  status?: string;
  stock?: string;
  sort?: string;
};

function buildWhere(sp: SP): Prisma.ProductWhereInput {
  const conditions: Prisma.ProductWhereInput[] = [];

  // NOTE: `sp.q` is deliberately NOT part of the SQL WHERE. `contains` is a
  // substring test, so "hoodei" matched nothing and neither did "tshirt"
  // against "T-Shirt". The text query is applied afterwards with the same
  // typo-tolerant ranking the storefront uses (see fuzzyFilter below), while
  // every other facet stays in the database where it belongs.

  if (sp.category) {
    conditions.push({
      OR: [
        { category: sp.category },
        { secondaryCategory: sp.category },
      ],
    });
  }

  if (sp.subcategoryId) {
    conditions.push(
      sp.subcategoryId === "__none"
        ? { subcategoryId: null }
        : { subcategoryId: sp.subcategoryId }
    );
  }

  if (sp.status) {
    conditions.push({ isActive: sp.status === "active" });
  }

  // `sp.stock` is not here either — see `STOCK_FACETS` below.

  if (conditions.length === 0) return {};
  if (conditions.length === 1) return conditions[0];
  return { AND: conditions };
}

/**
 * The stock facet, applied after the query like the text search.
 *
 * It used to be SQL on `Product.stock` with a hardcoded `lte: 5`, which stopped
 * being the question once stock became per size: "low" is now a size at or
 * under **its own** line (`lowStockAt`, else the store's
 * `lowStockThreshold`), and a tee can be low in M while the product total
 * looks healthy. So every facet reads `productStockState()` — the rule the
 * storefront and the dashboard use — rather than a SQL copy of it.
 *
 * - `instock` — something can still be bought (`Product.stock > 0`; low counts).
 * - `lowstock` — still buyable, but a size is at or under its line.
 * - `outofstock` — nobody can buy it: every size is sold out. The same set the
 *   dashboard's "out of stock" chip counts.
 * - `oversold` — a size has promised more than it holds.
 */
const STOCK_FACETS: Record<string, (s: { stock: number; state: StockState }) => boolean> = {
  instock: (s) => s.stock > 0,
  lowstock: (s) => s.state === "low",
  outofstock: (s) => s.stock <= 0,
  oversold: (s) => s.state === "oversold",
};

function buildOrderBy(sort?: string): Prisma.ProductOrderByWithRelationInput {
  switch (sort) {
    case "price-asc":
      return { price: "asc" };
    case "price-desc":
      return { price: "desc" };
    case "stock-asc":
      return { stock: "asc" };
    case "stock-desc":
      return { stock: "desc" };
    case "newest":
    default:
      return { createdAt: "desc" };
  }
}

export default async function AdminProducts({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const where = buildWhere(sp);
  const orderBy = buildOrderBy(sp.sort);
  const stockFacet = sp.stock ? STOCK_FACETS[sp.stock] : undefined;
  const hasFilters =
    Object.keys(where).length > 0 ||
    !!sp.q?.trim() ||
    !!stockFacet ||
    (sp.sort && sp.sort !== "newest");

  const [allMatching, totalCount, categoriesList, lowStockLine] = await Promise.all([
    prisma.product
      .findMany({
        where,
        orderBy,
        include: {
          subcategory: { select: { name: true } },
          // A tracked product's sizes, in the same query — the table says
          // which ones are low or oversold. Untracked products' rows hold no
          // stock yet, so none come back for them.
          variantRows: {
            where: { isActive: true, product: { trackInventory: true } },
            orderBy: { sortOrder: "asc" },
            select: {
              combo: true,
              onHand: true,
              reserved: true,
              available: true,
              lowStockAt: true,
            },
          },
        },
      })
      .catch(() => []),
    prisma.product.count().catch(() => 0),
    prisma.category.findMany({ orderBy: { name: "asc" } }),
    getLowStockThreshold().catch(() => 5),
  ]);

  // Each product's stock state and the sizes behind it, computed once and
  // used by both the stock facet and the table.
  const withStock = allMatching.map((p) => {
    const state = productStockState(p, p.variantRows, lowStockLine);
    const axes = axisOrderOf(p.attributes);
    const attention = p.trackInventory
      ? p.variantRows
          .map((v) => ({
            label: variantLabel(v.combo, axes),
            available: v.available,
            state: unitStockState(v, lowStockLine),
          }))
          .filter((v) => v.state !== "ok")
      : [];
    return { ...p, stockState: state, attention };
  });

  const faceted = stockFacet
    ? withStock.filter((p) => stockFacet({ stock: p.stock, state: p.stockState }))
    : withStock;

  // Typo-tolerant text search, ranked by relevance. Applied after the facet
  // filters so "hoodei" still respects the category and stock pickers.
  const products = sp.q?.trim()
    ? fuzzyFilter(faceted, sp.q, [
        { name: "name", weight: 0.5 },
        { name: "tags", weight: 0.2 },
        { name: "category", weight: 0.12 },
        { name: "secondaryCategory", weight: 0.08 },
        { name: "description", weight: 0.1 },
      ])
    : faceted;

  const subcategoriesList = await prisma.subcategory
    .findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, category: { select: { name: true } } },
    })
    .catch(() => []);

  const categories = categoriesList.map((c) => c.name);
  const subcategories = subcategoriesList.map((s) => ({
    id: s.id,
    name: s.name,
    categoryName: s.category.name,
  }));

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-2xl">Products</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {hasFilters
              ? `${products.length} of ${totalCount} product${totalCount === 1 ? "" : "s"} match your filters`
              : `${totalCount} product${totalCount === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <a
            href="/api/admin/products/export"
            download
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-medium hover:bg-muted transition-colors"
          >
            <Download className="h-4 w-4" /> Export CSV
          </a>
          <Link
            href="/admin/products/new"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> Add product
          </Link>
        </div>
      </div>

      <div className="mt-6">
        <ProductFilters
          categories={categories}
          subcategories={subcategories}
          lowStockLine={lowStockLine}
        />
      </div>

      {products.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-border p-12 text-center">
          <Package className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-4 font-serif text-xl">
            {hasFilters ? "No products match" : "No products yet"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {hasFilters
              ? "Try widening your filters or search query."
              : "Add your first product, or run the seed script for samples."}
          </p>
          {!hasFilters && (
            <Link
              href="/admin/products/new"
              className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm text-primary-foreground"
            >
              <Plus className="h-4 w-4" /> Add product
            </Link>
          )}
        </div>
      ) : (
        /* The table is a client component so it can hold a selection. Only
           plain data crosses — see `ProductRow`. */
        <ProductsTable
          rows={products.map((p) => ({
            id: p.id,
            name: p.name,
            // Only for the "view on the storefront" link. An inactive product
            // has no live page — the row hides the link rather than offering a
            // 404 (see ProductsTable).
            slug: p.slug,
            image: p.images[0] ?? null,
            category: p.category,
            subcategoryName: p.subcategory?.name ?? null,
            price: p.price,
            stock: p.stock,
            tracked: p.trackInventory,
            stockState: p.stockState,
            attention: p.attention,
            isActive: p.isActive,
            isFeatured: p.isFeatured,
          }))}
        />
      )}
    </div>
  );
}

