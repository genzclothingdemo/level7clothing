import Link from "next/link";
import Image from "next/image";
import { Plus, Package, Download } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatINR } from "@/lib/utils";
import { ProductRowActions } from "@/components/admin/product-row-actions";
import { ProductFilters } from "@/components/admin/product-filters";
import { CopyableId } from "@/components/admin/copy-id";

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

  if (sp.q) {
    const q = sp.q.trim();
    conditions.push({
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
        { category: { contains: q, mode: "insensitive" } },
        { secondaryCategory: { contains: q, mode: "insensitive" } },
        { tags: { hasSome: [q] } },
      ],
    });
  }

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
  const hasFilters = Object.keys(where).length > 0 || (sp.sort && sp.sort !== "newest");

  const [products, totalCount, categoriesList] = await Promise.all([
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
          <h1 className="font-serif text-3xl">Products</h1>
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
            className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 text-sm font-medium hover:bg-muted transition-colors"
          >
            <Download className="h-4 w-4" /> Export CSV
          </a>
          <Link
            href="/admin/products/new"
            className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm text-primary-foreground hover:opacity-90"
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
              className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm text-primary-foreground"
            >
              <Plus className="h-4 w-4" /> Add product
            </Link>
          )}
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Product</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">Subcategory</th>
                  <th className="px-4 py-3 font-medium">Price</th>
                  <th className="px-4 py-3 font-medium">Stock</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {products.map((p) => (
                  <tr key={p.id} className="hover:bg-muted/40">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-muted">
                          {p.images[0] && (
                            <Image
                              src={p.images[0]}
                              alt={p.name}
                              fill
                              sizes="44px"
                              className="object-cover"
                            />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-medium">{p.name}</p>
                          {p.isFeatured && (
                            <span className="block text-[11px] gold-text">
                              ★ Featured
                            </span>
                          )}
                          {/* Same ID shown on order line items, so one copied
                              off an order can be matched back to here. */}
                          <span className="mt-1 block">
                            <CopyableId id={p.id} />
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {p.category}
                    </td>
                    <td className="px-4 py-3">
                      {p.subcategory ? (
                        <span className="rounded-full bg-accent/10 px-2.5 py-1 text-xs text-foreground">
                          {p.subcategory.name}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">{formatINR(p.price)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={p.stock <= 0 ? "text-danger" : ""}
                      >
                        {p.stock}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs ${
                          p.isActive
                            ? "bg-success/15 text-success"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {p.isActive ? "Active" : "Hidden"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <ProductRowActions id={p.id} isActive={p.isActive} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

