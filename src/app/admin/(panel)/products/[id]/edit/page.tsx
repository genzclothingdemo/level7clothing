import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { ProductForm } from "@/components/admin/product-form";
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
  const [product, categoriesList, subcategories, settings] = await Promise.all([
    prisma.product.findUnique({ where: { id } }),
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
  ]);
  if (!product) notFound();

  const categories = categoriesList.map((c) => c.name);
  const subs = subcategories.map((s) => ({
    id: s.id,
    name: s.name,
    categoryName: s.category.name,
  }));

  const dto = {
    ...product,
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
      <h1 className="mb-6 font-serif text-3xl">Edit product</h1>
      <ProductForm
        product={dto}
        categories={categories}
        subcategories={subs}
        infoDefaults={{
          materialsCare: settings.defaultMaterialsCare,
          shippingInfo: settings.defaultShippingInfo,
          returnsInfo: settings.defaultReturnsInfo,
        }}
        returnDefault={settings.returnsEnabled && settings.defaultReturnable}
      />
    </div>
  );
}

