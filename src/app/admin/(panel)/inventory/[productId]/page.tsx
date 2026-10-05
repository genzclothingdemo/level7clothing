import { cache } from "react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Lock } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getAdminSession } from "@/lib/auth";
import { canWrite } from "@/lib/temp-admin";
import { listMovements } from "@/lib/inventory";
import { isManualMovementType } from "@/lib/inventory-types";
import { formatINR } from "@/lib/utils";
import { InfoTip } from "@/components/store/info-tip";
import { Disclosure } from "@/components/store/disclosure";
import { Empty, Panel, PanelLink } from "@/components/admin/finance-ui";
import { InventoryEntryForm } from "@/components/admin/inventory-entry-form";
import { InventoryStocktake } from "@/components/admin/inventory-stocktake";
import { InventoryStopTracking } from "@/components/admin/inventory-stop-tracking";
import { LedgerTable } from "@/components/admin/inventory-ledger";
import { OversoldBanner } from "@/components/admin/inventory-oversold";
import {
  Tag,
  VariantTable,
  axisOrderOf,
  formatUnits,
  inventoryHref,
  variantLabel,
} from "@/components/admin/inventory-ui";
import {
  openOrderDemand,
  readLowStockDefault,
  reservationHolders,
  toLedgerPage,
  toVariantLines,
  type Holder,
} from "../_lib/queries";

export const dynamic = "force-dynamic";

/**
 * Admin → Inventory → one product.
 *
 * The place stock is *changed*. The list shows; this acts. What it offers
 * depends on one fact, whether the product is tracked yet:
 *
 * - **Not tracked** — the stocktake: count each size, start tracking.
 * - **Tracked** — its sizes, the entry form, and its recent history.
 *
 * Order of reading, top to bottom: oversold (only when true), the sizes,
 * what you can do, what has happened. Stopping tracking is folded away at the
 * foot — the one control here that undoes the feature.
 *
 * SKU, price, cost and the low-stock line are **shown, not edited**: the
 * product editor owns them, and a second writer for any of them is the
 * `defaultReturnsInfo` trap CLAUDE.md records. One link sends the owner there.
 *
 * A view-only temporary admin sees every number and every entry, and in place
 * of the forms, one line saying why there are none. The server actions refuse
 * them regardless — the line is so they are told rather than refused.
 */

const loadProduct = cache(async (id: string) =>
  prisma.product.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      category: true,
      images: true,
      isActive: true,
      trackInventory: true,
      stock: true,
      price: true,
      costPrice: true,
      attributes: true,
      variantRows: {
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          sku: true,
          comboKey: true,
          combo: true,
          onHand: true,
          reserved: true,
          available: true,
          isActive: true,
          lowStockAt: true,
          price: true,
          costPrice: true,
        },
      },
    },
  })
);

