import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { optionSignature } from "./options";
import type { AdminSession } from "./auth";
import {
  MOVEMENT_META,
  SYSTEM_ACTOR,
  isManualMovementType,
  type ManualMovementType,
  type MovementType,
  type StockActor,
} from "./inventory-types";

/**
 * The inventory engine. **Every change to a variant's stock goes through
 * `applyMovement` in this file** — nothing else writes `onHand`, `reserved` or
 * `available`, and nothing edits or deletes a `StockMovement`.
 *
 * ## The model
 *
 * - `onHand` — units physically in the store.
 * - `reserved` — units promised to open orders that have not shipped.
 * - `available = onHand − reserved` — what the storefront may still sell.
 *
 * Stock leaves the shelf in two steps, the way Shopify's "committed" and
 * Amazon's "reserved" work: an order **reserves** at placement (so the next
 * shopper cannot buy the same unit) and **sells** at shipping (when it
 * physically leaves). Cancel before shipping **releases**. That split is the
 * whole reason `reserved` exists — deducting at placement makes a cancelled
 * order look like a shelf that needs restocking, and deducting at shipping lets
 * two people buy the last unit.
 *
 * ## Only tracked products are touched
 *
 * `Product.trackInventory` is false by default. An untracked product sells
 * exactly as it did before this file existed — the legacy `Product.stock`
 * counter, decremented at checkout — and every function here returns early for
 * it. Callers get back which products *were* handled so they can run the legacy
 * path for the rest and never both.
 *
 * ## `Product.stock` is a mirror for tracked products
 *
 * ~40 files read `Product.stock`. Rather than change them all, a tracked
 * product's `stock` is rewritten in the same transaction as every movement, to
 * the sum of its variants' positive `available`. Same pattern as
 * `autoShipOnConfirm` and `Product.variants[].images` elsewhere in this repo:
 * one authority, one derived mirror, one writer.
 */

type Tx = Prisma.TransactionClient;

/* ------------------------------------------------------------------ */
/*  Errors                                                             */
/* ------------------------------------------------------------------ */

/** Thrown by `reserveForOrder` inside the checkout transaction to roll it back. */
export class OutOfStockError extends Error {
  constructor(
    public readonly productName: string,
    public readonly variantLabel: string,
    public readonly available: number,
    public readonly requested: number
  ) {
    super(
      available <= 0
        ? `“${productName}”${variantLabel ? ` (${variantLabel})` : ""} is out of stock.`
        : `Only ${available} left of “${productName}”${variantLabel ? ` (${variantLabel})` : ""} — you asked for ${requested}.`
    );
    this.name = "OutOfStockError";
  }
}

const isUniqueViolation = (e: unknown) =>
  e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

/* ------------------------------------------------------------------ */
/*  Actors                                                             */
/* ------------------------------------------------------------------ */

/**
 * Who did it, from the admin session. A temp admin is recorded as one, with
 * their name copied onto the row — because deleting a temp admin deletes their
 * activity log, and the stock ledger must still say who wrote off those ten
 * hoodies after they are gone.
 */
export function actorFromAdminSession(session: AdminSession): StockActor {
  return {
    type: session.tempAdminId ? "temp_admin" : "admin",
    id: session.tempAdminId ?? session.id,
    name: session.name || session.email,
  };
}

/* ------------------------------------------------------------------ */
/*  The one writer                                                     */
/* ------------------------------------------------------------------ */

type MovementInput = {
  variantId: string;
  type: MovementType;
  onHandDelta: number;
  reservedDelta: number;
  unitCost?: number | null;
  note?: string | null;
  orderId?: string | null;
  returnId?: string | null;
  /** Set for every automatic entry. Two writers with the same key write once. */
  idemKey?: string | null;
  actor: StockActor;
  /**
   * RESERVE only: refuse unless at least this many are available. This is the
   * oversell guard, and it is a compare-and-set on the row — not a read
   * followed by a write — so two shoppers racing for the last unit cannot both
   * win it.
   */
  requireAvailable?: number;
};

