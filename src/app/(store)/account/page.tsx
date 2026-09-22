import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getUserSession } from "@/lib/user-auth";
import { getSettings } from "@/lib/settings";
import { logout } from "@/app/actions/account";
import { listMyAddresses } from "@/app/actions/addresses";
import { AccountView, type AccountTab } from "@/components/store/account-view";
import type { AccountOrder } from "@/components/store/account-orders";
import {
  buildOrderTimeline,
  buildStoreMessages,
  formatOrderDate,
} from "@/components/store/order-status";
import {
  buildOrderReturns,
  type ReturnProductFlags,
} from "@/components/store/order-returns";

export const dynamic = "force-dynamic";
export const metadata = { title: "My account" };

const TABS: readonly AccountTab[] = [
  "profile",
  "orders",
  "addresses",
  "portfolio",
];

/** A line as checkout wrote it into `Order.items` (JSON, so untyped by Prisma). */
type RawItem = {
  productId?: string;
  name: string;
  image?: string;
  price: number;
  quantity: number;
  options?: { name: string; value: string }[];
};

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

  // Orders. `returnRequests` is included because the list offers returns now,
  // not just the order page — a customer who has just been told "delivered"
  // is on this screen, not on a confirmation page they closed a week ago.
  const [settings, raw] = await Promise.all([
    getSettings(),
    prisma.order
      .findMany({
        where: { OR: [{ userId: user.id }, { email: user.email }] },
        orderBy: { createdAt: "desc" },
        include: { returnRequests: { orderBy: { createdAt: "desc" } } },
      })
      .catch(() => []),
  ]);

  // ---- Products behind the order lines ----
  // One query for the whole page, not one per order. It answers two questions
  // at once: what to link a line to, and whether that line may be returned.
  const itemsByOrder = new Map<string, RawItem[]>();
  const productIds = new Set<string>();
  for (const order of raw) {
    const items = (Array.isArray(order.items)
      ? order.items
      : []) as unknown as RawItem[];
    itemsByOrder.set(order.id, items);
    for (const item of items) if (item.productId) productIds.add(item.productId);
  }

  const products = productIds.size
    ? await prisma.product
        .findMany({
          where: { id: { in: [...productIds] } },
          // `isCustomisable` is load-bearing, not decoration: without it
          // `resolveReturnPolicy` treats a made-to-order piece as returnable
          // and typechecks perfectly while doing so.
          select: {
            id: true,
            slug: true,
            isActive: true,
            images: true,
            returnable: true,
            returnsInfo: true,
            isCustomisable: true,
          },
        })
        .catch(() => [])
    : [];
  const productById = new Map(products.map((p) => [p.id, p]));
  const policyById = new Map<string, ReturnProductFlags>(
    products.map((p) => [
      p.id,
      {
        returnable: p.returnable,
        returnsInfo: p.returnsInfo,
        isCustomisable: p.isCustomisable,
      },
    ])
  );

  // One clock for the whole page, so two orders can't disagree about whether
  // today is inside their return window.
  const now = new Date();

  const orders: AccountOrder[] = raw.map((order) => {
    const items = itemsByOrder.get(order.id) ?? [];
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      // Formatted here, on the server. A client component calling
      // toLocaleDateString reads the browser's timezone and mismatches the
      // server's on any order placed near midnight.
      placedOn: formatOrderDate(order.createdAt),
      total: order.total,
      items: items.map((item) => {
        const product = item.productId
          ? productById.get(item.productId)
          : undefined;
        return {
          name: item.name,
          quantity: item.quantity,
          price: item.price,
          options: item.options,
          // The photo captured at checkout is the variant the shopper actually
          // bought; the product's own first image is only a fallback for an
          // older order that stored none.
          image: item.image?.trim() || product?.images?.[0] || null,
          // Linked ONLY while the product is live: getProductBySlug returns
          // null for an inactive one and the page calls notFound(), so a link
          // here would hand a customer a 404 for something they own.
          slug: product?.isActive ? product.slug : null,
        };
      }),
      trail: buildOrderTimeline(order.statusHistory),
      // `order.note` is the admin's INTERNAL note and is never read. The
      // customer-facing text is `customerNote` plus the status notes the admin
      // flagged `forCustomer`, which is exactly what this builds.
      messages: buildStoreMessages(order.customerNote, order.statusHistory),
      payment: {
        subtotal: order.subtotal,
        shipping: order.shipping,
        discountTotal: order.discountTotal,
        couponCode: order.couponCode,
        total: order.total,
        paymentMethod: order.paymentMethod,
        paymentStatus: order.paymentStatus,
        amountPaid: order.amountPaid,
        balanceDue: order.balanceDue,
      },
      delivery: {
        customerName: order.customerName,
        phone: order.phone,
        address: order.address,
        city: order.city,
        state: order.state,
        pincode: order.pincode,
        courier: order.courier,
        trackingNumber: order.trackingNumber,
        trackingUrl: order.trackingUrl,
      },
      refs: {
        orderNumber: order.orderNumber,
        razorpayPaymentId: order.razorpayPaymentId,
        razorpayOrderId: order.razorpayOrderId,
      },
      deliveryStatus: order.deliveryStatus,
      deliveryLocation: order.deliveryLocation,
      returns: buildOrderReturns({
        order,
        items,
        products: policyById,
        returnRequests: order.returnRequests,
        settings,
        now,
      }),
    };
  });

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
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
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
