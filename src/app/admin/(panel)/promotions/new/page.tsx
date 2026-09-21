import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { getLivePromotion } from "@/lib/promotions";
import {
  EMPTY_PROMOTION,
  PromotionForm,
} from "@/components/admin/promotion-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "New promotion" };

export default async function NewPromotionPage() {
  // Passed so the editor can warn that something else is already showing —
  // a new promotion at priority 0 may not be the one shoppers get.
  const live = await getLivePromotion();

  return (
    <div className="min-w-0">
      <Link
        href="/admin/promotions"
        className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> Promotions
      </Link>
      <h1 className="mb-6 font-serif text-3xl">New promotion</h1>

      <PromotionForm initial={EMPTY_PROMOTION} liveId={live?.id ?? null} />
    </div>
  );
}