/**
 * Apply one movement inside `tx`: move the counters and write the ledger row
 * with the balances *after* it. The product's mirror is **not** refreshed
 * here — the product id is added to `touched`, and the caller refreshes each
 * touched product once, at the end, with `refreshMirrors`.
 *
 * That split is a measured fix, not tidiness. Refreshing per movement cost two
 * extra round trips each, and `startTracking` on a two-size product took 11.4 s
 * from a dev machine to Mumbai against Prisma's 5 s transaction timeout — the
 * transaction expired and nothing was tracked. A 10-size product at checkout
 * would hit the same wall on a slow moment in production.
 *
 * Returns `"applied"`, or `"duplicate"` when `idemKey` was already used — a
 * webhook and the poller both marking one order shipped is the normal case
 * this exists for, not an error.
 */
async function applyMovement(
  tx: Tx,
  m: MovementInput,
  touched: Set<string>
): Promise<"applied" | "duplicate"> {
  // Not an optimisation: a re-run of a multi-size step must skip the sizes it
  // already did. Without this, the first size's unique-key clash would roll
  // back the whole transaction, and a size that was *not* yet done never gets
  // done. The unique index on `idemKey` is still what settles a true race.
  if (m.idemKey) {
    const seen = await tx.stockMovement.findUnique({ where: { idemKey: m.idemKey }, select: { id: true } });
    if (seen) return "duplicate";
  }

  const availableDelta = m.onHandDelta - m.reservedDelta;
  const data = {
    onHand: { increment: m.onHandDelta },
    reserved: { increment: m.reservedDelta },
    available: { increment: availableDelta },
  };

  let after: { onHand: number; reserved: number; productId: string };
  if (m.requireAvailable != null) {
    // `updateMany` is the only form that takes a condition on a non-unique
    // column, and it returns a count rather than the row — so this path needs
    // one read after. The row is locked by the update, so the read is exact.
    const { count } = await tx.productVariant.updateMany({
      where: { id: m.variantId, available: { gte: m.requireAvailable } },
      data,
    });
    if (count === 0) {
      const v = await tx.productVariant.findUnique({
        where: { id: m.variantId },
        select: { available: true, combo: true, product: { select: { name: true } } },
      });
      throw new OutOfStockError(
        v?.product.name ?? "This item",
        comboLabel(v?.combo),
        v?.available ?? 0,
        m.requireAvailable
      );
    }
    after = await tx.productVariant.findUniqueOrThrow({
      where: { id: m.variantId },
      select: { onHand: true, reserved: true, productId: true },
    });
  } else {
    // One round trip: the update returns the row it wrote.
    after = await tx.productVariant.update({
      where: { id: m.variantId },
      data,
      select: { onHand: true, reserved: true, productId: true },
    });
  }

  touched.add(after.productId);

  await tx.stockMovement.create({
    data: {
      variantId: m.variantId,
      type: m.type,
      onHandDelta: m.onHandDelta,
      reservedDelta: m.reservedDelta,
      onHandAfter: after.onHand,
      reservedAfter: after.reserved,
      unitCost: m.unitCost ?? null,
      note: m.note?.trim() || null,
      orderId: m.orderId ?? null,
      returnId: m.returnId ?? null,
      idemKey: m.idemKey ?? null,
      actorType: m.actor.type,
      actorId: m.actor.id ?? null,
      actorName: m.actor.name ?? null,
    },
  });

  return "applied";
}

/**
 * Rewrite each touched, tracked product's `stock` to what its variants can
 * actually sell. Called **once per transaction**, after every movement in it.
 *
 * Sums **positive** `available` only: an oversold size (available −2) must not
 * cancel out a healthy one (available 5) and make the product read as 3 in
 * stock when one size cannot be bought at all.
 */
async function refreshMirrors(tx: Tx, touched: Set<string>): Promise<void> {
  if (touched.size === 0) return;
  const products = await tx.product.findMany({
    where: { id: { in: [...touched] }, trackInventory: true },
    select: { id: true, variantRows: { where: { isActive: true }, select: { available: true } } },
  });
  for (const p of products) {
    const stock = p.variantRows.reduce((n, v) => n + Math.max(0, v.available), 0);
    await tx.product.update({ where: { id: p.id }, data: { stock } });
  }
}

