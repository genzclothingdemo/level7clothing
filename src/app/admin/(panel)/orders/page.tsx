import { ShoppingCart } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { OrdersTable, type AdminOrder } from "@/components/admin/orders-table";
import { OrderFilters } from "@/components/admin/order-filters";

export const dynamic = "force-dynamic";
export const metadata = { title: "Orders" };

type SP = {
  q?: string;
  status?: string;
  paymentStatus?: string;
  paymentMethod?: string;
  from?: string;
  to?: string;
  min?: string;
  max?: string;
  coupon?: string;
  match?: string;
};

function buildWhere(sp: SP): Prisma.OrderWhereInput {
  const conditions: Prisma.OrderWhereInput[] = [];

  if (sp.q) {
    const q = sp.q.trim();
    conditions.push({
      OR: [
        { orderNumber: { contains: q, mode: "insensitive" } },
        { customerName: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { phone: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  if (sp.status) conditions.push({ status: sp.status });
  if (sp.paymentStatus) conditions.push({ paymentStatus: sp.paymentStatus });
  if (sp.paymentMethod) conditions.push({ paymentMethod: sp.paymentMethod });

  // Date range (inclusive of the whole "to" day).
  const createdAt: Prisma.DateTimeFilter = {};
  if (sp.from) {
    const d = new Date(sp.from);
    if (!isNaN(d.getTime())) createdAt.gte = d;
  }
  if (sp.to) {
    const d = new Date(sp.to);
    if (!isNaN(d.getTime())) {
      d.setHours(23, 59, 59, 999);
      createdAt.lte = d;
    }
  }
  if (createdAt.gte || createdAt.lte) conditions.push({ createdAt });

  // Total amount range.
  const total: Prisma.IntFilter = {};
  if (sp.min && !isNaN(Number(sp.min))) total.gte = Number(sp.min);
  if (sp.max && !isNaN(Number(sp.max))) total.lte = Number(sp.max);
  if (total.gte != null || total.lte != null) conditions.push({ total });

  if (sp.coupon) {
    conditions.push({ couponCode: { equals: sp.coupon, mode: "insensitive" } });
  }

  if (conditions.length === 0) return {};
  if (conditions.length === 1) return conditions[0];

  // AND = every condition must match; OR = any condition matches.
  return sp.match === "any" ? { OR: conditions } : { AND: conditions };
}

export default async function AdminOrders({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;
  const where = buildWhere(sp);
  const hasFilters = Object.keys(where).length > 0;

  const [raw, totalCount, settings] = await Promise.all([
    prisma.order
      .findMany({
        where,
        orderBy: { createdAt: "desc" },
        // Return count per order so the list can show "1 return" without the
        // admin opening each card to find out.
        include: { _count: { select: { returnRequests: true } } },
      })
      .catch(() => []),
    prisma.order.count().catch(() => 0),
    getSettings(),
  ]);

  // Line items store the productId but not the slug, so resolve the storefront
  // slug for every product these orders reference — that's what turns a line
  // item into a clickable product link. A product deleted since the order was
  // placed simply has no slug, and renders without a link.
  const productIds = [
    ...new Set(
      raw.flatMap((o) =>
        (Array.isArray(o.items) ? (o.items as { productId?: string }[]) : [])
          .map((i) => i.productId)
          .filter((id): id is string => !!id)
      )
    ),
  ];
  const slugById = new Map(
    (productIds.length
      ? await prisma.product
          .findMany({
            where: { id: { in: productIds } },
            select: { id: true, slug: true },
          })
          .catch(() => [])
      : []
    ).map((p) => [p.id, p.slug])
  );

  const orders: AdminOrder[] = raw.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    customerName: o.customerName,
    email: o.email,
    phone: o.phone,
    address: o.address,
    city: o.city,
    state: o.state,
    pincode: o.pincode,
    items: (Array.isArray(o.items) ? (o.items as AdminOrder["items"]) : []).map(
      (it) => ({
        ...it,
        slug: it.productId ? (slugById.get(it.productId) ?? null) : null,
      })
    ),
    subtotal: o.subtotal,
    shipping: o.shipping,
    discountTotal: o.discountTotal,
    couponCode: o.couponCode,
    total: o.total,
    amountPaid: o.amountPaid,
    balanceDue: o.balanceDue,
    paymentMethod: o.paymentMethod,
    paymentStatus: o.paymentStatus,
    status: o.status,
    courier: o.courier,
    trackingNumber: o.trackingNumber,
    trackingUrl: o.trackingUrl,
    nimbusShipmentId: o.nimbusShipmentId,
    nimbusCourierId: o.nimbusCourierId,
    nimbusCourierName: o.nimbusCourierName,
    deliveryStatus: o.deliveryStatus,
    deliveryLocation: o.deliveryLocation,
    deliveryStatusAt: o.deliveryStatusAt?.toISOString() ?? null,
    lastSyncedAt: o.lastSyncedAt?.toISOString() ?? null,
    note: o.note,
    createdAt: o.createdAt.toISOString(),
    returnCount: o._count.returnRequests,
  }));

  return (
    <div>
      <h1 className="font-serif text-3xl">Orders</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {hasFilters
          ? `${orders.length} of ${totalCount} order${totalCount === 1 ? "" : "s"} match your filters`
          : `${totalCount} order${totalCount === 1 ? "" : "s"}`}
      </p>

      <div className="mt-6">
        <OrderFilters />
      </div>

      {orders.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-border p-12 text-center">
          <ShoppingCart className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-4 font-serif text-xl">
            {hasFilters ? "No orders match" : "No orders yet"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {hasFilters
              ? "Try widening your filters or switching to “ANY condition”."
              : "Orders placed on your store will appear here."}
          </p>
        </div>
      ) : (
        <div className="mt-6">
          <OrdersTable
            orders={orders}
            returnWindowDays={settings.returnsEnabled ? settings.returnWindowDays : null}
          />
        </div>
      )}
    </div>
  );
}
