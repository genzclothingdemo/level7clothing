import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { optionSignature } from "@/lib/options";
import type { MovementRow } from "@/lib/inventory";
import { stockStateOf, type MovementType, type StockState } from "@/lib/inventory-types";
import { axisOrderOf, variantLabel, type VariantLine } from "@/components/admin/inventory-ui";
import type { LedgerRefs, LedgerRow } from "@/components/admin/inventory-ledger";

/**
 * The reads behind Admin → Inventory.
 *
 * **Reads only.** Every write goes through `lib/inventory.ts` via
 * `actions/inventory.ts`; nothing in this file touches a counter or a ledger
 * row. The ledger itself is read with the engine's `listMovements` — the one
 * query here that walks `StockMovement` rows directly is `reservationHolders`,
 * which asks a question `listMovements` has no shape for (which open orders
 * still hold units), and it sums reservations the same way the engine's own
 * `outstandingReservations` does.
 *
 * A private folder (`_lib`), so none of this is a route.
 */

/* ------------------------------------------------------------------ */
/*  Settings                                                           */
/* ------------------------------------------------------------------ */

/** `SiteSettings.lowStockThreshold`, the line a size without its own override is "low" at. */
export async function readLowStockDefault(): Promise<number> {
  const row = await prisma.siteSettings.findUnique({
    where: { id: "main" },
    select: { lowStockThreshold: true },
  });
  return row?.lowStockThreshold ?? 5;
}

/* ------------------------------------------------------------------ */
/*  The stock list                                                     */
/* ------------------------------------------------------------------ */

export type StockProduct = {
  id: string;
  name: string;
  image: string | null;
  isActive: boolean;
  tracked: boolean;
  /**
   * `Product.stock`. For an untracked product it is the single number the
   * store has been selling from; for a tracked one it is the engine's mirror.
   */
  legacyStock: number;
  variants: (VariantLine & { lowAt: number })[];
  /** The most urgent state among its sizes; null while untracked. */
  worst: StockState | null;
  onHand: number;
  reserved: number;
  /** Positive available only — the same sum the engine mirrors into `stock`. */
  available: number;
};

const STATE_RANK: Record<StockState, number> = { oversold: 0, out: 1, low: 2, ok: 3 };

/** Most urgent first. */
export function worstOf(states: (StockState | null)[]): StockState | null {
  let best: StockState | null = null;
  for (const s of states) {
    if (s && (best === null || STATE_RANK[s] < STATE_RANK[best])) best = s;
  }
  return best;
}

type VariantRowIn = {
  id: string;
  sku: string;
  combo: Prisma.JsonValue;
  onHand: number;
  reserved: number;
  available: number;
  isActive: boolean;
  lowStockAt: number | null;
};

/**
 * One product's sizes as the screen shows them.
 *
 * A switched-off size is left out **unless it still holds units or promises** —
 * the editor can retire a size, but units on a shelf do not disappear because a
 * checkbox moved, and a screen that hid them would lose count of real stock.
 */
export function toVariantLines(
  rows: VariantRowIn[],
  tracked: boolean,
  axisOrder: string[],
  lowDefault: number
): (VariantLine & { lowAt: number })[] {
  return rows
    .filter((v) => v.isActive || v.onHand !== 0 || v.reserved !== 0)
    .map((v) => {
      const lowAt = v.lowStockAt ?? lowDefault;
      return {
        id: v.id,
        label: variantLabel(v.combo, axisOrder),
        sku: v.sku,
        onHand: v.onHand,
        reserved: v.reserved,
        available: v.available,
        state: tracked ? stockStateOf(v, lowAt) : null,
        retired: !v.isActive,
        lowAt,
      };
    });
}

/** Every product and its sizes, for the stock list, beside the store's low-stock line. */
export async function loadStockCatalogue(): Promise<{ products: StockProduct[]; lowDefault: number }> {
  const [lowDefault, rows] = await Promise.all([readLowStockDefault(), readCatalogueRows()]);
  const products = rows.map((p) => {
    const variants = toVariantLines(p.variantRows, p.trackInventory, axisOrderOf(p.attributes), lowDefault);
    return {
      id: p.id,
      name: p.name,
      image: p.images[0] ?? null,
      isActive: p.isActive,
      tracked: p.trackInventory,
      legacyStock: p.stock,
      variants,
      worst: p.trackInventory ? worstOf(variants.map((v) => v.state)) : null,
      onHand: variants.reduce((n, v) => n + v.onHand, 0),
      reserved: variants.reduce((n, v) => n + v.reserved, 0),
      available: variants.reduce((n, v) => n + (v.retired ? 0 : Math.max(0, v.available)), 0),
    };
  });
  return { products, lowDefault };
}