/**
 * Transaction limits for every multi-step stock change, including the
 * checkout's — which is why it is exported.
 *
 * The 5 s Prisma default is too tight for a transaction that makes a few
 * round trips per size: it expired at 11.4 s in testing from India to Mumbai.
 * 20 s is a ceiling for a slow moment, not a target — with mirrors refreshed
 * once per transaction the same work is a small fraction of that. `maxWait`
 * bounds how long a request queues for one of the pool's five connections
 * (`connection_limit=5`, CLAUDE.md) before failing loudly rather than hanging.
 */
export const INVENTORY_TX_OPTIONS = { timeout: 20_000, maxWait: 10_000 } as const;

/** `{ Size: "M", color: "red" }` → `"color: red · Size: M"`, matching how returns label a line. */
function comboLabel(combo: unknown): string {
  if (!combo || typeof combo !== "object") return "";
  return Object.entries(combo as Record<string, string>)
    .map(([k, v]) => `${k}: ${v}`)
    .join(" · ");
}

/* ------------------------------------------------------------------ */
/*  Order lines → variants                                             */
/* ------------------------------------------------------------------ */

type OrderLine = {
  productId: string;
  quantity: number;
  options?: { name: string; value: string }[];
};

type ResolvedLine = { variantId: string; productId: string; quantity: number };

/**
 * Map order lines onto tracked variants, **summing lines that land on the same
 * unit** — a basket with two separate "Samurai, M" lines reserves 2 of one SKU,
 * not 1 of it twice.
 *
 * Lines for untracked products are left out, and their product ids are
 * reported, so the caller knows exactly which lines still need the legacy
 * `Product.stock` path.
 */
async function resolveLines(
  tx: Tx,
  lines: OrderLine[]
): Promise<{ resolved: ResolvedLine[]; trackedProductIds: Set<string>; missing: { productId: string; key: string }[] }> {
  const productIds = [...new Set(lines.map((l) => l.productId).filter(Boolean))];
  if (productIds.length === 0) return { resolved: [], trackedProductIds: new Set(), missing: [] };

  const products = await tx.product.findMany({
    where: { id: { in: productIds }, trackInventory: true },
    select: { id: true, variantRows: { select: { id: true, comboKey: true, isActive: true } } },
  });
  const trackedProductIds = new Set(products.map((p) => p.id));
  const byProduct = new Map(products.map((p) => [p.id, p.variantRows]));

  const totals = new Map<string, ResolvedLine>();
  const missing: { productId: string; key: string }[] = [];

  for (const line of lines) {
    const rows = byProduct.get(line.productId);
    if (!rows) continue; // untracked — legacy path
    const key = optionSignature(line.options);
    const row = rows.find((r) => r.comboKey === key && r.isActive);
    if (!row) {
      missing.push({ productId: line.productId, key });
      continue;
    }
    const prev = totals.get(row.id);
    const qty = Math.max(0, Math.floor(Number(line.quantity) || 0));
    if (qty === 0) continue;
    totals.set(row.id, { variantId: row.id, productId: line.productId, quantity: (prev?.quantity ?? 0) + qty });
  }

  return { resolved: [...totals.values()], trackedProductIds, missing };
}

/**
 * How much of each variant this order still holds in reserve, read **from the
 * ledger**, not from the order's items. That is what makes release and sale
 * correct for an order placed *before* its product was tracked: it reserved
 * nothing, so there is nothing to release, and its sale takes units off the
 * shelf without touching `reserved`.
 */
