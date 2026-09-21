import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { toStoreDateTimeInput } from "@/lib/coupons";
import { asPromotionKind, getLivePromotion } from "@/lib/promotions";
import {
  PromotionForm,
  type PromotionFormValues,
} from "@/components/admin/promotion-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit promotion" };

export default async function EditPromotionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [promotion, live] = await Promise.all([
    prisma.promotion.findUnique({ where: { id } }),
    getLivePromotion(),
  ]);

  if (!promotion) notFound();

  // The dates are converted to the store's time zone HERE, on the server, so
  // the string the form renders is the same on both passes. Doing it in the
  // client would make the initial value depend on the reader's own zone and
  // hydrate differently from what was sent.
  const initial: PromotionFormValues = {
    title: promotion.title,
    body: promotion.body,
    ctaLabel: promotion.ctaLabel ?? "",
    ctaHref: promotion.ctaHref ?? "",
    kind: asPromotionKind(promotion.kind),
    isActive: promotion.isActive,
    startsAt: toStoreDateTimeInput(promotion.startsAt),
    endsAt: toStoreDateTimeInput(promotion.endsAt),
    priority: String(promotion.priority),
    dismissDays: String(promotion.dismissDays),
  };

  return (
    <div className="min-w-0">
      <Link
        href="/admin/promotions"
        className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> Promotions
      </Link>
      <h1 className="mb-6 break-words font-serif text-3xl">Edit promotion</h1>

      <PromotionForm
        promotionId={promotion.id}
        initial={initial}
        liveId={live?.id ?? null}
      />
    </div>
  );
}
