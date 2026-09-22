import Link from "next/link";
import Image from "next/image";
import { PackageX, ExternalLink, AlertTriangle, Clock, Truck } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { formatINR } from "@/lib/utils";
import { InfoTip } from "@/components/store/info-tip";
import { ExpandableText } from "@/components/store/expandable-text";
import { ReturnPolicySummary } from "@/components/admin/return-policy-summary";
import { ReturnableBulk } from "@/components/admin/returnable-bulk";
import { listReturnableProducts } from "@/app/actions/returns";
import { ReturnFilters } from "@/components/admin/return-filters";
import { ReturnActions } from "@/components/admin/return-actions";
import { ReturnRto } from "@/components/admin/return-rto";
import { listRtoOrders } from "@/lib/nimbus-returns";
import {
  OPEN_RETURN_STATUSES,
  OUR_FAULT_PATTERNS,
  OUR_FAULT_REASONS,
  REFUND_METHOD_LABEL,
  REVERSE_LEG_LABEL,
  RETURN_STATUSES,
  RETURN_STATUS_COLOR,
  RETURN_STATUS_LABEL,
  computeRefund,
  formatReturnDate,
  isOurFaultReason,
  isRefundMethod,
  isReturnStatus,
  normaliseReturnReasons,
  outcomeOfRefundMethod,
  returnReasonLabel,
  reverseLegOf,
  type RefundMethod,
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
 * Not `getSettings()`: that DTO predates `returnReasons` / `returnPolicyNote`.
 * A failed read falls back to the same defaults the schema declares, so the
 * screen still renders during a DB blip.
 *
 * This page no longer **edits** any of it — the editor moved to Admin →
 * Settings so `SiteSettings` keeps one writer per field. What is read here
 * feeds the read-only summary, the per-product picker's "what does this resolve
 * to" column, and the refund figures on the queue.
 */
async function readPolicy() {
  const row = await prisma.siteSettings
    .findUnique({
      where: { id: "main" },
      select: {
        returnsEnabled: true,
        defaultReturnable: true,
        returnWindowDays: true,
        returnReasons: true,
        nimbusEnabled: true,
        // Owned by Settings → Payments. Read-only here: it decides whether the
        // part-paid advance rule can apply at all.
        partialEnabled: true,
      },
    })
    .catch(() => null);

  return {
    returnsEnabled: row?.returnsEnabled ?? DEFAULT_SETTINGS.returnsEnabled,
    defaultReturnable: row?.defaultReturnable ?? DEFAULT_SETTINGS.defaultReturnable,
    returnWindowDays: row?.returnWindowDays ?? DEFAULT_SETTINGS.returnWindowDays,
    returnReasons: normaliseReturnReasons(row?.returnReasons),
    nimbusEnabled: row?.nimbusEnabled ?? DEFAULT_SETTINGS.nimbusEnabled,
    partialEnabled: row?.partialEnabled ?? DEFAULT_SETTINGS.partialEnabled,
    // No refund columns are read here any more. A return is a full refund of
    // the goods — `computeRefund` cannot be handed a fee — so a stale or
    // unreadable settings row can no longer change what a refund comes to.
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
  // Only the policy tab renders the product picker, so the catalogue read is
  // skipped entirely on the queue.
  const products = tab === "policy" ? await listReturnableProducts() : [];

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

  // "Awaiting collection" — the queue the draft-first flow creates. A staged
  // draft with no AWB is a pickup nobody has booked, which looks identical to a
  // booked one on a status badge alone and can sit there for weeks.
  if (sp.issue === "unbooked") {
    and.push({
      status: { in: ["approved", "picked_up"] },
      nimbusAwb: null,
      nimbusError: null,
    });
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
  const [requests, grouped, openCount, rto] = await Promise.all([
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
                  // Never refunded, and named in the breakdown so the owner can
                  // explain the gap between the order total and the refund.
                  shipping: true,
                  paymentFee: true,
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
    // Goods coming back with no return behind them. Only the queue shows these;
    // the policy tab is about rules, not today's parcels.
    tab === "requests" ? listRtoOrders() : [],
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
        <div className="mt-4 max-w-2xl space-y-4">
          {/* The rules, stated but not editable — they are written at Admin →
              Settings so `SiteSettings` keeps one writer per field. */}
          <ReturnPolicySummary
            policy={{
              returnsEnabled: policy.returnsEnabled,
              defaultReturnable: policy.defaultReturnable,
              returnWindowDays: policy.returnWindowDays,
              returnReasons: policy.returnReasons,
              partialEnabled: policy.partialEnabled,
            }}
          />

          {/* Per-product exceptions. They belong here rather than in Settings:
              this acts on the catalogue, not on the policy, and it only makes
              sense once the store default above has been decided. */}
          <ReturnableBulk
            products={products}
            policy={{
              returnsEnabled: policy.returnsEnabled,
              defaultReturnable: policy.defaultReturnable,
            }}
          />
        </div>
      ) : (
        <div className="mt-4">
          <ReturnFilters counts={counts} reasons={policy.returnReasons} />

          <ReturnRto orders={rto} />

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

                // Where the parcel is, as opposed to what the status word says.
                // A "drafted" leg is the one that hides: the return reads
                // Approved, the pickup is staged, and nobody has booked it.
                const leg = reverseLegOf({
                  status: s,
                  nimbusOrderId: r.nimbusOrderId,
                  nimbusAwb: r.nimbusAwb,
                  nimbusError: r.nimbusError,
                });

                // The same `computeRefund` the approval action re-runs, and
                // the same one the customer's form previews with. Earlier
                // refunds on this order are subtracted; this request's own
                // figure is excluded so it isn't counted against itself.
                // What the customer asked for, read off the stored method. The
                // panel opens on their choice rather than defaulting every
                // request to "send the money back".
                const storedMethod = isRefundMethod(r.refundMethod ?? "")
                  ? (r.refundMethod as RefundMethod)
                  : null;
                const outcome = outcomeOfRefundMethod(storedMethod);

                const refund = computeRefund({
                  order: {
                    total: r.order.total,
                    amountPaid: r.order.amountPaid,
                    balanceDue: r.order.balanceDue,
                    subtotal: r.order.subtotal,
                    shipping: r.order.shipping,
                    paymentFee: r.order.paymentFee,
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
                  reason: r.reason,
                  outcome,
                  destination: storedMethod === "upi" ? "upi" : undefined,
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
                          {/* Only the states that need a human. "Back with you"
                              and "no pickup" are already said elsewhere on the
                              card, and "failed" has its own badge above. */}
                          {(leg === "drafted" ||
                            leg === "booked" ||
                            leg === "in_transit") && (
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                leg === "drafted"
                                  ? "bg-accent/15 text-accent"
                                  : "bg-muted text-muted-foreground"
                              }`}
                            >
                              <Truck className="h-3 w-3" />
                              {REVERSE_LEG_LABEL[leg].toLowerCase()}
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
                        {/* What the customer asked for, before any decision.
                            Shown on every request, because "they want a
                            different size" is the first thing the reviewer
                            needs and it used to be buried in the note. */}
                        {outcome !== "refund" && (
                          <p className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                            {outcome === "replace"
                              ? "Wants a replacement"
                              : "Wants a different size"}
                            {" · no refund"}
                          </p>
                        )}

                        {r.refundAmount != null && (
                          <div className="mt-1.5 rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-xs">
                            <p className="flex flex-wrap items-baseline gap-x-1.5">
                              <span className="text-muted-foreground">
                                {r.refundedAt ? "Refunded" : "Refund agreed"}:
                              </span>
                              <b className="tabular-nums">
                                {formatINR(r.refundAmount)}
                              </b>
                              {/* Only ever non-zero on a row decided under the
                                  old fee policy. History reads as it was
                                  agreed; nothing new can produce one. */}
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
                        nimbusAwb={r.nimbusAwb}
                        nimbusCourier={r.nimbusCourier}
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