async function outstandingReservations(tx: Tx, orderId: string): Promise<Map<string, number>> {
  const rows = await tx.stockMovement.groupBy({
    by: ["variantId"],
    where: { orderId },
    _sum: { reservedDelta: true },
  });
  const out = new Map<string, number>();
  for (const r of rows) {
    const held = r._sum.reservedDelta ?? 0;
    if (held > 0) out.set(r.variantId, held);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  The order lifecycle                                                */
/* ------------------------------------------------------------------ */

/**
 * **Order placed.** Reserve every tracked line, inside the checkout's own
 * transaction.
 *
 * Throws `OutOfStockError` when a unit is not available — the caller lets it
 * propagate so the transaction rolls back and no order row exists. Returns the
 * product ids it handled so the caller runs the legacy `Product.stock`
 * decrement for the others only.
 *
 * A tracked product with a line that matches **no variant row** is refused
 * rather than sold: a tracked product promises per-size control, and selling a
 * size it has no stock record for is the exact overselling this exists to stop.
 *
 * The caller's `$transaction` should pass `INVENTORY_TX_OPTIONS` — this adds a
 * few round trips per line to a transaction that already writes the order.
 */
export async function reserveForOrder(
  tx: Tx,
  input: { orderId: string; lines: OrderLine[]; actor?: StockActor }
): Promise<{ trackedProductIds: Set<string> }> {
  const { resolved, trackedProductIds, missing } = await resolveLines(tx, input.lines);

  if (missing.length > 0) {
    const p = await tx.product.findUnique({ where: { id: missing[0].productId }, select: { name: true } });
    throw new OutOfStockError(p?.name ?? "This item", missing[0].key.replace(/=/g, ": ").replace(/\|/g, " · "), 0, 1);
  }

  const touched = new Set<string>();
  for (const line of resolved) {
    await applyMovement(
      tx,
      {
        variantId: line.variantId,
        type: "RESERVE",
        onHandDelta: 0,
        reservedDelta: line.quantity,
        orderId: input.orderId,
        idemKey: `reserve:${input.orderId}:${line.variantId}`,
        actor: input.actor ?? SYSTEM_ACTOR,
        requireAvailable: line.quantity,
      },
      touched
    );
  }
  await refreshMirrors(tx, touched);

  return { trackedProductIds };
}

/**
 * **Order cancelled before it shipped.** Give back whatever it still holds.
 *
 * Reads the ledger, so it is safe to call for any order in any state: an order
 * that reserved nothing (untracked, or placed before tracking) releases
 * nothing, and calling it twice releases once.
 *
 * Returns the products it released for, so the caller skips the legacy
 * `Product.stock` increment for exactly those and never restocks twice.
 */
export async function releaseForOrder(
  orderId: string,
  actor: StockActor = SYSTEM_ACTOR
): Promise<{ released: number; trackedProductIds: Set<string> }> {
  return runIdempotent(async (tx) => {
    const held = await outstandingReservations(tx, orderId);
    const touched = new Set<string>();
    let released = 0;
    for (const [variantId, qty] of held) {
      const r = await applyMovement(
        tx,
        {
          variantId,
          type: "RELEASE",
          onHandDelta: 0,
          reservedDelta: -qty,
          orderId,
          idemKey: `release:${orderId}:${variantId}`,
          actor,
        },
        touched
      );
      if (r === "applied") released += qty;
    }
    await refreshMirrors(tx, touched);
    return { released, trackedProductIds: touched };
  }, { released: 0, trackedProductIds: new Set<string>() });
}

/**
 * **Order shipped.** The units leave the shelf.
 *
 * Quantities come from the order's lines — that is what physically went in the
 * parcel — and whatever part of it was reserved is released at the same time.
 * An order placed before tracking started reserved nothing, so its sale only
 * reduces `onHand`.
 */
export async function sellForOrder(
  orderId: string,
  actor: StockActor = SYSTEM_ACTOR
): Promise<{ sold: number }> {
  return runIdempotent(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId }, select: { items: true } });
    if (!order) return { sold: 0 };
    const { resolved } = await resolveLines(tx, (order.items as unknown as OrderLine[]) ?? []);
    if (resolved.length === 0) return { sold: 0 };
    const held = await outstandingReservations(tx, orderId);
    const touched = new Set<string>();
    let sold = 0;
    for (const line of resolved) {
      const fromReserve = Math.min(line.quantity, held.get(line.variantId) ?? 0);
      const r = await applyMovement(
        tx,
        {
          variantId: line.variantId,
          type: "SALE",
          onHandDelta: -line.quantity,
          reservedDelta: -fromReserve,
          orderId,
          idemKey: `sale:${orderId}:${line.variantId}`,
          actor,
        },
        touched
      );
      if (r === "applied") sold += line.quantity;
    }
    await refreshMirrors(tx, touched);
    return { sold };
  }, { sold: 0 });
}

/**
 * **A delivery failed and the parcel came back.** Only if it had actually
 * shipped — an RTO for an order that never left cannot put units back on a
 * shelf they never left.
 */
