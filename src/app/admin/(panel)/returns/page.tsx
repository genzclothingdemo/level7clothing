import Link from "next/link";
import Image from "next/image";
import { PackageX, ExternalLink, AlertTriangle, Clock } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { formatINR } from "@/lib/utils";
import { InfoTip } from "@/components/store/info-tip";
import { ExpandableText } from "@/components/store/expandable-text";
import { ReturnPolicyForm } from "@/components/admin/return-defaults";
import { ReturnFilters } from "@/components/admin/return-filters";
import { ReturnActions } from "@/components/admin/return-actions";
import {
  DEFAULT_REFUND_SETTINGS,
  OPEN_RETURN_STATUSES,
  OUR_FAULT_PATTERNS,
  OUR_FAULT_REASONS,
  REFUND_METHOD_LABEL,
  RETURN_STATUSES,
  RETURN_STATUS_COLOR,
  RETURN_STATUS_LABEL,
  computeRefund,
  formatReturnDate,
  isOurFaultReason,
  isRefundMethod,
  isReturnStatus,
  normaliseReturnReasons,
  returnReasonLabel,
  type ReturnStatus,
} from "@/lib/returns";

export const dynamic = "force-dynamic";
export const metadata = { title: "Returns" };

const PAGE_SIZE = 100;
const DAY = 86_400_000;

/** The two halves of this screen. Policy is set once; requests are worked daily. */
const TABS = [
  { key: "requests", label: "Return requests" },
  { key: "policy", label: "Return policy" },
] as const;

type Tab = (typeof TABS)[number]["key"];

/**
 * Wall clock for the age filters and the "waiting Nd" badges. Read through an
 * async boundary rather than calling Date.now() in the render body: this page is
 * force-dynamic so the value is genuinely per-request, but a bare impure call in
 * a component body is the pattern the purity rule (rightly) rejects.
 */
async function readClock(): Promise<number> {
  return Date.now();
}

/**
 * The return policy, read straight from the settings row.
 *
 * Not `getSettings()`: that DTO predates `returnReasons` / `returnPolicyNote`,
 * and this screen is their only editor. A failed read falls back to the same
 * defaults the schema declares, so the form still renders during a DB blip —
 * it just can't save until the database is back.
 */
async function readPolicy() {
  const row = await prisma.siteSettings
    .findUnique({
      where: { id: "main" },
      select: {
        returnsEnabled: true,
        defaultReturnable: true,
        returnWindowDays: true,
        defaultReturnsInfo: true,
        returnReasons: true,
        returnPolicyNote: true,
        nimbusEnabled: true,
        refundFeePercent: true,
        refundFeeFlat: true,
        partialAdvanceRefundable: true,
        waiveRefundFeeOnOurFault: true,
        refundPolicyNote: true,
      },
    })
    .catch(() => null);

  return {
    returnsEnabled: row?.returnsEnabled ?? DEFAULT_SETTINGS.returnsEnabled,
    defaultReturnable: row?.defaultReturnable ?? DEFAULT_SETTINGS.defaultReturnable,
    returnWindowDays: row?.returnWindowDays ?? DEFAULT_SETTINGS.returnWindowDays,
    defaultReturnsInfo: row?.defaultReturnsInfo ?? DEFAULT_SETTINGS.defaultReturnsInfo,
    returnReasons: normaliseReturnReasons(row?.returnReasons),
    returnPolicyNote: row?.returnPolicyNote ?? "",
    nimbusEnabled: row?.nimbusEnabled ?? DEFAULT_SETTINGS.nimbusEnabled,
    // The money rules. A failed read falls back to "no fee" rather than to a
    // guess — inventing a deduction is the one wrong answer here.
    refund: {
      refundFeePercent:
        row?.refundFeePercent ?? DEFAULT_REFUND_SETTINGS.refundFeePercent,
      refundFeeFlat: row?.refundFeeFlat ?? DEFAULT_REFUND_SETTINGS.refundFeeFlat,
      partialAdvanceRefundable:
        row?.partialAdvanceRefundable ??
        DEFAULT_REFUND_SETTINGS.partialAdvanceRefundable,
      waiveRefundFeeOnOurFault:
        row?.waiveRefundFeeOnOurFault ??
        DEFAULT_REFUND_SETTINGS.waiveRefundFeeOnOurFault,
    },
    refundPolicyNote: row?.refundPolicyNote ?? "",
  };
}