function readCatalogueRows() {
  return prisma.product.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      images: true,
      isActive: true,
      trackInventory: true,
      stock: true,
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
          isActive: true,
          lowStockAt: true,
        },
      },
    },
  });
}

/* ------------------------------------------------------------------ */
/*  Who is holding the units                                           */
/* ------------------------------------------------------------------ */

export type Holder = { orderId: string; orderNumber: string | null; qty: number };

/**
 * Which orders still hold reserved units of each size, read from the ledger —
 * the net of every RESERVE, RELEASE and SALE per order, exactly how the engine
 * decides what an order still holds. Anything above zero is a promise that has
 * not shipped.
 *
 * This is what turns "oversold" from a red number into something a person can
 * act on: these are the customers who may not get their parcel.
 */
export async function reservationHolders(variantIds: string[]): Promise<Map<string, Holder[]>> {
  const out = new Map<string, Holder[]>();
  if (variantIds.length === 0) return out;

  const groups = await prisma.stockMovement.groupBy({
    by: ["variantId", "orderId"],
    where: { variantId: { in: variantIds }, orderId: { not: null } },
    _sum: { reservedDelta: true },
  });
  const held = groups.filter((g) => g.orderId && (g._sum.reservedDelta ?? 0) > 0);
  if (held.length === 0) return out;

  const orders = await prisma.order.findMany({
    where: { id: { in: [...new Set(held.map((h) => h.orderId as string))] } },
    select: { id: true, orderNumber: true },
  });
  const numberOf = new Map(orders.map((o) => [o.id, o.orderNumber]));

  for (const h of held) {
    const list = out.get(h.variantId) ?? [];
    list.push({
      orderId: h.orderId as string,
      orderNumber: numberOf.get(h.orderId as string) ?? null,
      qty: h._sum.reservedDelta ?? 0,
    });
    out.set(h.variantId, list);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  The stocktake preview                                              */
/* ------------------------------------------------------------------ */

/**
 * Mirrors `OPEN_ORDER_STATUSES` in `lib/inventory.ts`, which is module-private.
 * Used for a **preview** only — `startTracking` makes the real reservations,
 * and its result is what the screen reports afterwards.
 */
const OPEN_ORDER_STATUSES = ["pending", "confirmed"];

type OrderLine = { productId?: string; quantity?: number; options?: { name: string; value: string }[] };

export type OpenDemand = {
  /** Open orders with at least one line of this product. */
  orders: number;
  /** Units those orders will reserve, per size. */
  byVariant: Record<string, number>;
  /**
   * Lines that name no size this product has (a size removed since, or a line
   * missing an option). `startTracking` cannot reserve these, and the owner
   * should know before they count rather than wonder afterwards.
   */
  unmatched: { label: string; qty: number }[];
};

/**
 * What the open orders will take from the count, before tracking starts.
 *
 * Line → size matching is the engine's rule — the line's `optionSignature`
 * against an active variant's `comboKey` — so the preview and the reservation
 * agree on which size each unit belongs to.
 */
export async function openOrderDemand(
  productId: string,
  variants: { id: string; comboKey: string; isActive: boolean }[]
): Promise<OpenDemand> {
  const orders = await prisma.order.findMany({
    where: { status: { in: OPEN_ORDER_STATUSES }, items: { array_contains: [{ productId }] } },
    select: { items: true },
  });

  const byKey = new Map(variants.filter((v) => v.isActive).map((v) => [v.comboKey, v.id]));
  const byVariant: Record<string, number> = {};
  const unmatched = new Map<string, number>();
  let count = 0;

  for (const o of orders) {
    const lines = ((o.items as unknown as OrderLine[]) ?? []).filter((l) => l?.productId === productId);
    if (lines.length === 0) continue;
    count += 1;
    for (const l of lines) {
      const qty = Math.max(0, Math.floor(Number(l.quantity) || 0));
      if (qty === 0) continue;
      const id = byKey.get(optionSignature(l.options));
      if (id) {
        byVariant[id] = (byVariant[id] ?? 0) + qty;
      } else {
        const label =
          (l.options ?? []).map((x) => `${x.name}: ${x.value}`).join(" · ") || "no size chosen";
        unmatched.set(label, (unmatched.get(label) ?? 0) + qty);
      }
    }
  }

  return {
    orders: count,
    byVariant,
    unmatched: [...unmatched.entries()].map(([label, qty]) => ({ label, qty })),
  };
}

/* ------------------------------------------------------------------ */
/*  The ledger                                                         */
/* ------------------------------------------------------------------ */

export type LedgerFilter = {
  productId?: string;
  variantId?: string;
  orderId?: string;
  type?: MovementType;
  from?: Date;
  to?: Date;
};

/**
 * The same `where` `listMovements` builds from the same filter, for the
 * statement's totals. Kept field-for-field in step with the engine's, so the
 * totals above the table always describe exactly the rows in it.
 */
function ledgerWhere(f: LedgerFilter): Prisma.StockMovementWhereInput {
  return {
    ...(f.variantId ? { variantId: f.variantId } : {}),
    ...(f.productId ? { variant: { productId: f.productId } } : {}),
    ...(f.orderId ? { orderId: f.orderId } : {}),
    ...(f.type ? { type: f.type } : {}),
    ...(f.from || f.to
      ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } }
      : {}),
  };
}

