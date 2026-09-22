import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { asPortfolioKind, listLinkableProducts } from "@/lib/portfolio";
import {
  PortfolioForm,
  type PortfolioFormValues,
} from "@/components/admin/portfolio-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit portfolio piece" };

export default async function EditPortfolioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [item, products] = await Promise.all([
    prisma.portfolioItem.findUnique({ where: { id } }),
    listLinkableProducts(),
  ]);

  if (!item) notFound();

  /**
   * The form holds strings, so every nullable column collapses to `""` here —
   * on the server, so the value rendered on both passes is identical. Emptying
   * a field then sends `""`, which the action turns back into an explicit
   * `null`; sending `undefined` would mean "leave the column alone" to Prisma
   * and clearing a field would silently do nothing (CLAUDE.md).
   */
  const initial: PortfolioFormValues = {
    title: item.title,
    description: item.description ?? "",
    kind: asPortfolioKind(item.kind),
    url: item.url ?? "",
    imageUrl: item.imageUrl ?? "",
    embedHtml: item.embedHtml ?? "",
    productId: item.productId ?? "",
    tags: item.tags.join(", "),
    sortOrder: String(item.sortOrder),
    isFeatured: item.isFeatured,
    isActive: item.isActive,
  };

  return (
    <div className="min-w-0">
      <Link
        href="/admin/portfolio"
        className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> Portfolio
      </Link>
      <h1 className="mb-6 break-words font-serif text-2xl">Edit piece</h1>

      <PortfolioForm itemId={item.id} initial={initial} products={products} />
    </div>
  );
}
