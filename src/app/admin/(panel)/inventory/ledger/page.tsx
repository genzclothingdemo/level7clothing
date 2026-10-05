import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { listMovements } from "@/lib/inventory";
import { isMovementType, stockStateOf } from "@/lib/inventory-types";
import { InfoTip } from "@/components/store/info-tip";
import { Empty } from "@/components/admin/finance-ui";
import { LedgerTable } from "@/components/admin/inventory-ledger";
import {
  InventoryLedgerFilters,
  type LedgerFilterValues,
} from "@/components/admin/inventory-ledger-filters";
import {
  StateBadge,
  axisOrderOf,
  formatBalance,
  formatUnits,
  inventoryHref,
  variantLabel,
} from "@/components/admin/inventory-ui";
import { ledgerSummary, readLowStockDefault, toLedgerPage, type LedgerFilter } from "../_lib/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Stock ledger" };

/**
 * Admin → Inventory → Ledger.
 *
 * Every stock entry there has ever been — the ones orders and returns write
 * and the ones people record — newest first, like a statement. Narrowed to
 * one size it *is* that size's statement, with its current balance above the
 * lines that produced it; that is the view every history link in this section
 * opens.
 *
 * ## Paging
 *
 * The engine pages by cursor (`listMovements`), which stays fast however long
 * the ledger grows and cannot skip or repeat a row when a new entry lands
 * between two page loads. A cursor only knows the way forward, so the URL keeps
 * the trail — `?after=a,b` — and "Newer" drops the last one. The trail is
 * capped, and a filter change clears it.
 *
 * ## Dates are IST days
 *
 * "From 1 Sep" means from midnight in India, not in UTC, which is what the
 * server's clock is on Vercel. Both ends are inclusive.
 */

const PAGE_SIZE = 50;
const MAX_TRAIL = 40;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[a-z0-9]{8,40}$/i;

type SP = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v.trim() : "");