export async function restockRto(
  orderId: string,
  actor: StockActor = SYSTEM_ACTOR
): Promise<{ restocked: number }> {
  return runIdempotent(async (tx) => {
    const sales = await tx.stockMovement.findMany({
      where: { orderId, type: "SALE" },
      select: { variantId: true, onHandDelta: true },
    });
    const touched = new Set<string>();
    let restocked = 0;
    for (const s of sales) {
      const qty = -s.onHandDelta;
      if (qty <= 0) continue;
      const r = await applyMovement(
        tx,
        {
          variantId: s.variantId,
          type: "RTO",
          onHandDelta: qty,
          reservedDelta: 0,
          orderId,
          idemKey: `rto:${orderId}:${s.variantId}`,
          actor,
        },
        touched
      );
      if (r === "applied") restocked += qty;
    }
    await refreshMirrors(tx, touched);
    return { restocked };
  }, { restocked: 0 });
}

/**
 * **A customer return reached the store.**
 *
 * `restock: false` is for goods that came back unsellable — the return is
 * recorded, the units are not put back, and the caller should record a DAMAGE
 * if they want the write-off in the ledger. Defaults to true because most
 * returns are a wrong size, not a ruined garment.
 *
 * The return is matched to its order line by product **and** by rebuilding the
 * line's label exactly the way `actions/returns.ts` builds `variantLabel` — so
 * an order holding the same tee in two sizes returns the right one.
 */
export async function restockReturn(
  returnId: string,
  opts: { restock?: boolean; actor?: StockActor } = {}
): Promise<{ restocked: number; reason?: string }> {
  if (opts.restock === false) return { restocked: 0, reason: "Marked not restockable." };
  const actor = opts.actor ?? SYSTEM_ACTOR;

  return runIdempotent(async (tx) => {
    const ret = await tx.returnRequest.findUnique({
      where: { id: returnId },
      select: { orderId: true, productId: true, variantLabel: true, quantity: true, order: { select: { items: true } } },
    });
    if (!ret?.productId) return { restocked: 0, reason: "The return names no product." };

    const lines = ((ret.order.items as unknown as OrderLine[]) ?? []).filter((l) => l.productId === ret.productId);
    const label = (l: OrderLine) => (l.options ?? []).map((o) => `${o.name}: ${o.value}`).join(" · ");
    const line =
      lines.find((l) => (label(l) || null) === (ret.variantLabel || null)) ?? (lines.length === 1 ? lines[0] : null);
    if (!line) return { restocked: 0, reason: "Could not tell which size this return was." };

    const { resolved } = await resolveLines(tx, [{ ...line, quantity: ret.quantity }]);
    if (resolved.length === 0) return { restocked: 0, reason: "That product is not tracked." };

    const v = resolved[0];
    const touched = new Set<string>();
    const r = await applyMovement(
      tx,
      {
        variantId: v.variantId,
        type: "RETURN",
        onHandDelta: v.quantity,
        reservedDelta: 0,
        orderId: ret.orderId,
        returnId,
        idemKey: `return:${returnId}:${v.variantId}`,
        actor,
      },
      touched
    );
    await refreshMirrors(tx, touched);
    return { restocked: r === "applied" ? v.quantity : 0 };
  }, { restocked: 0 });
}

/**
 * Run a lifecycle step in its own transaction. A unique-key race — two
 * processes applying the same step at once — rolls one back entirely, and the
 * other has already done the work, so that is reported as the empty result
 * rather than thrown.
 */
async function runIdempotent<T>(fn: (tx: Tx) => Promise<T>, onDuplicate: T): Promise<T> {
  try {
    return await prisma.$transaction(fn, INVENTORY_TX_OPTIONS);
  } catch (e) {
    if (isUniqueViolation(e)) return onDuplicate;
    throw e;
  }
}

/* ------------------------------------------------------------------ */
/*  By hand                                                            */
/* ------------------------------------------------------------------ */

export type ManualMovementInput = {
  variantId: string;
  type: ManualMovementType;
  /**
   * RECEIPT, DAMAGE, PERSONAL_USE: how many units, always positive.
   * ADJUSTMENT: ignored — pass `countedOnHand` instead.
   */
  quantity?: number;
  /**
   * ADJUSTMENT: what you counted on the shelf. The difference is computed here,
   * because a person doing a stocktake knows what they are holding, not the
   * signed delta against a number on a screen.
   */
  countedOnHand?: number;
  unitCost?: number | null;
  note?: string | null;
  actor: StockActor;
};

