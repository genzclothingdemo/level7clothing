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

  /*
   * Where this row came from, resolved to a **name** here rather than passed
   * as an id. The form only prints it and never writes it back, so sending
   * the id would invite a future edit to do exactly what `toRow()` is written
   * to prevent. `findUnique` and not a join, because `sourceProductId` is a
   * plain column on purpose — a portfolio row outlives the product it was
   * about, and a dangling id must degrade to "a product that has since gone"
   * rather than break the page.
   */
  const source = item.sourceProductId
    ? await prisma.product
        .findUnique({
          where: { id: item.sourceProductId },
          select: { name: true },
        })
        .catch(() => null)
    : null;

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
    /*
     * The **stored** body, not a re-render of it.
     *
     * It is already sanitised — `toRow()` cleans on the way in — so what the
     * owner edits is exactly what is live, and a save is idempotent rather
     * than stripping a little more each time. This is the same rehydrate-from-
     * the-real-column rule CLAUDE.md records for ProductImage: reading a
     * lossy mirror back into a form is what made the next save delete rows.
     */
    bodyHtml: item.bodyHtml ?? "",
    images: item.images ?? [],
    ctaLabel: item.ctaLabel ?? "",
    ctaUrl: item.ctaUrl ?? "",
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

      <PortfolioForm
        itemId={item.id}
        initial={initial}
        products={products}
        harvestedFrom={
          item.sourceProductId ? { productName: source?.name ?? null } : null
        }
      />
    </div>
  );
}
