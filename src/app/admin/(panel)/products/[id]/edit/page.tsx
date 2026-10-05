import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { ProductForm } from "@/components/admin/product-form";
import type { VariantRowDTO } from "@/components/admin/variant-table";
import { getSettings } from "@/lib/settings";
import type { ProductDTO, ProductOption, VariantPrice, Variant } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit product" };

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [product, categoriesList, subcategories, settings, stockDefaults] = await Promise.all([
    // `productImages` is the persisted contract for galleries — slot +
    // variantValue + sortOrder, written by syncProductImages(). Without it the
    // editor rebuilt its Media tab from the `Product.variants` JSON mirror,
    // where every variant's `images` already has the common photos appended.
    // That round-trip put the common shots under each variant value, left
    // Common empty, and the next save then deleted the slot="common" rows.
    //
    // `variantRows` is the same idea for the variant grid: SKUs, barcodes,
    // costs and per-size price overrides are the rows' to hold, and the
    // `variants` JSON draft does not carry them. Retired rows come too — the
    // grid names them so their SKUs are not offered to another size.
    prisma.product.findUnique({
      where: { id },
      include: {
        productImages: {
          orderBy: { sortOrder: "asc" },
          include: {
            media: {
              select: { id: true, url: true, alt: true, width: true, height: true },
            },
          },
        },
        variantRows: {
          orderBy: [{ sortOrder: "asc" }, { comboKey: "asc" }],
          select: {
            id: true,
            comboKey: true,
            combo: true,
            sku: true,
            barcode: true,
            price: true,
            compareAtPrice: true,
            costPrice: true,
            lowStockAt: true,
            isActive: true,
            onHand: true,
            reserved: true,
            available: true,
            _count: { select: { movements: true } },
          },
        },
      },
    }),
    prisma.category.findMany({ orderBy: { name: "asc" } }),
    prisma.subcategory.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        name: true,
        category: { select: { name: true } },
      },
    }),
    getSettings(),
    // Not on the settings DTO yet; read directly rather than widen a type
    // another screen owns. Missing row → the schema default.
    prisma.siteSettings
      .findFirst({ select: { lowStockThreshold: true } })
      .catch(() => null),
  ]);
  if (!product) notFound();

  const categories = categoriesList.map((c) => c.name);
  const subs = subcategories.map((s) => ({
    id: s.id,
    name: s.name,
    categoryName: s.category.name,
  }));

  const variantRows: VariantRowDTO[] = product.variantRows.map((r) => ({
    id: r.id,
    key: r.comboKey,
    combo: (r.combo as Record<string, string>) ?? {},
    sku: r.sku,
    barcode: r.barcode,
    price: r.price,
    compareAtPrice: r.compareAtPrice,
    costPrice: r.costPrice,
    lowStockAt: r.lowStockAt,
    isActive: r.isActive,
    onHand: r.onHand,
    reserved: r.reserved,
    available: r.available,
    movements: r._count.movements,
  }));

  // The relation is handed over as `variantRows` above; keep it off the DTO.
  const { variantRows: _rows, ...productRow } = product;

  const dto = {
    ...productRow,
    media: product.productImages.map((pi) => ({
      id: pi.media.id,
      url: pi.media.url,
      alt: pi.media.alt,
      width: pi.media.width,
      height: pi.media.height,
      slot: pi.slot,
      variantValue: pi.variantValue,
      sortOrder: pi.sortOrder,
    })),
    options: Array.isArray(product.options)
      ? (product.options as unknown as ProductOption[])
      : [],
    variantPrices: Array.isArray(product.variantPrices)
      ? (product.variantPrices as unknown as VariantPrice[])
      : [],
    variants: Array.isArray(product.variants)
      ? (product.variants as unknown as Variant[])
      : [],
  } as unknown as ProductDTO;

  return (
    <div>
      <Link
        href="/admin/products"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> Back to products
      </Link>
      <h1 className="mb-6 font-serif text-2xl">Edit product</h1>
      <ProductForm
        product={dto}
        categories={categories}
        subcategories={subs}
        infoDefaults={{
          materialsCare: settings.defaultMaterialsCare,
          shippingInfo: settings.defaultShippingInfo,
          returnsInfo: settings.defaultReturnsInfo,
        }}
        /* All three, not `returnsEnabled && defaultReturnable` — the editor
           resolves them itself with the storefront's own rule, and merging the
           master switch into the default left it unable to say which one was
           answering (see ReturnsOutcome in product-form.tsx). */
        returnDefaults={{
          returnsEnabled: settings.returnsEnabled,
          defaultReturnable: settings.defaultReturnable,
          returnWindowDays: settings.returnWindowDays,
        }}
        variantRows={variantRows}
        inventory={{
          tracked: product.trackInventory,
          lowStockThreshold: stockDefaults?.lowStockThreshold ?? 5,
          href: `/admin/inventory?product=${product.id}`,
        }}
        brandName={settings.brandName}
      />
    </div>
  );
}