export async function generateMetadata({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = await params;
  const p = await loadProduct(productId).catch(() => null);
  return { title: p ? `${p.name} · Inventory` : "Inventory" };
}

/** Recent entries shown here. The full statement is one link away. */
const HISTORY_ROWS = 12;

const quiet =
  "underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm";

function HeldFor({ holders }: { holders: Holder[] }) {
  return (
    <span className="block">
      Held for{" "}
      {holders.map((h, i) => (
        <span key={h.orderId}>
          {i > 0 && ", "}
          {h.orderNumber ? (
            <Link href={inventoryHref.order(h.orderNumber)} className={quiet}>
              {h.orderNumber}
            </Link>
          ) : (
            "a removed order"
          )}
          {h.qty > 1 && ` ×${h.qty}`}
        </span>
      ))}
    </span>
  );
}

export default async function InventoryProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ productId: string }>;
  searchParams: Promise<{ entry?: string | string[] }>;
}) {
  const { productId } = await params;
  const sp = await searchParams;

  const [product, lowDefault, session] = await Promise.all([
    loadProduct(productId),
    readLowStockDefault(),
    getAdminSession(),
  ]);
  if (!product) notFound();

  // Decides only what is offered. The actions check again, on the server.
  const writable = session ? canWrite(session) : false;
  const tracked = product.trackInventory;
  const axis = axisOrderOf(product.attributes);
  const lines = toVariantLines(product.variantRows, tracked, axis, lowDefault);
  const activeRows = product.variantRows.filter((v) => v.isActive);

  const [history, holders, demand] = await Promise.all([
    listMovements({ productId: product.id, limit: HISTORY_ROWS }).then(async (page) => ({
      ...(await toLedgerPage(page.rows)),
      more: page.nextCursor !== null,
    })),
    tracked
      ? reservationHolders(lines.filter((l) => l.reserved > 0).map((l) => l.id))
      : Promise.resolve(new Map<string, Holder[]>()),
    !tracked && writable && activeRows.length > 0
      ? openOrderDemand(product.id, product.variantRows)
      : Promise.resolve(null),
  ]);

  const oversold = lines
    .filter((l) => l.state === "oversold")
    .map((l) => ({
      variantId: l.id,
      productId: product.id,
      productName: product.name,
      label: l.label,
      sku: l.sku,
      onHand: l.onHand,
      reserved: l.reserved,
      holders: holders.get(l.id) ?? [],
    }));

  /** Under each size: where it differs from the product, and who it is promised to. */
  const detail: Record<string, React.ReactNode> = {};
  for (const v of product.variantRows) {
    const own = [
      v.price != null ? formatINR(v.price) : null,
      v.costPrice != null ? `cost ${formatINR(v.costPrice)}` : null,
      v.lowStockAt != null ? `low at ≤ ${v.lowStockAt}` : null,
    ].filter(Boolean);
    const held = holders.get(v.id) ?? [];
    if (own.length === 0 && held.length === 0) continue;
    detail[v.id] = (
      <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">
        {own.length > 0 && <span className="block">{own.join(" · ")}</span>}
        {held.length > 0 && <HeldFor holders={held} />}
      </span>
    );
  }

  const onHand = lines.reduce((n, l) => n + l.onHand, 0);
  const reserved = lines.reduce((n, l) => n + l.reserved, 0);
  const initialType = isManualMovementType(sp.entry) ? sp.entry : undefined;

  return (
    <div className="min-w-0 space-y-4">
      <Link
        href="/admin/inventory"
        className="-ml-1 inline-flex min-h-11 items-center gap-1 rounded-lg px-1 text-xs text-muted-foreground transition-colors hover:text-foreground sm:min-h-8"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        All stock
      </Link>

      {/* ---- Which product ---- */}
      <section className="flex min-w-0 items-start gap-3 rounded-2xl border border-border bg-card p-4">
        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-muted">
          {product.images[0] && (
            <Image src={product.images[0]} alt="" fill sizes="56px" className="object-cover" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-serif text-lg leading-snug sm:text-xl">{product.name}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span>{product.category}</span>
            {!product.isActive && <Tag>Hidden</Tag>}
            {tracked ? <Tag className="bg-success/15 text-success">Tracked</Tag> : <Tag>Not tracked</Tag>}
          </p>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>
              Price <span className="text-foreground">{formatINR(product.price)}</span>
            </span>
            <span>
              Cost{" "}
              <span className="text-foreground">
                {product.costPrice != null ? formatINR(product.costPrice) : "not set"}
              </span>
            </span>
            <span>
              Low at <span className="text-foreground">≤ {formatUnits(lowDefault)}</span>
            </span>
            <span className="inline-flex items-center">
              <Link href={inventoryHref.editor(product.id)} className="text-accent underline-offset-2 hover:underline">
                Edit in the product editor
              </Link>
              <InfoTip term="Set in the product editor">
                SKUs, prices, cost prices and the low-stock line each have one place they are changed:
                the product editor. This screen shows them so a count can be read against them. A
                size with its own price, cost or low-stock line shows it under the size.
              </InfoTip>
            </span>
          </p>
        </div>
      </section>

      <OversoldBanner items={oversold} showProduct={false} />

      {/* ---- The sizes ---- */}
      {(tracked || !writable) && lines.length > 0 && (
        <Panel
          title="Sizes"
          className="overflow-hidden"
          tip="Each size's own count. On hand is in the store, reserved is promised to orders that have not shipped, available is what the shop can still sell. The clock icon opens that size's full history."
          aside={
            tracked ? (
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {formatUnits(onHand)} on hand · {formatUnits(reserved)} reserved
              </span>
            ) : undefined
          }
        >
          <div className="-mx-4 -mb-4 border-t border-border sm:-mx-5 sm:-mb-5">
            <VariantTable variants={lines} detail={detail} />
          </div>
        </Panel>
      )}

      {/* ---- What you can do ---- */}
      {!writable ? (
        <p className="flex items-start gap-2 rounded-2xl border border-orange-500/30 bg-orange-500/10 p-3 text-xs leading-relaxed text-orange-700 dark:text-orange-300">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            You have <strong>view-only</strong> access: you can see stock and every entry, but
            recording an entry or starting a stocktake needs full access. Ask the store owner.
          </span>
        </p>
      ) : !tracked ? (
        activeRows.length === 0 ? (
          <Empty>
            This product has no sizes set up yet.{" "}
            <Link href={inventoryHref.editor(product.id)} className="text-accent underline-offset-2 hover:underline">
              Save it once in the product editor
            </Link>{" "}
            and its sizes will appear here to count.
          </Empty>
        ) : (
          <InventoryStocktake
            productId={product.id}
            legacyStock={product.stock}
            openOrders={demand?.orders ?? 0}
            unmatched={demand?.unmatched ?? []}
            sizes={activeRows.map((v) => ({
              id: v.id,
              label: variantLabel(v.combo, axis),
              sku: v.sku,
              promised: demand?.byVariant[v.id] ?? 0,
            }))}
          />
        )
      ) : (
        <InventoryEntryForm
          productId={product.id}
          initialType={initialType}
          sizes={lines.map((l) => ({
            id: l.id,
            label: l.label,
            sku: l.sku,
            onHand: l.onHand,
            reserved: l.reserved,
            retired: l.retired,
          }))}
        />
      )}

      {/* ---- What has happened ---- */}
      {(tracked || history.rows.length > 0) && (
        <Panel
          title="History"
          className="overflow-hidden"
          tip="Every entry for this product, newest first, with the balance each one left behind. Orders and returns write their own entries; the rest were recorded by hand, with a name on each."
          aside={
            history.rows.length > 0 ? (
              <PanelLink href={inventoryHref.ledger({ product: product.id })}>
                {history.more ? "Full ledger" : "Open in ledger"}
              </PanelLink>
            ) : undefined
          }
        >
          {history.rows.length === 0 ? (
            <Empty>No entries yet.</Empty>
          ) : (
            <div className="-mx-4 -mb-4 border-t border-border sm:-mx-5 sm:-mb-5">
              <LedgerTable rows={history.rows} refs={history.refs} showProduct={false} />
            </div>
          )}
        </Panel>
      )}

      {tracked && writable && (
        <div className="rounded-2xl border border-border bg-card px-4">
          <Disclosure label="Stop tracking this product">
            <div className="space-y-3">
              <p className="text-xs leading-relaxed text-muted-foreground">
                It goes back to one stock number for all sizes, and checkout stops checking each size.
                The ledger is kept.
              </p>
              <InventoryStopTracking productId={product.id} productName={product.name} sellsAs={product.stock} />
            </div>
          </Disclosure>
        </div>
      )}
    </div>
  );
}