export type ManualMovementResult =
  | { ok: true; onHand: number; reserved: number; available: number; delta: number }
  | { ok: false; error: string };

/**
 * The four entries a person records: stock in, damaged, personal use, recount.
 *
 * Refuses anything else by type, so a SALE with no order behind it can never be
 * typed in. Refuses to remove more than is on the shelf: you cannot damage
 * units you do not have, and allowing it would hide a counting error behind a
 * negative number.
 */
export async function recordManualMovement(input: ManualMovementInput): Promise<ManualMovementResult> {
  if (!isManualMovementType(input.type)) {
    return { ok: false, error: "That kind of entry is made by orders and returns, not by hand." };
  }
  const meta = MOVEMENT_META[input.type];
  const note = input.note?.trim() || "";
  if (meta.requiresNote && !note) {
    return { ok: false, error: `Say why — a ${meta.label.toLowerCase()} entry needs a reason.` };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const v = await tx.productVariant.findUnique({
        where: { id: input.variantId },
        select: { onHand: true, isActive: true, product: { select: { trackInventory: true } } },
      });
      if (!v) return { ok: false as const, error: "That item no longer exists." };
      if (!v.product.trackInventory) {
        return { ok: false as const, error: "Start tracking this product first." };
      }

      let delta: number;
      if (input.type === "ADJUSTMENT") {
        const counted = Math.floor(Number(input.countedOnHand));
        if (!Number.isFinite(counted) || counted < 0) {
          return { ok: false as const, error: "Enter the number you counted — zero or more." };
        }
        delta = counted - v.onHand;
        if (delta === 0) return { ok: false as const, error: "That matches the record already — nothing to change." };
      } else {
        const qty = Math.floor(Number(input.quantity));
        if (!Number.isFinite(qty) || qty <= 0) {
          return { ok: false as const, error: "Enter how many — a whole number above zero." };
        }
        delta = meta.direction === "in" ? qty : -qty;
        if (delta < 0 && v.onHand + delta < 0) {
          return {
            ok: false as const,
            error: `Only ${v.onHand} on the shelf — you cannot take out ${qty}. If the record is wrong, recount it first.`,
          };
        }
      }

      const touched = new Set<string>();
      await applyMovement(
        tx,
        {
          variantId: input.variantId,
          type: input.type,
          onHandDelta: delta,
          reservedDelta: 0,
          unitCost: input.type === "RECEIPT" ? (input.unitCost ?? null) : null,
          note: note || null,
          actor: input.actor,
        },
        touched
      );
      await refreshMirrors(tx, touched);

      const after = await tx.productVariant.findUniqueOrThrow({
        where: { id: input.variantId },
        select: { onHand: true, reserved: true, available: true },
      });
      return { ok: true as const, ...after, delta };
    }, INVENTORY_TX_OPTIONS);
  } catch (e) {
    console.error("[inventory] manual movement failed:", e);
    return { ok: false, error: "Could not save that entry. Please try again." };
  }
}

/* ------------------------------------------------------------------ */
/*  Starting and stopping                                              */
/* ------------------------------------------------------------------ */

/** Orders whose units are promised but still on the shelf. */
const OPEN_ORDER_STATUSES = ["pending", "confirmed"];

export type StartTrackingResult =
  | { ok: true; opening: number; reservedForOpenOrders: number; oversold: string[] }
  | { ok: false; error: string };

/**
 * **Begin tracking a product**, from a real count of every size.
 *
 * The existing `Product.stock` is one number for all sizes and cannot be split
 * honestly, so this requires the owner's count per variant. Every variant must
 * be counted — a missing size would silently start at zero and stop selling.
 *
 * Open orders for this product (placed but not shipped) are then reserved
 * against the count, because those units are on the shelf and already sold. If
 * that promises more than was counted, the size is **oversold** and reported —
 * those orders cannot all be filled from stock, and the owner needs to know
 * now, not when the courier arrives.
 */
