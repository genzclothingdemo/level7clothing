import Link from "next/link";
import { Plus, Package, Download } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { fuzzyFilter } from "@/lib/search";
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

  if (sp.stock) {
    if (sp.stock === "instock") {
      conditions.push({ stock: { gt: 0 } });
    } else if (sp.stock === "lowstock") {
      conditions.push({ stock: { lte: 5 } });
    } else if (sp.stock === "outofstock") {
      conditions.push({ stock: 0 });
    }
  }

  if (conditions.length === 0) return {};
  if (conditions.length === 1) return conditions[0];
  return { AND: conditions };
}

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
  const hasFilters =
    Object.keys(where).length > 0 || !!sp.q?.trim() || (sp.sort && sp.sort !== "newest");

  const [allMatching, totalCount, categoriesList] = await Promise.all([
    prisma.product
      .findMany({
        where,
        orderBy,
        include: { subcategory: { select: { name: true } } },
      })
      .catch(() => []),
    prisma.product.count().catch(() => 0),
    prisma.category.findMany({ orderBy: { name: "asc" } }),
  ]);

  // Typo-tolerant text search, ranked by relevance. Applied after the facet
  // filters so "hoodei" still respects the category and stock pickers.
  const products = sp.q?.trim()
    ? fuzzyFilter(allMatching, sp.q, [
        { name: "name", weight: 0.5 },
        { name: "tags", weight: 0.2 },
        { name: "category", weight: 0.12 },
        { name: "secondaryCategory", weight: 0.08 },
        { name: "description", weight: 0.1 },
      ])
    : allMatching;

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
            image: p.images[0] ?? null,
            category: p.category,
            subcategoryName: p.subcategory?.name ?? null,
            price: p.price,
            stock: p.stock,
            isActive: p.isActive,
            isFeatured: p.isFeatured,
          }))}
        />
      )}
    </div>
  );
}

