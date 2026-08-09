import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSubcategoriesForAdmin } from "@/lib/catalog";
import { SubcategoryManager } from "@/components/admin/subcategory-manager";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const category = await prisma.category.findUnique({
    where: { id },
    select: { name: true },
  });
  return { title: `${category?.name ?? "Category"} — Subcategories` };
}

export default async function AdminSubcategoriesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const category = await prisma.category.findUnique({ where: { id } });
  if (!category) notFound();

  const [subcategories, products] = await Promise.all([
    getSubcategoriesForAdmin(id),
    // Everything that can live in this category, so products can be moved
    // into and out of a group without leaving the page.
    prisma.product.findMany({
      where: {
        OR: [
          { category: category.name },
          { secondaryCategory: category.name },
        ],
      },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        price: true,
        images: true,
        isActive: true,
        subcategoryId: true,
      },
    }),
  ]);

  return (
    <SubcategoryManager
      category={{ id: category.id, name: category.name }}
      subcategories={subcategories.map((s) => ({
        id: s.id,
        name: s.name,
        slug: s.slug,
        images: s.images,
        priceMin: s.priceMin,
        priceMax: s.priceMax,
        isActive: s.isActive,
        productCount: s.productCount,
        autoPriceMin: s.autoPriceMin,
        autoPriceMax: s.autoPriceMax,
        coverImages: s.coverImages,
      }))}
      products={products}
    />
  );
}
