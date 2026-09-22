import Image from "next/image";
import Link from "next/link";
import { Users } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { formatINR } from "@/lib/utils";
import { LeadActions } from "@/components/admin/lead-actions";
import { LeadFilters } from "@/components/admin/lead-filters";
import { LEAD_STATUS_COLOR, LEAD_STATUS_LABEL, isLeadStatus } from "@/lib/leads";
import { adminLink, customerIdForContact } from "@/lib/customers";

export const dynamic = "force-dynamic";
export const metadata = { title: "Interested customers" };

export default async function AdminLeads({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const { status, q } = await searchParams;

  const where: Prisma.LeadWhereInput = {};
  if (status && isLeadStatus(status)) where.status = status;
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { phone: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
      { productName: { contains: q, mode: "insensitive" } },
    ];
  }

  const [leads, grouped, total] = await Promise.all([
    prisma.lead
      .findMany({ where, orderBy: { createdAt: "desc" }, take: 300 })
      .catch(() => []),
    prisma.lead.groupBy({ by: ["status"], _count: { _all: true } }).catch(
      () => [] as { status: string; _count: { _all: number } }[]
    ),
    prisma.lead.count().catch(() => 0),
  ]);

  const counts: Record<string, number> = { all: total };
  for (const g of grouped) counts[g.status] = g._count._all;

  return (
    <div>
      <h1 className="font-serif text-2xl">Interested customers</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Everyone who added a product to their cart — your warm leads. Update their
        status and jot notes as you follow up.
      </p>

      <div className="mt-6">
        <LeadFilters counts={counts} />
      </div>

      {leads.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-border p-12 text-center">
          <Users className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-4 font-serif text-xl">No matching customers</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {status || q
              ? "Try clearing the filters."
              : "When visitors add products to their cart, they'll show up here."}
          </p>
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-2xl border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Customer</th>
                  <th className="px-4 py-3 font-medium">Product</th>
                  <th className="px-4 py-3 font-medium">When</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">
                    Manage &amp; notes
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {leads.map((l) => {
                  // A lead is one sighting of a person who may also have an
                  // account, orders, a chat and a wishlist. `customerId` is
                  // null only when the row has neither email nor phone, which
                  // is exactly when there is nobody to link to.
                  const customerId = customerIdForContact({
                    email: l.email,
                    phone: l.phone,
                  });
                  return (
                  <tr key={l.id} className="align-top hover:bg-muted/40">
                    <td className="px-4 py-3">
                      {l.name || l.email || l.phone ? (
                        <div className="text-muted-foreground">
                          {l.name && (
                            <p className="font-medium text-foreground">
                              {l.name}
                            </p>
                          )}
                          {l.phone && (
                            <a
                              href={`tel:${l.phone}`}
                              className="hover:text-accent"
                            >
                              {l.phone}
                            </a>
                          )}
                          {l.email && (
                            <p>
                              <a
                                href={`mailto:${l.email}`}
                                className="hover:text-accent"
                              >
                                {l.email}
                              </a>
                            </p>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Guest ({l.visitorId?.slice(0, 6) || "—"})
                        </span>
                      )}
                      {customerId && (
                        <Link
                          href={adminLink.customer(customerId)}
                          className="mt-1 inline-flex min-h-9 items-center text-[11px] uppercase tracking-wider text-muted-foreground hover:text-accent"
                          title="Everything this person has done — orders, chats, returns, wishlist"
                        >
                          Customer record →
                        </Link>
                      )}
                      {l.notes && (
                        <p className="mt-1.5 max-w-[16rem] rounded-lg bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
                          {l.notes}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-muted">
                          {l.productImage && (
                            <Image
                              src={l.productImage}
                              alt={l.productName}
                              fill
                              sizes="40px"
                              className="object-cover"
                            />
                          )}
                        </div>
                        <div className="min-w-0">
                          {/* A lead is only actionable if you can get to the
                              piece it was raised on. `productId` was stored
                              but never linked. It is nullable, and the product
                              may since have been deleted, so fall back to
                              plain text rather than a dead link. */}
                          {l.productId ? (
                            <Link
                              href={`/admin/products/${l.productId}/edit`}
                              className="block truncate font-medium hover:text-accent hover:underline"
                              title={`Edit ${l.productName}`}
                            >
                              {l.productName}
                            </Link>
                          ) : (
                            <p className="truncate font-medium">{l.productName}</p>
                          )}
                          <p className="text-xs text-muted-foreground">
                            Qty {l.quantity}
                            {l.price != null ? ` · ${formatINR(l.price)}` : ""}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {l.createdAt.toLocaleString("en-IN")}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs ${
                          isLeadStatus(l.status)
                            ? LEAD_STATUS_COLOR[l.status]
                            : "bg-muted"
                        }`}
                      >
                        {isLeadStatus(l.status)
                          ? LEAD_STATUS_LABEL[l.status]
                          : l.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <LeadActions
                        id={l.id}
                        status={l.status}
                        notes={l.notes}
                      />
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
