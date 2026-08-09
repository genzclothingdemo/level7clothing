import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getUserSession } from "@/lib/user-auth";
import { logout } from "@/app/actions/account";
import { AccountView } from "@/components/store/account-view";
import type { AccountOrder } from "@/components/store/account-orders";
import type { StatusEntry } from "@/components/store/order-timeline";

export const dynamic = "force-dynamic";
export const metadata = { title: "My account" };

export default async function AccountPage() {
  const session = await getUserSession();
  if (!session) redirect("/account/login?next=/account");

  const user = await prisma.user
    .findUnique({ where: { id: session.id } })
    .catch(() => null);

  if (!user) redirect("/account/login");

  // Orders
  const raw = await prisma.order
    .findMany({
      where: { OR: [{ userId: user.id }, { email: user.email }] },
      orderBy: { createdAt: "desc" },
    })
    .catch(() => []);

  const orders: AccountOrder[] = raw.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    total: o.total,
    subtotal: o.subtotal,
    shipping: o.shipping,
    discountTotal: o.discountTotal,
    couponCode: o.couponCode,
    paymentMethod: o.paymentMethod,
    paymentStatus: o.paymentStatus,
    createdAt: o.createdAt.toISOString(),
    courier: o.courier,
    trackingNumber: o.trackingNumber,
    trackingUrl: o.trackingUrl,
    deliveryStatus: o.deliveryStatus,
    items: o.items as AccountOrder["items"],
    statusHistory: (Array.isArray(o.statusHistory)
      ? o.statusHistory
      : []) as unknown as StatusEntry[],
    address: o.address,
    city: o.city,
    state: o.state,
    pincode: o.pincode,
    note: o.note,
  }));

  // Reviews — approved for portfolio display
  const reviewModel = (prisma as unknown as Record<string, any>).review;
  const rawReviews = reviewModel
    ? await reviewModel
        .findMany({
          where: { approved: true },
          orderBy: [{ featured: "desc" }, { createdAt: "desc" }],
          take: 50,
        })
        .catch(() => [])
    : [];

  const reviews = (rawReviews || []).map((r: Record<string, any>) => ({
    ...r,
    createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : new Date().toISOString(),
  }));

  return (
    <div className="container-px mx-auto max-w-6xl py-8 md:py-12">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-3xl md:text-4xl">
            Hello, {user.name.split(" ")[0]} 👋
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your profile, view orders, and explore our portfolio
          </p>
        </div>
        <form action={logout}>
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
          >
            <LogOut className="h-4 w-4" /> Log out
          </button>
        </form>
      </div>

      {/* ── Tabbed View ── */}
      <AccountView user={user} orders={orders} reviews={reviews} />
    </div>
  );
}
