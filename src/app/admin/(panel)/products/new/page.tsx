import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { ProductForm } from "@/components/admin/product-form";
import type { VariantRowDTO } from "@/components/admin/variant-table";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import type { ProductDTO } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add product" };

export default async function NewProductPage({
  searchParams,
}: {
  // Set by "Add product" inside a subcategory, and by "Duplicate" on a product.
  searchParams: Promise<{
    category?: string;
    subcategoryId?: string;
    copyOf?: string;
  }>;
}) {
  const sp = await searchParams;

  const [categoriesList, subcategories, source, settings, stockDefaults] = await Promise.all([
    prisma.category.findMany({ orderBy: { name: "asc" } }),
    prisma.subcategory.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        category: { select: { name: true } },
      },
    }),
    // Duplicating: load the product being copied so the form opens pre-filled.
    // Its active variant rows come too, for the per-size costs, compare-at
    // prices and low-stock alerts — see `copiedRows` for what is left behind.
    sp.copyOf
      ? prisma.product.findUnique({
          where: { id: sp.copyOf },
          include: {
            variantRows: {
              where: { isActive: true },
              orderBy: [{ sortOrder: "asc" }, { comboKey: "asc" }],
              select: {
                comboKey: true,
                combo: true,
                price: true,
                compareAtPrice: true,
                costPrice: true,
                lowStockAt: true,
              },
            },
          },
        })
      : Promise.resolve(null),
    getSettings(),
    prisma.siteSettings
      .findFirst({ select: { lowStockThreshold: true } })
      .catch(() => null),
  ]);

  const categories = categoriesList.map((c) => c.name);
  const subs = subcategories.map((s) => ({
    id: s.id,
    name: s.name,
    categoryName: s.category.name,
  }));

  // A copy is a brand-new product: no id, and a name the owner must edit.
  // Everything expensive to re-enter — options, the whole variant matrix,
  // photos, shipping, parcel size, costs — carries over.
  //
  // What does **not**: tracking and stock identity. The copy starts untracked
  // (tracking begins from a real count in Inventory), and its rows carry no
  // id, SKU, barcode or stock — SKUs and barcodes are unique across the store,
  // so the copy is given its own on save, and it owns none of the source's units.
  let preset: ProductDTO | undefined;
  if (source) {
    // The rows are handed over as `copiedRows` below; keep them off the DTO.
    const { variantRows: _rows, ...sourceProduct } = source;
    preset = {
      ...sourceProduct,
      id: "",
      slug: "",
      name: `${source.name} (copy)`,
      isFeatured: false,
      trackInventory: false,
    } as unknown as ProductDTO;
  }
  const copiedRows: VariantRowDTO[] = (source?.variantRows ?? []).map((r) => ({
    id: "",
    key: r.comboKey,
    combo: (r.combo as Record<string, string>) ?? {},
    sku: "",
    barcode: null,
    price: r.price,
    compareAtPrice: r.compareAtPrice,
    costPrice: r.costPrice,
    lowStockAt: r.lowStockAt,
    isActive: true,
    onHand: 0,
    reserved: 0,
    available: 0,
    movements: 0,
  }));

  const groupName = sp.subcategoryId
    ? subs.find((s) => s.id === sp.subcategoryId)?.name
    : undefined;

  return (
    <div>
      <Link
        href="/admin/products"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> Back to products
      </Link>
      <h1 className="mb-1 font-serif text-2xl">
        {source ? "Duplicate product" : "Add product"}
      </h1>
      <p className="mb-6 text-sm text-muted-foreground">
        {source ? (
          <>
            Copied from <b>{source.name}</b> — change the name, photos and
            prices, then save. The original is untouched.
          </>
        ) : groupName ? (
          <>
            This piece will be added to the <b>{groupName}</b> subcategory.
          </>
        ) : (
          "Fill in the details below."
        )}
      </p>
      <ProductForm
        product={preset}
        categories={categories}
        subcategories={subs}
        initialCategory={sp.category}
        initialSubcategoryId={sp.subcategoryId}
        infoDefaults={{
          materialsCare: settings.defaultMaterialsCare,
          shippingInfo: settings.defaultShippingInfo,
          returnsInfo: settings.defaultReturnsInfo,
        }}
        /* See the edit page: the master switch and the catalogue default are
           two different facts and are passed as two. */
        returnDefaults={{
          returnsEnabled: settings.returnsEnabled,
          defaultReturnable: settings.defaultReturnable,
          returnWindowDays: settings.returnWindowDays,
        }}
        variantRows={copiedRows}
        inventory={{
          tracked: false,
          lowStockThreshold: stockDefaults?.lowStockThreshold ?? 5,
          href: "/admin/inventory",
        }}
        brandName={settings.brandName}
      />
    </div>
  );
}
