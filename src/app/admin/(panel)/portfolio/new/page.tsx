import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { listLinkableProducts } from "@/lib/portfolio";
import {
  EMPTY_PORTFOLIO_ITEM,
  PortfolioForm,
} from "@/components/admin/portfolio-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "New portfolio piece" };

export default async function NewPortfolioPage() {
  const products = await listLinkableProducts();

  return (
    <div className="min-w-0">
      <Link
        href="/admin/portfolio"
        className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> Portfolio
      </Link>
      <h1 className="mb-6 font-serif text-3xl">Add a piece</h1>

      <PortfolioForm initial={EMPTY_PORTFOLIO_ITEM} products={products} />
    </div>
  );
}
