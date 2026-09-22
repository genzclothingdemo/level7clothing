import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { CouponForm, EMPTY_COUPON } from "@/components/admin/coupon-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "New coupon" };

export default async function NewCouponPage() {
  const products = await prisma.product
    .findMany({
      select: { id: true, name: true, category: true },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    })
    .catch(() => []);

  return (
    <div className="min-w-0">
      <Link
        href="/admin/coupons"
        className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" /> Coupons
      </Link>
      <h1 className="mb-6 font-serif text-2xl">New coupon</h1>

      <CouponForm initial={EMPTY_COUPON} products={products} />
    </div>
  );
}