function istDay(day: string, end: boolean): Date | undefined {
  if (!DAY.test(day)) return undefined;
  const d = new Date(`${day}T${end ? "23:59:59.999" : "00:00:00.000"}+05:30`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export default async function InventoryLedgerPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;

  const [catalogue, lowDefault] = await Promise.all([
    prisma.product.findMany({
      where: { variantRows: { some: {} } },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        isActive: true,
        trackInventory: true,
        attributes: true,
        variantRows: {
          orderBy: { sortOrder: "asc" },
          select: {
            id: true,
            sku: true,
            combo: true,
            onHand: true,
            reserved: true,
            available: true,
            lowStockAt: true,
          },
        },
      },
    }),
    readLowStockDefault(),
  ]);

  // ---- Read the filter from the URL, trusting nothing in it. ----------------
  const variantParam = one(sp.variant);
  const owner = variantParam
    ? catalogue.find((p) => p.variantRows.some((v) => v.id === variantParam))
    : undefined;
  // A size implies its product, so a history link needs only the size's id.
  const product = owner ?? catalogue.find((p) => p.id === one(sp.product));
  const variant = owner?.variantRows.find((v) => v.id === variantParam);
  const typeParam = one(sp.type);
  const type = isMovementType(typeParam) ? typeParam : undefined;
  const orderParam = one(sp.order);
  const order = ID.test(orderParam)
    ? await prisma.order.findUnique({ where: { id: orderParam }, select: { id: true, orderNumber: true } })
    : null;
  const fromDay = DAY.test(one(sp.from)) ? one(sp.from) : "";
  const toDay = DAY.test(one(sp.to)) ? one(sp.to) : "";

  const trail = one(sp.after)
    .split(",")
    .filter((c) => ID.test(c))
    .slice(-MAX_TRAIL);
  const cursor = trail[trail.length - 1];

  const filter: LedgerFilter = {
    productId: product?.id,
    variantId: variant?.id,
    orderId: order?.id,
    type,
    from: istDay(fromDay, false),
    to: istDay(toDay, true),
  };

  const [page, summary] = await Promise.all([
    listMovements({ ...filter, cursor, limit: PAGE_SIZE }),
    ledgerSummary(filter),
  ]);
  const { rows, refs } = await toLedgerPage(page.rows);

  // ---- Links --------------------------------------------------------------
  const values: LedgerFilterValues = {
    product: product?.id ?? "",
    variant: variant?.id ?? "",
    type: type ?? "",
    order: order?.id ?? "",
    from: fromDay,
    to: toDay,
  };
  const hrefWith = (after: string[]) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(values)) if (v) qs.set(k, v);
    if (after.length) qs.set("after", after.join(","));
    const s = qs.toString();
    return s ? `/admin/inventory/ledger?${s}` : "/admin/inventory/ledger";
  };
  const newer = trail.length > 0 ? hrefWith(trail.slice(0, -1)) : null;
  const older = page.nextCursor ? hrefWith([...trail, page.nextCursor]) : null;
  const firstShown = trail.length * PAGE_SIZE + 1;
  const lastShown = firstShown + rows.length - 1;

  const axis = product ? axisOrderOf(product.attributes) : [];
  const narrowed = Object.values(values).some(Boolean);

  const step =
    "inline-flex min-h-11 items-center gap-1 rounded-lg border border-border bg-card px-3 text-[11px] font-medium uppercase tracking-widest transition-colors hover:bg-muted sm:min-h-9";

  return (
    <div className="min-w-0 space-y-4">
      <InventoryLedgerFilters
        values={values}
        products={catalogue.map((p) => ({ id: p.id, name: p.name, hidden: !p.isActive }))}
        sizes={(product?.variantRows ?? []).map((v) => ({
          id: v.id,
          label: variantLabel(v.combo, axis),
          sku: v.sku,
        }))}
        orderLabel={order?.orderNumber ?? null}
      />

      {/* ---- One size: its balance now, above the lines that made it. ---- */}
      {product && variant && (
        <section className="flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4">
          <div className="min-w-0">
            <p className="eyebrow">Statement for one size</p>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
              <Link href={inventoryHref.product(product.id)} className="font-medium underline-offset-2 hover:underline">
                {product.name}
              </Link>
              <span className="text-muted-foreground">·</span>
              <span className="font-medium">{variantLabel(variant.combo, axis)}</span>
              <span className="font-mono text-[11px] text-muted-foreground">{variant.sku}</span>
            </p>
          </div>
          {product.trackInventory ? (
            <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm tabular-nums">
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">On hand</dt>
                <dd className="font-medium">{formatBalance(variant.onHand)}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">Reserved</dt>
                <dd className="font-medium">{formatBalance(variant.reserved)}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">Available</dt>
                <dd className="font-medium">{formatBalance(variant.available)}</dd>
              </div>
              <div>
                <dt className="sr-only">State</dt>
                <dd>
                  <StateBadge state={stockStateOf(variant, variant.lowStockAt ?? lowDefault)} />
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-xs text-muted-foreground">This product is not tracked right now.</p>
          )}
        </section>
      )}

      {/* ---- The statement ---- */}
      <section className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <h2 className="flex items-center gap-1 font-serif text-lg leading-none">
            {narrowed ? "Matching entries" : "Every entry"}
            <InfoTip term="The ledger">
              Newest first. In and Out are units that entered or left the store; On hand and
              Reserved are the balances each entry left behind, so any number can be traced line by
              line. Reserve and release move no units — they change what is promised, so only the
              Reserved column moves. Nothing here is ever edited or deleted: a mistake is corrected
              by a further entry, the way a bank corrects a statement.
            </InfoTip>
          </h2>
          <p className="text-xs tabular-nums text-muted-foreground">
            {formatUnits(summary.entries)} entr{summary.entries === 1 ? "y" : "ies"}
            {summary.entries > 0 && (
              <>
                {" · "}
                <span className="text-success">{formatUnits(summary.unitsIn)} in</span>
                {" · "}
                {formatUnits(summary.unitsOut)} out
              </>
            )}
          </p>
        </div>

        {rows.length === 0 ? (
          <div className="px-4 pb-4">
            <Empty>
              {narrowed
                ? trail.length > 0
                  ? "No older entries."
                  : "No entries match these filters."
                : "No stock entries yet. They start the moment a product is tracked."}
            </Empty>
          </div>
        ) : (
          <div className="border-t border-border">
            <LedgerTable rows={rows} refs={refs} showProduct={!product} showSize={!variant} />
          </div>
        )}

        {(newer || older) && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3">
            <p className="text-xs tabular-nums text-muted-foreground">
              {rows.length > 0
                ? `${formatUnits(firstShown)}–${formatUnits(lastShown)} of ${formatUnits(summary.entries)}`
                : ""}
            </p>
            <div className="flex gap-2">
              {newer ? (
                <Link href={newer} className={step}>
                  <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  Newer
                </Link>
              ) : null}
              {older ? (
                <Link href={older} className={step}>
                  Older
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              ) : null}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
