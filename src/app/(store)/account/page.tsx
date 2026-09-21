import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getUserSession } from "@/lib/user-auth";
import { logout } from "@/app/actions/account";
import { listMyAddresses } from "@/app/actions/addresses";
import { AccountView, type AccountTab } from "@/components/store/account-view";
import type { AccountOrder } from "@/components/store/account-orders";
import type { StatusEntry } from "@/components/store/order-timeline";

export const dynamic = "force-dynamic";
export const metadata = { title: "My account" };

const TABS: readonly AccountTab[] = [
  "profile",
  "orders",
  "addresses",
  "portfolio",
];

export default async function AccountPage({
  searchParams,
}: {
  // Next 16: a promise that has to be awaited.
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await getUserSession();
  if (!session) redirect("/account/login?next=/account");

  const user = await prisma.user
    .findUnique({ where: { id: session.id } })
    .catch(() => null);

  if (!user) redirect("/account/login");

  // `?tab=addresses` so anything can deep-link a panel — checkout's "Manage
  // addresses" link, and the Change button on the profile summary.
  const tabParam = (await searchParams).tab;
  const initialTab = TABS.find((t) => t === tabParam) ?? "profile";

  // Saved addresses, default first. Read through the action rather than
  // Prisma directly so the one-time legacy migration runs here too: an account
  // that still has only the inline `User.address` columns gets them folded
  // into a real `Address` row on this load. See src/app/actions/addresses.ts.
  const addresses = (await listMyAddresses()) ?? [];

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
    // `o.note` is the admin's INTERNAL note and must never reach the customer.
    // It starts life as the shopper's own checkout note and is then overwritten
    // by admin-only text, so it cannot be treated as safe. The customer-facing
    // message is `customerNote`; per-status messages are filtered out of
    // statusHistory by the `forCustomer` flag inside OrderTimeline.
    note: o.customerNote,
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

      {/* ── Tabbed View ──
          `user` is narrowed to identity on purpose: the inline
          `user.address / city / state / pincode` columns are legacy and must
          not reach the UI. Addresses come from the `Address` table only. */}
      <AccountView
        user={{ name: user.name, email: user.email, phone: user.phone }}
        orders={orders}
        reviews={reviews}
        addresses={addresses}
        initialTab={initialTab}
      />
    </div>
  );
}
