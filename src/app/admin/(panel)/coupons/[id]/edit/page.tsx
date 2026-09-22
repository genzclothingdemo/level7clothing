import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { toStoreDateTimeInput } from "@/lib/coupons";
import { CouponForm, type CouponFormValues } from "@/components/admin/coupon-form";
import { formatStoreDateTime } from "@/components/admin/coupon-summary";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edit coupon" };

/** Blank for a null limit — the form treats an empty field as "no limit". */
function num(v: number | null): string {
  return v === null ? "" : String(v);
}

export default async function EditCouponPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [coupon, products, lastRedemption] = await Promise.all([
    prisma.coupon.findUnique({ where: { id } }),
    prisma.product.findMany({
      select: { id: true, name: true, category: true },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    }),
    prisma.couponRedemption.findFirst({
      where: { couponId: id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);

  if (!coupon) notFound();

  // The two dates are converted to the store's time zone HERE, on the server,
  // so the string the form renders is the same on both passes. Doing it in the
  // client would make the initial value depend on the reader's own zone and
  // hydrate differently from what was sent.
  const initial: CouponFormValues = {
    code: coupon.code,
    discountAmount: String(coupon.discountAmount),
    isPercentage: coupon.isPercentage,
    isActive: coupon.isActive,
    productIds: coupon.productIds,
    maxDiscount: num(coupon.maxDiscount),
    minSpend: num(coupon.minSpend),
    usageLimit: num(coupon.usageLimit),
    perUserLimit: num(coupon.perUserLimit),
    startsAt: toStoreDateTimeInput(coupon.startsAt),
    expiresAt: toStoreDateTimeInput(coupon.expiresAt),
  };

  return (
    <div className="min-w-0">
      <Link
        href="/admin/coupons"
        className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> Coupons
      </Link>
      <div className="mb-6 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="font-serif text-2xl">
          Edit <span className="font-mono tracking-widest">{coupon.code}</span>
        </h1>
        {lastRedemption && (
          <p className="text-sm text-muted-foreground">
            Last used {formatStoreDateTime(lastRedemption.createdAt)}
          </p>
        )}
      </div>

      <CouponForm
        couponId={coupon.id}
        initial={initial}
        products={products}
        usedCount={coupon.usedCount}
      />
    </div>
  );
}
