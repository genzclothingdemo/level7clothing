import Link from "next/link";
import { Plus, Ticket } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { couponStatus, type CouponStatus } from "@/lib/coupons";
import { CouponFilters } from "@/components/admin/coupon-filters";
import { CouponRowActions } from "@/components/admin/coupon-row-actions";
import {
  CouponStatusPill,
  couponLimitSummary,
  couponOfferSummary,
  couponWindowSummary,
  formatStoreDateTime,
} from "@/components/admin/coupon-summary";

export const dynamic = "force-dynamic";
export const metadata = { title: "Coupons" };

type SP = {
  q?: string;
  status?: string;
  type?: string;
  scope?: string;
};

const STATUSES: CouponStatus[] = ["active", "hidden", "scheduled", "expired", "exhausted"];

function isStatus(v: string | undefined): v is CouponStatus {
  return !!v && (STATUSES as string[]).includes(v);
}

/**
 * How much of a limited coupon is gone. Drawn as a bar because "84 / 100" and
 * "8 / 100" look the same at a glance and only one of them needs attention.
 */
function UsageBar({ used, limit }: { used: number; limit: number | null }) {
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  return (
    <div className="min-w-[4.5rem]">
      <p className="whitespace-nowrap text-sm tabular-nums">
        {used} <span className="text-muted-foreground">/ {limit ?? "∞"}</span>
      </p>
      {limit !== null && (
        <span
          aria-hidden="true"
          className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-muted"
        >
          <span
            className={`block h-full rounded-full ${pct >= 100 ? "bg-danger" : "bg-accent"}`}
            style={{ width: `${pct}%` }}
          />
        </span>
      )}
    </div>
  );
}

export default async function AdminCoupons({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const sp = await searchParams;

  const [allCoupons, products] = await Promise.all([
    prisma.coupon.findMany({ orderBy: { createdAt: "desc" } }).catch(() => []),
    prisma.product.findMany({ select: { id: true, name: true } }).catch(() => []),
  ]);
  const productName = new Map(products.map((p) => [p.id, p.name]));

  // Status is derived from four columns at once (active flag, window, usage),
  // so it cannot be a WHERE clause. The list is short enough that narrowing it
  // here costs nothing and keeps one definition of "expired".
  const now = new Date();
  const q = sp.q?.trim().toLowerCase() ?? "";

  const coupons = allCoupons
    .map((c) => ({ coupon: c, status: couponStatus(c, now) }))
    .filter(({ coupon, status }) => {
      if (q && !coupon.code.toLowerCase().includes(q)) return false;
      if (isStatus(sp.status) && status !== sp.status) return false;
      if (sp.type === "percent" && !coupon.isPercentage) return false;
      if (sp.type === "flat" && coupon.isPercentage) return false;
      if (sp.scope === "cart" && coupon.productIds.length > 0) return false;
      if (sp.scope === "products" && coupon.productIds.length === 0) return false;
      return true;
    });

  const filtered = !!(q || sp.status || sp.type || sp.scope);

  /** The scope cell: names the product when there is only one. */
  function scopeLabel(productIds: string[]): string {
    if (!productIds.length) return "Whole cart";
    if (productIds.length === 1) return productName.get(productIds[0]) ?? "1 product";
    return `${productIds.length} products`;
  }

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-serif text-2xl">Coupons</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {filtered
              ? `${coupons.length} of ${allCoupons.length} match`
              : `${allCoupons.length} coupon${allCoupons.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <Link
          href="/admin/coupons/new"
          className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg bg-foreground px-5 text-[11px] font-medium uppercase tracking-widest text-background transition-opacity hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> Add coupon
        </Link>
      </div>

      {allCoupons.length > 0 && (
        <div className="mt-6">
          <CouponFilters />
        </div>
      )}

      {coupons.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-border p-10 text-center sm:p-12">
          <Ticket className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-4 font-serif text-xl">
            {filtered ? "No coupons match" : "No coupons yet"}
          </p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            {filtered
              ? "Try widening the filters."
              : "Create a code to run a sale, thank a customer, or win back an abandoned cart."}
          </p>
          {!filtered && (
            <Link
              href="/admin/coupons/new"
              className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-lg bg-foreground px-5 text-[11px] font-medium uppercase tracking-widest text-background"
            >
              <Plus className="h-4 w-4" /> Add coupon
            </Link>
          )}
        </div>
      ) : (
        <>
          {/* ---- Phone: one card per coupon. A six-column table at 320px is
                   a horizontal scroll nobody reads. ---- */}
          <ul className="mt-6 space-y-3 md:hidden">
            {coupons.map(({ coupon: c, status }) => (
              <li
                key={c.id}
                className="min-w-0 rounded-2xl border border-border bg-card p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 break-all font-mono text-sm font-medium tracking-widest">
                    {c.code}
                  </p>
                  <CouponStatusPill status={status} />
                </div>

                <p className="mt-2 text-sm">{couponOfferSummary(c)}</p>
                {couponLimitSummary(c) && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {couponLimitSummary(c)}
                  </p>
                )}

                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border pt-3 text-xs">
                  <div className="min-w-0">
                    <dt className="text-muted-foreground">Applies to</dt>
                    <dd className="mt-0.5 truncate">{scopeLabel(c.productIds)}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-muted-foreground">Used</dt>
                    <dd className="mt-0.5">
                      <UsageBar used={c.usedCount} limit={c.usageLimit} />
                    </dd>
                  </div>
                  <div className="col-span-2 min-w-0">
                    <dt className="text-muted-foreground">Runs</dt>
                    <dd className="mt-0.5 break-words">
                      {couponWindowSummary(
                        formatStoreDateTime(c.startsAt),
                        formatStoreDateTime(c.expiresAt)
                      )}
                    </dd>
                  </div>
                </dl>

                <div className="mt-2 border-t border-border pt-1">
                  <CouponRowActions
                    id={c.id}
                    code={c.code}
                    isActive={c.isActive}
                    usedCount={c.usedCount}
                  />
                </div>
              </li>
            ))}
          </ul>

          {/* ---- Laptop: the table. ---- */}
          <div className="mt-6 hidden overflow-hidden rounded-2xl border border-border bg-card md:block">
            <div className="w-full max-w-full overflow-x-auto overscroll-x-contain">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Code</th>
                    <th className="px-4 py-3 font-medium">Applies to</th>
                    <th className="px-4 py-3 font-medium">Used</th>
                    <th className="px-4 py-3 font-medium">Runs</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {coupons.map(({ coupon: c, status }) => (
                    <tr key={c.id} className="align-top hover:bg-muted/40">
                      <td className="px-4 py-3">
                        <p className="font-mono font-medium tracking-widest">{c.code}</p>
                        <p className="mt-0.5 max-w-[22rem] text-xs text-muted-foreground">
                          {couponOfferSummary(c)}{" "}
                          {couponLimitSummary(c)}
                        </p>
                      </td>
                      <td className="max-w-[12rem] px-4 py-3">
                        <span className="block truncate" title={scopeLabel(c.productIds)}>
                          {scopeLabel(c.productIds)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <UsageBar used={c.usedCount} limit={c.usageLimit} />
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {couponWindowSummary(
                          formatStoreDateTime(c.startsAt),
                          formatStoreDateTime(c.expiresAt)
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <CouponStatusPill status={status} />
                      </td>
                      <td className="px-4 py-3">
                        <CouponRowActions
                          id={c.id}
                          code={c.code}
                          isActive={c.isActive}
                          usedCount={c.usedCount}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