export async function startTracking(input: {
  productId: string;
  counts: Record<string, number>;
  actor: StockActor;
}): Promise<StartTrackingResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: input.productId },
        select: { name: true, trackInventory: true, variantRows: { where: { isActive: true }, select: { id: true, sku: true, onHand: true } } },
      });
      if (!product) return { ok: false as const, error: "Product not found." };
      if (product.trackInventory) return { ok: false as const, error: "This product is already tracked." };
      if (product.variantRows.length === 0) {
        return { ok: false as const, error: "This product has no sizes set up yet. Save it once in the editor first." };
      }

      const uncounted = product.variantRows.filter((v) => {
        const n = input.counts[v.id];
        return n == null || !Number.isFinite(Number(n)) || Number(n) < 0;
      });
      if (uncounted.length > 0) {
        return { ok: false as const, error: `Count every size first — missing ${uncounted.map((v) => v.sku).join(", ")}.` };
      }

      // Tracking on first, so the single mirror refresh at the end writes it.
      await tx.product.update({ where: { id: input.productId }, data: { trackInventory: true } });

      const touched = new Set<string>();
      let opening = 0;
      for (const v of product.variantRows) {
        const count = Math.floor(Number(input.counts[v.id]));
        // Written for every size, zero included and even when the number did
        // not move: the ledger should show that each size *was* counted, not
        // leave the reader to infer it from a gap. The delta rather than the
        // count, because a variant can carry leftovers from an earlier tracking
        // period and the opening entry has to land it on exactly what was seen.
        await applyMovement(
          tx,
          {
            variantId: v.id,
            type: "OPENING",
            onHandDelta: count - v.onHand,
            reservedDelta: 0,
            note: `Counted ${count} when tracking started.`,
            actor: input.actor,
          },
          touched
        );
        opening += count;
      }

      // Only the open orders that contain this product — `@>` containment on
      // the items array, rather than every open order in the store.
      const open = await tx.order.findMany({
        where: {
          status: { in: OPEN_ORDER_STATUSES },
          items: { array_contains: [{ productId: input.productId }] },
        },
        select: { id: true, items: true },
      });
      let reservedForOpenOrders = 0;
      const reservedVariants = new Set<string>();
      for (const o of open) {
        const lines = ((o.items as unknown as OrderLine[]) ?? []).filter((l) => l.productId === input.productId);
        if (lines.length === 0) continue;
        const { resolved } = await resolveLines(tx, lines);
        for (const line of resolved) {
          // No `requireAvailable`: these units are already sold. If the count
          // cannot cover them, `available` goes negative and says so.
          const r = await applyMovement(
            tx,
            {
              variantId: line.variantId,
              type: "RESERVE",
              onHandDelta: 0,
              reservedDelta: line.quantity,
              orderId: o.id,
              note: "Open order, reserved when tracking started.",
              idemKey: `reserve:${o.id}:${line.variantId}`,
              actor: input.actor,
            },
            touched
          );
          if (r === "applied") {
            reservedForOpenOrders += line.quantity;
            reservedVariants.add(line.variantId);
          }
        }
      }

      await refreshMirrors(tx, touched);

      const oversold = (
        await tx.productVariant.findMany({
          where: { id: { in: [...reservedVariants] }, available: { lt: 0 } },
          select: { sku: true },
        })
      ).map((v) => v.sku);

      return { ok: true as const, opening, reservedForOpenOrders, oversold };
    }, INVENTORY_TX_OPTIONS);
  } catch (e) {
    console.error("[inventory] startTracking failed:", e);
    return { ok: false, error: "Could not start tracking. Nothing was changed." };
  }
}

/**
 * **Stop tracking.** The ledger is kept, untouched — turning tracking back on
 * later starts from a fresh count. `Product.stock` is left at its last mirrored
 * value, which is the closest honest number the legacy counter can hold.
 */