export default async function AdminReturns({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    status?: string;
    q?: string;
    reason?: string;
    issue?: string;
    age?: string;
  }>;
}) {
  const sp = await searchParams;
  const tab: Tab = sp.tab === "policy" ? "policy" : "requests";
  const status = sp.status || "open";
  const now = await readClock();

  const policy = await readPolicy();

  // Composed as AND parts rather than assigned onto one object: the search and
  // the "our fault" filter both need their own OR, and the last writer would
  // otherwise silently erase the other.
  const and: Prisma.ReturnRequestWhereInput[] = [];

  if (status === "open") and.push({ status: { in: OPEN_RETURN_STATUSES } });
  else if (status !== "all" && isReturnStatus(status)) and.push({ status });

  if (sp.q) {
    and.push({
      OR: [
        { requestNumber: { contains: sp.q, mode: "insensitive" } },
        { productName: { contains: sp.q, mode: "insensitive" } },
        { order: { orderNumber: { contains: sp.q, mode: "insensitive" } } },
        { order: { customerName: { contains: sp.q, mode: "insensitive" } } },
        { order: { phone: { contains: sp.q, mode: "insensitive" } } },
      ],
    });
  }

  if (sp.reason === "our_fault") {
    // Reasons are admin-authored text now, so this matches the same patterns
    // `isOurFaultReason` uses for the badge — the list and the badge agree.
    and.push({
      OR: [
        { reason: { in: OUR_FAULT_REASONS } },
        ...OUR_FAULT_PATTERNS.map((p) => ({
          reason: { contains: p, mode: "insensitive" as const },
        })),
      ],
    });
  } else if (sp.reason) {
    and.push({ reason: sp.reason });
  }

  // "Pickup failed" = approved, meant to have a courier, but none was booked.
  if (sp.issue === "pickup") {
    and.push({ status: "approved", nimbusError: { not: null } });
  }

  if (sp.age === "today") and.push({ createdAt: { gte: new Date(now - DAY) } });
  else if (sp.age === "7") and.push({ createdAt: { gte: new Date(now - 7 * DAY) } });
  else if (sp.age === "30") and.push({ createdAt: { gte: new Date(now - 30 * DAY) } });
  else if (sp.age === "stale") {
    // Only unresolved requests can be "waiting" — a refunded one isn't stale.
    and.push({ createdAt: { lte: new Date(now - 3 * DAY) }, resolvedAt: null });
  }

  const where: Prisma.ReturnRequestWhereInput = and.length ? { AND: and } : {};

  // The policy tab needs the queue count for its tab badge, nothing more —
  // skip the list query entirely rather than paying for 100 rows nobody sees.
  const [requests, grouped, openCount] = await Promise.all([
    tab === "requests"
      ? prisma.returnRequest
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
                  // The refund maths needs the money columns, plus every other
                  // return on the same order so an earlier payout is counted
                  // against the pot before this one is offered.
                  total: true,
                  amountPaid: true,
                  balanceDue: true,
                  subtotal: true,
                  discountTotal: true,
                  status: true,
                  paymentStatus: true,
                  returnRequests: {
                    select: { id: true, status: true, refundAmount: true },
                  },
                },
              },
            },
          })
          .catch(() => [])
      : [],
    tab === "requests"
      ? prisma.returnRequest
          .groupBy({ by: ["status"], _count: { _all: true } })
          .catch(() => [] as { status: string; _count: { _all: number } }[])
      : [],
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
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="font-serif text-2xl">Returns</h1>
        <p className="text-sm text-muted-foreground">
          {policy.returnsEnabled ? (
            <>
              Open · {policy.returnWindowDays}-day window
              <InfoTip term="Return window">
                Counted from the courier&apos;s delivery scan, or the order date
                when an order was marked delivered by hand. Requests after it are
                refused by the server, not just hidden.
              </InfoTip>
            </>
          ) : (
            <span className="text-danger">Returns are switched off</span>
          )}
        </p>
      </div>

      {/* Tab bar — a link each, so a filtered queue stays shareable and the
          back button works. */}
      <div className="mt-3 flex gap-1 border-b border-border">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <Link
              key={t.key}
              href={t.key === "requests" ? "/admin/returns" : "/admin/returns?tab=policy"}
              className={`-mb-px inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-medium transition-colors ${
                active
                  ? "border-accent text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
              {t.key === "requests" && openCount > 0 && (
                <span
                  className={`rounded-full px-1.5 text-xs ${
                    active ? "bg-accent/15 text-accent" : "bg-muted"
                  }`}
                >
                  {openCount}
                </span>
              )}
            </Link>
          );
        })}
      </div>

      {tab === "policy" ? (
        <div className="mt-4 max-w-2xl">
          <ReturnPolicyForm
            initial={{
              returnsEnabled: policy.returnsEnabled,
              defaultReturnable: policy.defaultReturnable,
              returnWindowDays: policy.returnWindowDays,
              defaultReturnsInfo: policy.defaultReturnsInfo,
              returnReasons: policy.returnReasons,
              returnPolicyNote: policy.returnPolicyNote,
              refundFeePercent: policy.refund.refundFeePercent,
              refundFeeFlat: policy.refund.refundFeeFlat,
              partialAdvanceRefundable: policy.refund.partialAdvanceRefundable,
              waiveRefundFeeOnOurFault: policy.refund.waiveRefundFeeOnOurFault,
              refundPolicyNote: policy.refundPolicyNote,
            }}
            todayISO={new Date(now).toISOString()}
          />
        </div>
      ) : (
        <div className="mt-4">
          <ReturnFilters counts={counts} reasons={policy.returnReasons} />

          {requests.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-border p-10 text-center">
              <PackageX className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 font-serif text-lg">
                {narrowed || status !== "open"
                  ? "No matching requests"
                  : "Nothing to action"}
              </p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
                {narrowed || status !== "open"
                  ? "Try clearing the filters."
                  : counts.all === 0
                    ? "Customers raise returns from their order page, inside the return window."
                    : "Every request has been dealt with."}
              </p>
            </div>
          ) : (
            <div className="mt-4 space-y-2.5">
              {requests.map((r) => {
                const s = (isReturnStatus(r.status) ? r.status : "pending") as ReturnStatus;
                const waitingDays = Math.floor((now - r.createdAt.getTime()) / DAY);
                const stale = s === "pending" && waitingDays >= 3;
                const lineTotal = r.unitPrice * r.quantity;

                // The same `computeRefund` the approval action re-runs, and
                // the same one the customer's form previews with. Earlier
                // refunds on this order are subtracted; this request's own
                // figure is excluded so it isn't counted against itself.
                const refund = computeRefund({
                  order: {
                    total: r.order.total,
                    amountPaid: r.order.amountPaid,
                    balanceDue: r.order.balanceDue,
                    subtotal: r.order.subtotal,
                    discountTotal: r.order.discountTotal,
                    status: r.order.status,
                    paymentStatus: r.order.paymentStatus,
                    alreadyRefunded: r.order.returnRequests.reduce(
                      (sum, o) =>
                        o.id === r.id ||
                        o.status === "rejected" ||
                        o.status === "cancelled"
                          ? sum
                          : sum + (o.refundAmount ?? 0),
                      0
                    ),
                  },
                  lines: [{ unitPrice: r.unitPrice, quantity: r.quantity }],
                  settings: policy.refund,
                  reason: r.reason,
                });

                return (
                  <div
                    key={r.id}
                    className={`rounded-xl border bg-card p-3.5 ${
                      r.nimbusError && s === "approved"
                        ? "border-danger/40"
                        : stale
                          ? "border-accent/40"
                          : "border-border"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 basis-64">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-sm font-medium">
                            {r.requestNumber}
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${RETURN_STATUS_COLOR[s]}`}
                          >
                            {RETURN_STATUS_LABEL[s]}
                          </span>
                          {isOurFaultReason(r.reason) && (
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

                        <p className="mt-0.5 break-words text-xs text-muted-foreground">
                          <Link
                            href={`/admin/orders?q=${encodeURIComponent(r.order.orderNumber)}`}
                            className="inline-flex items-center gap-1 hover:text-accent"
                          >
                            {r.order.orderNumber}
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                          {" · "}
                          {r.order.customerName} · {r.order.phone} · {r.order.city},{" "}
                          {r.order.state} {r.order.pincode} · {r.order.paymentMethod}
                        </p>

                        <div className="mt-2 text-xs">
                          <span className="font-medium">{returnReasonLabel(r.reason)}</span>
                          {r.customerNote && (
                            <ExpandableText
                              lines={2}
                              contentClassName="text-muted-foreground"
                              className="mt-0.5"
                            >
                              {`“${r.customerNote}”`}
                            </ExpandableText>
                          )}
                        </div>

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
                          <p className="mt-2 rounded-lg bg-muted/50 px-2.5 py-1.5 text-xs text-muted-foreground">
                            <b>Sent to customer:</b> {r.adminNote}
                          </p>
                        )}

                        {/* The figures fixed at the decision — deliberately
                            the stored ones, not a fresh calculation, so a
                            later fee change can't rewrite what went out. */}
                        {r.refundAmount != null && (
                          <div className="mt-1.5 rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-xs">
                            <p className="flex flex-wrap items-baseline gap-x-1.5">
                              <span className="text-muted-foreground">
                                {r.refundedAt ? "Refunded" : "Refund agreed"}:
                              </span>
                              <b className="tabular-nums">
                                {formatINR(r.refundAmount)}
                              </b>
                              {r.refundGross != null && r.refundFee ? (
                                <span className="text-muted-foreground tabular-nums">
                                  ({formatINR(r.refundGross)} − {formatINR(r.refundFee)}{" "}
                                  fee)
                                </span>
                              ) : null}
                              {r.refundMethod && isRefundMethod(r.refundMethod) && (
                                <span className="text-muted-foreground">
                                  · {REFUND_METHOD_LABEL[r.refundMethod]}
                                </span>
                              )}
                            </p>
                            {r.refundUpi && (
                              <p className="break-all text-muted-foreground">
                                UPI: <b className="font-mono">{r.refundUpi}</b>
                              </p>
                            )}
                            {r.refundReference && (
                              <p className="break-all text-muted-foreground">
                                Ref: <b className="font-mono">{r.refundReference}</b>
                                {r.refundedAt
                                  ? ` · ${formatReturnDate(r.refundedAt)}`
                                  : ""}
                              </p>
                            )}
                            {!r.refundedAt && r.refundAmount > 0 && (
                              <p className="text-muted-foreground">
                                Not paid out yet.
                              </p>
                            )}
                          </div>
                        )}
                      </div>

                      <ReturnActions
                        id={r.id}
                        status={s}
                        refund={refund}
                        recorded={{
                          gross: r.refundGross,
                          fee: r.refundFee,
                          net: r.refundAmount,
                          method: r.refundMethod,
                          upi: r.refundUpi,
                        }}
                        nimbusError={r.nimbusError}
                        nimbusOrderId={r.nimbusOrderId}
                        nimbusEnabled={policy.nimbusEnabled}
                      />
                    </div>
                  </div>
                );
              })}

              {requests.length === PAGE_SIZE && (
                <p className="pt-1 text-center text-xs text-muted-foreground">
                  Showing the first {PAGE_SIZE} matches — narrow the filters to
                  see the rest.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