export type LedgerSummary = { entries: number; unitsIn: number; unitsOut: number };

/** How many entries match, and the units they moved in and out of the store. */
export async function ledgerSummary(f: LedgerFilter): Promise<LedgerSummary> {
  const where = ledgerWhere(f);
  const [entries, ins, outs] = await Promise.all([
    prisma.stockMovement.count({ where }),
    prisma.stockMovement.aggregate({
      where: { AND: [where, { onHandDelta: { gt: 0 } }] },
      _sum: { onHandDelta: true },
    }),
    prisma.stockMovement.aggregate({
      where: { AND: [where, { onHandDelta: { lt: 0 } }] },
      _sum: { onHandDelta: true },
    }),
  ]);
  return {
    entries,
    unitsIn: ins._sum.onHandDelta ?? 0,
    unitsOut: -(outs._sum.onHandDelta ?? 0),
  };
}

/**
 * A page of `listMovements` rows, made ready to render: the size labelled in
 * its product's own option order, and every order and return id resolved to
 * the number its screen is searched by.
 */
export async function toLedgerPage(rows: MovementRow[]): Promise<{ rows: LedgerRow[]; refs: LedgerRefs }> {
  const productIds = [...new Set(rows.map((r) => r.productId))];
  const orderIds = [...new Set(rows.map((r) => r.orderId).filter((x): x is string => !!x))];
  const returnIds = [...new Set(rows.map((r) => r.returnId).filter((x): x is string => !!x))];

  const [products, orders, returns] = await Promise.all([
    productIds.length
      ? prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, attributes: true } })
      : [],
    orderIds.length
      ? prisma.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, orderNumber: true } })
      : [],
    returnIds.length
      ? prisma.returnRequest.findMany({
          where: { id: { in: returnIds } },
          select: { id: true, requestNumber: true },
        })
      : [],
  ]);

  const axisOf = new Map(products.map((p) => [p.id, axisOrderOf(p.attributes)]));

  return {
    rows: rows.map((r) => ({
      id: r.id,
      at: r.at.toISOString(),
      type: r.type,
      onHandDelta: r.onHandDelta,
      reservedDelta: r.reservedDelta,
      onHandAfter: r.onHandAfter,
      reservedAfter: r.reservedAfter,
      unitCost: r.unitCost,
      note: r.note,
      orderId: r.orderId,
      returnId: r.returnId,
      actorType: r.actorType,
      actorName: r.actorName,
      variantId: r.variantId,
      sku: r.sku,
      label: variantLabel(r.combo, axisOf.get(r.productId) ?? []),
      productId: r.productId,
      productName: r.productName,
    })),
    refs: {
      orders: Object.fromEntries(orders.map((o) => [o.id, o.orderNumber])),
      returns: Object.fromEntries(returns.map((x) => [x.id, x.requestNumber])),
    },
  };
}