export async function stopTracking(productId: string): Promise<{ ok: boolean; error?: string }> {
  const p = await prisma.product.findUnique({ where: { id: productId }, select: { trackInventory: true } });
  if (!p) return { ok: false, error: "Product not found." };
  if (!p.trackInventory) return { ok: true };
  await prisma.product.update({ where: { id: productId }, data: { trackInventory: false } });
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/*  Reading                                                            */
/* ------------------------------------------------------------------ */

export type MovementRow = {
  id: string;
  at: Date;
  type: MovementType;
  onHandDelta: number;
  reservedDelta: number;
  onHandAfter: number;
  reservedAfter: number;
  unitCost: number | null;
  note: string | null;
  orderId: string | null;
  returnId: string | null;
  actorType: string;
  actorName: string | null;
  variantId: string;
  sku: string;
  combo: Record<string, string>;
  productId: string;
  productName: string;
};

/**
 * The ledger, newest first, cursor-paged. Filter by one variant, one product,
 * one order, or a type — the four questions an owner actually asks ("what
 * happened to this size", "this product", "this order", "show me all the
 * write-offs").
 */
export async function listMovements(input: {
  variantId?: string;
  productId?: string;
  orderId?: string;
  type?: MovementType;
  from?: Date;
  to?: Date;
  cursor?: string;
  limit?: number;
}): Promise<{ rows: MovementRow[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
  const where: Prisma.StockMovementWhereInput = {
    ...(input.variantId ? { variantId: input.variantId } : {}),
    ...(input.productId ? { variant: { productId: input.productId } } : {}),
    ...(input.orderId ? { orderId: input.orderId } : {}),
    ...(input.type ? { type: input.type } : {}),
    ...(input.from || input.to
      ? { createdAt: { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lte: input.to } : {}) } }
      : {}),
  };

  const rows = await prisma.stockMovement.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    include: { variant: { select: { sku: true, combo: true, productId: true, product: { select: { name: true } } } } },
  });

  const page = rows.slice(0, limit);
  return {
    nextCursor: rows.length > limit ? page[page.length - 1].id : null,
    rows: page.map((r) => ({
      id: r.id,
      at: r.createdAt,
      type: r.type as MovementType,
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
      sku: r.variant.sku,
      combo: (r.variant.combo as Record<string, string>) ?? {},
      productId: r.variant.productId,
      productName: r.variant.product.name,
    })),
  };
}

/**
 * What the stock on the shelf is worth, at cost.
 *
 * Units with no cost price anywhere are counted but not valued, and reported
 * separately — a valuation that silently treats unknown cost as zero understates
 * the business and looks precise while doing it.
 */
export async function inventoryValuation(): Promise<{
  units: number;
  valuedUnits: number;
  value: number;
  unvaluedUnits: number;
}> {
  const variants = await prisma.productVariant.findMany({
    where: { isActive: true, product: { trackInventory: true }, onHand: { gt: 0 } },
    select: { onHand: true, costPrice: true, product: { select: { costPrice: true } } },
  });
  let units = 0;
  let valuedUnits = 0;
  let value = 0;
  for (const v of variants) {
    units += v.onHand;
    const cost = v.costPrice ?? v.product.costPrice;
    if (cost != null) {
      valuedUnits += v.onHand;
      value += v.onHand * cost;
    }
  }
  return { units, valuedUnits, value, unvaluedUnits: units - valuedUnits };
}

/** Does the ledger explain the counters? Every variant, every time. For tests and a health check. */
export async function auditLedger(): Promise<{ ok: boolean; drift: { sku: string; field: string; stored: number; ledger: number }[] }> {
  const sums = await prisma.stockMovement.groupBy({
    by: ["variantId"],
    _sum: { onHandDelta: true, reservedDelta: true },
  });
  const byId = new Map(sums.map((s) => [s.variantId, s._sum]));
  const variants = await prisma.productVariant.findMany({
    select: { id: true, sku: true, onHand: true, reserved: true, available: true },
  });
  const drift: { sku: string; field: string; stored: number; ledger: number }[] = [];
  for (const v of variants) {
    const s = byId.get(v.id);
    const onHand = s?.onHandDelta ?? 0;
    const reserved = s?.reservedDelta ?? 0;
    if (v.onHand !== onHand) drift.push({ sku: v.sku, field: "onHand", stored: v.onHand, ledger: onHand });
    if (v.reserved !== reserved) drift.push({ sku: v.sku, field: "reserved", stored: v.reserved, ledger: reserved });
    if (v.available !== onHand - reserved)
      drift.push({ sku: v.sku, field: "available", stored: v.available, ledger: onHand - reserved });
  }
  return { ok: drift.length === 0, drift };
}
