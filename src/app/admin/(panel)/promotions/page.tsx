import Link from "next/link";
import { Megaphone, Plus } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { toStoreDateTimeInput } from "@/lib/coupons";
import { asPromotionKind, getLivePromotion } from "@/lib/promotions";
import { formatStoreDateTime } from "@/components/admin/coupon-summary";
import { PromotionRowActions } from "@/components/admin/promotion-row-actions";
import {
  PromotionStatusPill,
  promotionDismissSummary,
  promotionStatusFor,
  promotionSurfaceSummary,
  promotionWindowSummary,
  storeNowInputValue,
} from "@/components/admin/promotion-summary";

export const dynamic = "force-dynamic";
export const metadata = { title: "Promotions" };

/**
 * The promotions list.
 *
 * The header is the point of this page. A table of rows each marked "Live"
 * answers the wrong question — several promotions can be *eligible* at once
 * and only one of them is on the store. So the truth is read from
 * `getLivePromotion()`, the same resolver the storefront uses, and printed at
 * the top in words. A row's pill says whether it is eligible; the header says
 * what shoppers are actually seeing.
 */
export default async function AdminPromotions() {
  const [rows, live] = await Promise.all([
    prisma.promotion
      .findMany({ orderBy: [{ priority: "desc" }, { createdAt: "desc" }] })
      .catch(() => []),
    getLivePromotion(),
  ]);

  // Status comes from four columns at once, so it cannot be a WHERE clause.
  // Converting each row's dates into the store's wall clock lets the list and
  // the editor share one status rule — see promotion-summary.tsx.
  const now = storeNowInputValue();
  const promotions = rows.map((p) => ({
    row: p,
    kind: asPromotionKind(p.kind),
    showing: live?.id === p.id,
    status: promotionStatusFor(
      p.isActive,
      toStoreDateTimeInput(p.startsAt),
      toStoreDateTimeInput(p.endsAt),
      now
    ),
  }));

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-serif text-3xl">Promotions</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {rows.length} promotion{rows.length === 1 ? "" : "s"} · only one is
            ever on the store
          </p>
        </div>
        <Link
          href="/admin/promotions/new"
          className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg bg-foreground px-5 text-[11px] font-medium uppercase tracking-widest text-background transition-opacity hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> Add promotion
        </Link>
      </div>

      {/* ---- What shoppers are seeing, right now ---- */}
      <div
        className={`mt-6 min-w-0 rounded-2xl border p-4 sm:p-5 ${
          live ? "border-success/40 bg-success/10" : "border-border bg-muted/30"
        }`}
      >
        <p className="eyebrow text-muted-foreground">On the storefront right now</p>
        {live ? (
          <>
            <p className="mt-2 break-words font-serif text-xl leading-snug">
              {live.title}
            </p>
            <p className="mt-1 break-words text-sm text-muted-foreground">
              {live.body}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {promotionSurfaceSummary(live.kind)} ·{" "}
              {promotionDismissSummary(live.dismissDays)}
            </p>
          </>
        ) : (
          <p className="mt-2 font-serif text-xl leading-snug">
            Nothing — the store is running clean.
          </p>
        )}
      </div>

      {promotions.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-border p-10 text-center sm:p-12">
          <Megaphone className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-4 font-serif text-xl">No promotions yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            Announce a drop, a sale or a shipping cut-off. One at a time — a
            store that always has an offer running has none.
          </p>
          <Link
            href="/admin/promotions/new"
            className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-lg bg-foreground px-5 text-[11px] font-medium uppercase tracking-widest text-background"
          >
            <Plus className="h-4 w-4" /> Add promotion
          </Link>
        </div>
      ) : (
        <>
          {/* ---- Phone: one card per promotion. ---- */}
          <ul className="mt-6 space-y-3 md:hidden">
            {promotions.map(({ row: p, kind, status, showing }) => (
              <li
                key={p.id}
                className={`min-w-0 rounded-2xl border bg-card p-4 ${
                  showing ? "border-success/50" : "border-border"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 break-words font-medium">{p.title}</p>
                  <PromotionStatusPill status={status} />
                </div>
                {showing && (
                  <p className="mt-1 text-xs font-medium text-success">
                    Showing on the store
                  </p>
                )}

                <p className="mt-2 break-words text-sm text-muted-foreground">
                  {p.body}
                </p>

                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-border pt-3 text-xs">
                  <div className="min-w-0">
                    <dt className="text-muted-foreground">Shows as</dt>
                    <dd className="mt-0.5">{promotionSurfaceSummary(kind)}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-muted-foreground">Priority</dt>
                    <dd className="mt-0.5 tabular-nums">{p.priority}</dd>
                  </div>
                  <div className="col-span-2 min-w-0">
                    <dt className="text-muted-foreground">Runs</dt>
                    <dd className="mt-0.5 break-words">
                      {promotionWindowSummary(
                        formatStoreDateTime(p.startsAt),
                        formatStoreDateTime(p.endsAt)
                      )}
                    </dd>
                  </div>
                </dl>

                <div className="mt-2 border-t border-border pt-1">
                  <PromotionRowActions
                    id={p.id}
                    title={p.title}
                    isActive={p.isActive}
                    showing={showing}
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
                    <th className="px-4 py-3 font-medium">Promotion</th>
                    <th className="px-4 py-3 font-medium">Shows as</th>
                    <th className="px-4 py-3 font-medium">Runs</th>
                    <th className="px-4 py-3 font-medium">Priority</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {promotions.map(({ row: p, kind, status, showing }) => (
                    <tr
                      key={p.id}
                      className={`align-top hover:bg-muted/40 ${
                        showing ? "bg-success/5" : ""
                      }`}
                    >
                      <td className="px-4 py-3">
                        <p className="max-w-[22rem] font-medium">{p.title}</p>
                        <p className="mt-0.5 max-w-[22rem] text-xs text-muted-foreground">
                          {p.body}
                        </p>
                        {showing && (
                          <p className="mt-1 text-xs font-medium text-success">
                            Showing on the store
                          </p>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                        {promotionSurfaceSummary(kind)}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {promotionWindowSummary(
                          formatStoreDateTime(p.startsAt),
                          formatStoreDateTime(p.endsAt)
                        )}
                      </td>
                      <td className="px-4 py-3 tabular-nums">{p.priority}</td>
                      <td className="px-4 py-3">
                        <PromotionStatusPill status={status} />
                      </td>
                      <td className="px-4 py-3">
                        <PromotionRowActions
                          id={p.id}
                          title={p.title}
                          isActive={p.isActive}
                          showing={showing}
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
