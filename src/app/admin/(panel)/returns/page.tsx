import Link from "next/link";
import Image from "next/image";
import { PackageX, ExternalLink, AlertTriangle, Clock } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { formatINR } from "@/lib/utils";
import { ReturnDefaults } from "@/components/admin/return-defaults";
import { ReturnFilters } from "@/components/admin/return-filters";
import { ReturnActions } from "@/components/admin/return-actions";
import {
  OPEN_RETURN_STATUSES,
  OUR_FAULT_REASONS,
  RETURN_STATUSES,
  RETURN_STATUS_COLOR,
  RETURN_STATUS_LABEL,
  isReturnStatus,
  returnReasonLabel,
  type ReturnStatus,
} from "@/lib/returns";

export const dynamic = "force-dynamic";
export const metadata = { title: "Returns" };

const PAGE_SIZE = 100;
const DAY = 86_400_000;

/**
 * Wall clock for the age filters and the "waiting Nd" badges. Read through an
 * async boundary rather than calling Date.now() in the render body: this page is
 * force-dynamic so the value is genuinely per-request, but a bare impure call in
 * a component body is the pattern the purity rule (rightly) rejects.
 */
async function readClock(): Promise<number> {
  return Date.now();
}

export default async function AdminReturns({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    q?: string;
    reason?: string;
    issue?: string;
    age?: string;
  }>;
}) {
  const sp = await searchParams;
  const status = sp.status || "open";
  const now = await readClock();

  const where: Prisma.ReturnRequestWhereInput = {};
  if (status === "open") where.status = { in: OPEN_RETURN_STATUSES };
  else if (status !== "all" && isReturnStatus(status)) where.status = status;

  if (sp.q) {
    where.OR = [
      { requestNumber: { contains: sp.q, mode: "insensitive" } },
      { productName: { contains: sp.q, mode: "insensitive" } },
      { order: { orderNumber: { contains: sp.q, mode: "insensitive" } } },
      { order: { customerName: { contains: sp.q, mode: "insensitive" } } },
      { order: { phone: { contains: sp.q, mode: "insensitive" } } },
    ];
  }
  if (sp.reason === "our_fault") where.reason = { in: OUR_FAULT_REASONS };
  else if (sp.reason) where.reason = sp.reason;

  // "Pickup failed" = approved, meant to have a courier, but none was booked.
  if (sp.issue === "pickup") {
    where.status = "approved";
    where.nimbusError = { not: null };
  }

  if (sp.age === "today") where.createdAt = { gte: new Date(now - DAY) };
  else if (sp.age === "7") where.createdAt = { gte: new Date(now - 7 * DAY) };
  else if (sp.age === "30") where.createdAt = { gte: new Date(now - 30 * DAY) };
  else if (sp.age === "stale") {
    // Only unresolved requests can be "waiting" — a refunded one isn't stale.
    where.createdAt = { lte: new Date(now - 3 * DAY) };
    where.resolvedAt = null;
  }

  const [requests, grouped, settings, openCount] = await Promise.all([
    prisma.returnRequest
      .findMany({
        where,
        // Oldest first inside the action queue: the customer who has waited
        // longest gets seen first. Audit views stay newest-first.
        orderBy: status === "open" ? { createdAt: "asc" } : { createdAt: "desc" },
        take: PAGE_SIZE,
        include: {
          order: {
            select: {
              orderNumber: true,
              customerName: true,
              phone: true,
              city: true,
              state: true,
              pincode: true,
              paymentMethod: true,
            },
          },
        },
      })
      .catch(() => []),
    prisma.returnRequest
      .groupBy({ by: ["status"], _count: { _all: true } })
      .catch(() => [] as { status: string; _count: { _all: number } }[]),
    getSettings(),
    prisma.returnRequest
      .count({ where: { status: { in: OPEN_RETURN_STATUSES } } })
      .catch(() => 0),
  ]);

  const counts: Record<string, number> = { all: 0, open: openCount };
  for (const s of RETURN_STATUSES) counts[s] = 0;
  for (const g of grouped) {
    counts[g.status] = g._count._all;
    counts.all += g._count._all;
  }

  const narrowed = !!(sp.q || sp.reason || sp.issue || sp.age);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-serif text-3xl">Returns</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Set the store-wide policy, then review what customers send back.
          Approving drafts a reverse pickup in NimbusPost — the courier collects
          from the customer and brings it to your warehouse.
        </p>
      </div>

      <ReturnDefaults
        initial={{
          returnsEnabled: settings.returnsEnabled,
          defaultReturnable: settings.defaultReturnable,
          returnWindowDays: settings.returnWindowDays,
          defaultReturnsInfo: settings.defaultReturnsInfo,
        }}
      />

      <div>
        <h2 className="font-serif text-xl">Return requests</h2>
        <div className="mt-4">
          <ReturnFilters counts={counts} />
        </div>

        {requests.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-border p-12 text-center">
            <PackageX className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-4 font-serif text-xl">
              {narrowed || status !== "open"
                ? "No matching requests"
                : "Nothing to action"}
            </p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              {narrowed || status !== "open"
                ? "Try clearing the filters."
                : counts.all === 0
                  ? "Customers raise returns from their order page once an order is delivered. They'll appear here for you to approve or reject."
                  : "Every request has been dealt with."}
            </p>
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            {requests.map((r) => {
              const s = (isReturnStatus(r.status) ? r.status : "pending") as ReturnStatus;
              const waitingDays = Math.floor((now - r.createdAt.getTime()) / DAY);
              const stale = s === "pending" && waitingDays >= 3;
              const lineTotal = r.unitPrice * r.quantity;

              return (
                <div
                  key={r.id}
                  className={`rounded-2xl border bg-card p-4 ${
                    r.nimbusError && s === "approved"
                      ? "border-danger/40"
                      : stale
                        ? "border-accent/40"
                        : "border-border"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-medium">
                          {r.requestNumber}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${RETURN_STATUS_COLOR[s]}`}
                        >
                          {RETURN_STATUS_LABEL[s]}
                        </span>
                        {OUR_FAULT_REASONS.includes(r.reason as never) && (
                          <span className="rounded-full bg-danger/10 px-2 py-0.5 text-[10px] font-medium text-danger">
                            Our fault
                          </span>
                        )}
                        {stale && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-medium text-accent">
                            <Clock className="h-3 w-3" /> waiting {waitingDays}d
                          </span>
                        )}
                        {r.nimbusError && s === "approved" && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-danger/15 px-2 py-0.5 text-[10px] font-medium text-danger">
                            <AlertTriangle className="h-3 w-3" /> pickup failed
                          </span>
                        )}
                      </div>

                      <p className="mt-1.5 text-sm">
                        <b>{r.productName}</b>
                        {r.variantLabel && (
                          <span className="text-muted-foreground"> · {r.variantLabel}</span>
                        )}
                        <span className="text-muted-foreground">
                          {" "}
                          × {r.quantity} · {formatINR(lineTotal)}
                        </span>
                      </p>

                      <p className="mt-0.5 text-xs text-muted-foreground">
                        <Link
                          href={`/admin/orders?q=${encodeURIComponent(r.order.orderNumber)}`}
                          className="inline-flex items-center gap-1 hover:text-accent"
                        >
                          {r.order.orderNumber}
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                        {" · "}
                        {r.order.customerName} · {r.order.phone} · {r.order.city},{" "}
                        {r.order.state} {r.order.pincode} · paid by{" "}
                        {r.order.paymentMethod}
                      </p>

                      <p className="mt-2 text-xs">
                        <span className="font-medium">
                          {returnReasonLabel(r.reason)}
                        </span>
                        {r.customerNote && (
                          <span className="text-muted-foreground">
                            {" — “"}
                            {r.customerNote}
                            {"”"}
                          </span>
                        )}
                      </p>

                      {r.images.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {r.images.map((url) => (
                            <a
                              key={url}
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                              className="relative h-14 w-14 overflow-hidden rounded-lg border border-border bg-muted"
                              title="Open full size"
                            >
                              <Image
                                src={decodeURI(url)}
                                alt="Customer photo"
                                fill
                                sizes="56px"
                                className="object-cover"
                              />
                            </a>
                          ))}
                        </div>
                      )}

                      {r.adminNote && (
                        <p className="mt-2 rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                          <b>Sent to customer:</b> {r.adminNote}
                        </p>
                      )}

                      {r.refundAmount != null && (
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          Refund recorded: <b>{formatINR(r.refundAmount)}</b>
                          {r.refundMethod ? ` · ${r.refundMethod}` : ""}
                        </p>
                      )}
                    </div>

                    <ReturnActions
                      id={r.id}
                      status={s}
                      suggestedRefund={lineTotal}
                      nimbusError={r.nimbusError}
                      nimbusOrderId={r.nimbusOrderId}
                      nimbusEnabled={settings.nimbusEnabled}
                    />
                  </div>
                </div>
              );
            })}

            {requests.length === PAGE_SIZE && (
              <p className="pt-2 text-center text-xs text-muted-foreground">
                Showing the first {PAGE_SIZE} matches — narrow the filters to see
                the rest.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
