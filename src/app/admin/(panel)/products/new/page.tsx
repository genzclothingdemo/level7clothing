import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { ProductForm } from "@/components/admin/product-form";
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

  const [categoriesList, subcategories, source, settings] = await Promise.all([
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
    sp.copyOf
      ? prisma.product.findUnique({ where: { id: sp.copyOf } })
      : Promise.resolve(null),
    getSettings(),
  ]);

  const categories = categoriesList.map((c) => c.name);
  const subs = subcategories.map((s) => ({
    id: s.id,
    name: s.name,
    categoryName: s.category.name,
  }));

  // A copy is a brand-new product: no id, and a name the owner must edit.
  // Everything expensive to re-enter — options, the whole variant matrix,
  // photos, shipping, parcel size — carries over.
  const preset = source
    ? ({
        ...source,
        id: "",
        slug: "",
        name: `${source.name} (copy)`,
        isFeatured: false,
      } as unknown as ProductDTO)
    : undefined;

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
      <h1 className="mb-1 font-serif text-3xl">
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
        returnDefault={settings.returnsEnabled && settings.defaultReturnable}
      />
    </div>
  );
}
