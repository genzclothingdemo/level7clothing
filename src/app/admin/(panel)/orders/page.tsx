import { ShoppingCart } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { getPipelineSettings } from "@/lib/fulfilment";
import { PIPELINE_DEFAULTS } from "@/lib/orders-pipeline";
import { OrdersTable, type AdminOrder } from "@/components/admin/orders-table";
import type { StatusEntry } from "@/components/admin/order-types";
import { OrderFilters } from "@/components/admin/order-filters";
import { OrderPipelinePanel } from "@/components/admin/order-pipeline-panel";
import {
  OrderPagination,
  ORDERS_PAGE_SIZE,
  parsePageParam,
} from "@/components/admin/order-pagination";

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
  /** "1" = only orders flagged as needing customisation. */
  custom?: string;
  match?: string;
  /** 1-based page number. Absent means page 1. */
  page?: string;
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

  // Made-to-order baskets. The column is denormalised at checkout, so this
  // finds orders placed since the flag existed; the list still badges older
  // orders whose products are customisable today.
  if (sp.custom === "1") conditions.push({ needsCustomisation: true });

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

  // Paged in SQL, not in memory. An orders table only grows, and every row
  // carries its whole item list — shipping a year of orders into the RSC
  // payload to render 25 of them is the kind of thing that turns a 0.3 s page
  // into a 4 s one (see the region note in CLAUDE.md).
  const [matchCount, totalCount, settings, pipeline] = await Promise.all([
    prisma.order.count({ where }).catch(() => 0),
    prisma.order.count().catch(() => 0),
    getSettings(),
    getPipelineSettings().catch(() => PIPELINE_DEFAULTS),
  ]);

  const totalPages = Math.max(1, Math.ceil(matchCount / ORDERS_PAGE_SIZE));
  // Clamped, so a stale `?page=9` from a wider filter lands on the last page
  // of results rather than on a blank screen that reads as "no orders".
  const page = Math.min(parsePageParam(sp.page), totalPages);

  const raw = await prisma.order
    .findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * ORDERS_PAGE_SIZE,
      take: ORDERS_PAGE_SIZE,
      // Return count per order so the list can show "1 return" without the
      // admin opening each card to find out.
      include: { _count: { select: { returnRequests: true } } },
    })
    .catch(() => []);

  // Line items store the productId but not the slug, so resolve the storefront
  // slug for every product these orders reference — that's what turns a line
  // item into a clickable product link. A product deleted since the order was
  // placed simply has no slug, and renders without a link.
  //
  // The same lookup carries the customisation fields: the order knows *that*
  // it needs customising, only the catalogue knows *what* has to be collected.
  const productIds = [
    ...new Set(
      raw.flatMap((o) =>
        (Array.isArray(o.items) ? (o.items as { productId?: string }[]) : [])
          .map((i) => i.productId)
          .filter((id): id is string => !!id)
      )
    ),
  ];
  const productById = new Map(
    (productIds.length
      ? await prisma.product
          .findMany({
            where: { id: { in: productIds } },
            select: {
              id: true,
              slug: true,
              isCustomisable: true,
              customisationNote: true,
            },
          })
          .catch(() => [])
      : []
    ).map((p) => [p.id, p])
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
      (it) => {
        const p = it.productId ? productById.get(it.productId) : undefined;
        return {
          ...it,
          slug: p?.slug ?? null,
          isCustomisable: p?.isCustomisable ?? false,
          customisationNote: p?.customisationNote ?? null,
        };
      }
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
    customerNote: o.customerNote,
    needsCustomisation: o.needsCustomisation,
    statusHistory: (Array.isArray(o.statusHistory)
      ? o.statusHistory
      : []) as unknown as StatusEntry[],
    createdAt: o.createdAt.toISOString(),
    returnCount: o._count.returnRequests,
  }));

  return (
    <div>
      <h1 className="font-serif text-3xl">Orders</h1>
      <p className="mt-1 text-sm text-muted-foreground tabular-nums">
        {hasFilters
          ? `${matchCount} of ${totalCount} order${totalCount === 1 ? "" : "s"} match your filters`
          : `${totalCount} order${totalCount === 1 ? "" : "s"}`}
        {totalPages > 1 ? ` · page ${page} of ${totalPages}` : ""}
      </p>

      <div className="mt-4 space-y-2">
        <OrderPipelinePanel settings={pipeline} />
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
        <div className="mt-3">
          <OrdersTable
            orders={orders}
            returnWindowDays={settings.returnsEnabled ? settings.returnWindowDays : null}
            totalMatching={matchCount}
          />
          <OrderPagination
            page={page}
            totalPages={totalPages}
            total={matchCount}
            pageSize={ORDERS_PAGE_SIZE}
            params={sp}
          />
        </div>
      )}
    </div>
  );
}
