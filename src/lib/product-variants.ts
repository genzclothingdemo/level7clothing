import "server-only";
import { Prisma } from "@prisma/client";
import { allCombinations, comboKey } from "./options";
import { SKU_PATTERN, generateSku, normaliseSku, skuPrefixFor } from "./sku";
import {
  deriveVariantModel,
  normalisePriceOverride,
  settleVariantPrices,
  type SellableVariantMirror,
} from "./variants";
import type { Attribute } from "./types";

/**
 * Keeps a product's `ProductVariant` rows in step with its options, and builds
 * the `sellableVariants` mirror checkout charges from — both inside the product
 * save's own transaction, so a save either lands whole or not at all.
 *
 * ## The rows follow the combinations
 *
 * One row per combination of the product's options (one row keyed `""` for a
 * product with none — the same rule `scripts/backfill-variant-rows.mts` used):
 *
 * - **a new combination** gets a new row and a generated SKU;
 * - **an existing combination keeps its row and its SKU.** A SKU is printed on
 *   labels and typed into courier forms, so nothing here ever regenerates one —
 *   renaming the product or its category leaves every SKU exactly as it was.
 *   Only the admin typing a new one changes it;
 * - **a removed combination** is *deleted* when it has no stock history, and
 *   **retired** (`isActive: false`, SKU kept) when it has any — `StockMovement`
 *   is `onDelete: Restrict`, so the database would refuse the delete anyway,
 *   and a ledger that can be silently destroyed is not a ledger. Adding the
 *   combination back later reactivates the same row, SKU and history intact.
 *
 * A removed combination with units **reserved for open orders** is refused
 * outright: `sellForOrder` only matches active rows, so retiring it would leave
 * those orders unable to ship against the ledger.
 *
 * Unchanged rows are not written at all, so opening a product and saving it
 * without touching anything leaves every row — `updatedAt` included — as it was.
 *
 * ## Stock is not written here
 *
 * `onHand` / `reserved` / `available` belong to `lib/inventory.ts` and its
 * ledger. This file only reads them: to decide delete-versus-retire, and to put
 * a tracked product's live per-size availability into the storefront mirror.
 */

type Tx = Prisma.TransactionClient;

/**
 * More than this and the editor's grid, the mirror JSON and the save
 * transaction all stop being reasonable. Shopify's long-standing limit was 100.
 */
export const MAX_COMBINATIONS = 250;

/**
 * Limits for the product save's transaction. It makes one read of the rows and
 * writes only what changed, but a first save of a many-size product creates
 * every row — and every round trip crosses to Mumbai (CLAUDE.md). Same numbers
 * as `INVENTORY_TX_OPTIONS`, for the same measured reason.
 */
export const PRODUCT_SAVE_TX_OPTIONS = { timeout: 20_000, maxWait: 10_000 } as const;

/** What the editor sends for one combination. Its price is not here — see `planVariants`. */
export type VariantRowEdit = {
  /** `comboKey(combo)` — `""` for a product with no options. */
  key: string;
  /** Blank = keep the row's SKU, or generate one for a new row. */
  sku?: string | null;
  /** Blank = no barcode. */
  barcode?: string | null;
  compareAtPrice?: number | null;
  costPrice?: number | null;
  lowStockAt?: number | null;
};

/** A save refused for a reason the admin can fix. The message is shown as-is. */
export class VariantSyncError extends Error {
  constructor(
    message: string,
    /** The combination it is about, so the editor can point at the row. */
    public readonly key?: string,
    public readonly field?: "sku" | "barcode" | "combination" | "compareAtPrice" | "costPrice" | "lowStockAt"
  ) {
    super(message);
    this.name = "VariantSyncError";
  }
}

/** A barcode as typed: EAN/UPC digits, or a Code 128-style label. */
export const BARCODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{2,47}$/;

/** `{ color: "red", Size: "S" }` → `"color red · Size S"`. */
export function comboLabel(combo: Record<string, string>): string {
  const parts = Object.entries(combo).map(([k, v]) => `${k} ${v}`);
  return parts.length ? parts.join(" · ") : "this product";
}

/* ------------------------------------------------------------------ */
/*  The plan — pure, runs before the transaction                       */
/* ------------------------------------------------------------------ */

type DesiredRow = {
  key: string;
  combo: Record<string, string>;
  sortOrder: number;
  /** Normalised, or `null` = keep the existing SKU / generate one. */
  sku: string | null;
  /** `undefined` = the editor said nothing about this row: keep what it has. */
  barcode: string | null | undefined;
  price: number | null;
  compareAtPrice: number | null | undefined;
  costPrice: number | null | undefined;
  lowStockAt: number | null | undefined;
};

export type VariantPlan = {
  attributes: Attribute[];
  /** Per-combination prices, availability and stock are on ("Separate prices"). */
  perCombination: boolean;
  /** `Product.price` — the cheapest available combination. */
  productPrice: number;
  /** `Product.variants` to store: the editor's draft with each price settled. */
  draft: Record<string, unknown>[];
  rows: DesiredRow[];
};

const money = (raw: unknown): number | null => {
  if (raw === "" || raw == null) return null;
  const n = Math.round(Number(raw));
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * Settle prices and normalise the per-row edits, refusing anything malformed
 * before a transaction is opened.
 *
 * **The draft is the one price channel.** `variants[].price` is what the
 * editor has always sent; it goes through `settleVariantPrices` once, and that
 * single answer is written to the draft, to `ProductVariant.price` and — via
 * `resolveVariantPrice` — to the mirror. With per-combination prices off, every
 * row inherits, which is exactly what an empty mirror charges.
 */
export function planVariants(input: {
  options: unknown;
  variants: unknown;
  basePrice: number;
  edits?: VariantRowEdit[];
}): VariantPlan {
  const { attributes } = deriveVariantModel({ options: input.options, variants: [], price: 0, stock: 0 });
  const combos = attributes.length ? allCombinations(attributes) : [{}];
  if (combos.length > MAX_COMBINATIONS) {
    throw new VariantSyncError(
      `These options make ${combos.length} combinations — the most one product can have is ${MAX_COMBINATIONS}. Split it into separate products, or remove some choices.`
    );
  }

  const rawDraft = (Array.isArray(input.variants) ? input.variants : []).filter(
    (v): v is Record<string, unknown> & { combo: Record<string, string> } =>
      !!v && typeof v === "object" && !!(v as { combo?: unknown }).combo && typeof (v as { combo?: unknown }).combo === "object"
  );
  const perCombination = rawDraft.length > 0;

  const settled = settleVariantPrices({
    basePrice: input.basePrice,
    combos: rawDraft.map((v) => ({
      key: comboKey(v.combo),
      override: v.price,
      available: v.available !== false,
    })),
  });
  // No draft means every combination sells at the base, like an empty mirror.
  const productPrice = perCombination ? settled.productPrice : Math.max(0, Math.round(Number(input.basePrice) || 0));

  // The stored draft carries the settled override, so reopening the editor
  // shows exactly what is charged — including a blank row pinned at the base.
  const draft = rawDraft.map((v) => {
    const o = settled.overrides[comboKey(v.combo)];
    return { ...v, price: o ?? "" };
  });

  const edits = new Map((input.edits ?? []).map((e) => [e.key, e]));
  const rows: DesiredRow[] = combos.map((combo, i) => {
    const key = comboKey(combo);
    const e = edits.get(key);
    const label = comboLabel(combo);

    let sku: string | null = null;
    if (e?.sku != null && String(e.sku).trim() !== "") {
      sku = normaliseSku(String(e.sku));
      if (!SKU_PATTERN.test(sku)) {
        throw new VariantSyncError(
          `SKU “${String(e.sku).trim()}” for ${label} isn't valid — use 3–40 capital letters, digits and hyphens, like L7-PT-SAMURAI-M.`,
          key,
          "sku"
        );
      }
    }

    // `undefined` (the editor said nothing) keeps the row's value; `null` or
    // "" clears it. Checked by value, not with `in`, so a schema that emits
    // absent optional keys as `undefined` still means "keep".
    let barcode: string | null | undefined;
    if (e && e.barcode !== undefined) {
      const b = String(e.barcode ?? "").trim();
      if (b && !BARCODE_PATTERN.test(b)) {
        throw new VariantSyncError(
          `Barcode “${b}” for ${label} isn't valid — use 3–48 letters and digits (hyphens, dots and underscores allowed).`,
          key,
          "barcode"
        );
      }
      barcode = b || null;
    }

    const opt = <K extends "compareAtPrice" | "costPrice" | "lowStockAt">(k: K) =>
      e && e[k] !== undefined ? money(e[k]) : undefined;

    return {
      key,
      combo,
      sortOrder: i,
      sku,
      barcode,
      price: perCombination ? (settled.overrides[key] ?? null) : null,
      // A compare-at price is a price: with per-combination prices off, none.
      compareAtPrice: perCombination
        ? e && e.compareAtPrice !== undefined
          ? normalisePriceOverride(e.compareAtPrice)
          : undefined
        : null,
      costPrice: opt("costPrice"),
      lowStockAt: opt("lowStockAt"),
    };
  });

  return { attributes, perCombination, productPrice, draft, rows };
}

/* ------------------------------------------------------------------ */
/*  The sync — inside the product save's transaction                   */
/* ------------------------------------------------------------------ */

export type SyncedRow = {
  key: string;
  sku: string;
  price: number | null;
  compareAtPrice: number | null;
  available: number;
};

export type VariantSyncResult = {
  created: string[];
  deleted: string[];
  /** Removed from the options but kept, because they have stock history. */
  retired: string[];
  /** Back in the options: the retired row is active again. */
  restored: string[];
  updated: number;
  /** Did the set of active rows change? A tracked product's stock mirror depends on it. */
  activeSetChanged: boolean;
  /** Every current combination's row, in combination order. */
  rows: SyncedRow[];
};

const SWAP_PREFIX = "~SWAP~";

export async function syncVariantRows(
  tx: Tx,
  input: {
    productId: string;
    productName: string;
    category: string;
    brandName: string;
    plan: VariantPlan;
  }
): Promise<VariantSyncResult> {
  const { productId, plan } = input;

  const existing = await tx.productVariant.findMany({
    where: { productId },
    select: {
      id: true,
      comboKey: true,
      combo: true,
      sku: true,
      barcode: true,
      price: true,
      compareAtPrice: true,
      costPrice: true,
      lowStockAt: true,
      isActive: true,
      sortOrder: true,
      onHand: true,
      reserved: true,
      available: true,
      _count: { select: { movements: true } },
    },
  });
  type Existing = (typeof existing)[number];
  const byKey = new Map(existing.map((r) => [r.comboKey, r]));
  const wanted = new Set(plan.rows.map((r) => r.key));

  /* ---- Removed combinations: delete, or retire when there is history ---- */
  const toDelete: Existing[] = [];
  const toRetire: Existing[] = [];
  for (const r of existing) {
    if (wanted.has(r.comboKey)) continue;
    const label = comboLabel((r.combo as Record<string, string>) ?? {});
    if (r.reserved > 0) {
      throw new VariantSyncError(
        `Can't remove ${label} yet — ${r.reserved} unit${r.reserved === 1 ? " is" : "s are"} of ${r.sku} reserved for open orders. Ship or cancel those orders first, then remove it.`,
        r.comboKey,
        "combination"
      );
    }
    // The counters are the ledger's running sum, so non-zero counters with no
    // rows would be drift — treat it as history rather than delete the evidence.
    const hasHistory = r._count.movements > 0 || r.onHand !== 0 || r.reserved !== 0;
    if (hasHistory) {
      if (r.isActive) toRetire.push(r);
    } else {
      toDelete.push(r);
    }
  }
  const deletedIds = new Set(toDelete.map((r) => r.id));

  /* ---- Final SKU and barcode of every row that survives this save ---- */
  // Retired rows keep theirs: the SKU still names the units in the ledger.
  const kept = existing.filter((r) => !deletedIds.has(r.id));
  const finalSku = new Map<string, string>(); // rowKey → sku, for existing rows
  const finalBarcode = new Map<string, string | null>();
  for (const r of kept) {
    finalSku.set(r.comboKey, r.sku);
    finalBarcode.set(r.comboKey, r.barcode);
  }
  for (const d of plan.rows) {
    const cur = byKey.get(d.key);
    if (d.sku) finalSku.set(d.key, d.sku);
    else if (cur) finalSku.set(d.key, cur.sku);
    if (d.barcode !== undefined) finalBarcode.set(d.key, d.barcode);
    else if (!cur) finalBarcode.set(d.key, null);
  }

  const labelOf = (key: string) => {
    const live = plan.rows.find((r) => r.key === key);
    return live
      ? comboLabel(live.combo)
      : `${comboLabel((byKey.get(key)?.combo as Record<string, string>) ?? {})} (retired)`;
  };

  // Two rows of this product can't share one.
  const assertDistinct = (map: Map<string, string | null>, field: "sku" | "barcode", noun: string) => {
    const seen = new Map<string, string>();
    for (const [key, value] of map) {
      if (!value) continue;
      const other = seen.get(value);
      if (other !== undefined) {
        throw new VariantSyncError(
          `${labelOf(other)} and ${labelOf(key)} can't share ${noun} “${value}” — each size needs its own.`,
          key,
          field
        );
      }
      seen.set(value, key);
    }
  };
  assertDistinct(finalSku, "sku", "the SKU");
  assertDistinct(finalBarcode, "barcode", "the barcode");

  // …and nothing else in the store may hold one this save is newly claiming.
  const claimedSkus = plan.rows
    .filter((d) => d.sku && d.sku !== byKey.get(d.key)?.sku)
    .map((d) => d.sku!);
  const claimedBarcodes = plan.rows
    .filter((d) => d.barcode && d.barcode !== byKey.get(d.key)?.barcode)
    .map((d) => d.barcode!);
  if (claimedSkus.length || claimedBarcodes.length) {
    const clash = await tx.productVariant.findFirst({
      where: {
        productId: { not: productId },
        OR: [
          ...(claimedSkus.length ? [{ sku: { in: claimedSkus } }] : []),
          ...(claimedBarcodes.length ? [{ barcode: { in: claimedBarcodes } }] : []),
        ],
      },
      select: { sku: true, barcode: true, combo: true, isActive: true, product: { select: { name: true } } },
    });
    if (clash) {
      const bySku = claimedSkus.includes(clash.sku);
      const value = bySku ? clash.sku : clash.barcode!;
      const mine = plan.rows.find((d) => (bySku ? d.sku : d.barcode) === value)!;
      throw new VariantSyncError(
        `${bySku ? "SKU" : "Barcode"} “${value}” is already used by ${clash.product.name} (${comboLabel((clash.combo as Record<string, string>) ?? {})}${clash.isActive ? "" : ", retired"}). ${bySku ? "SKUs" : "Barcodes"} must be unique across the whole store.`,
        mine.key,
        bySku ? "sku" : "barcode"
      );
    }
  }

  /* ---- Writes ---- */
  if (toDelete.length) {
    await tx.productVariant.deleteMany({ where: { id: { in: toDelete.map((r) => r.id) } } });
  }

  // A swap (M↔L) would hit the unique index halfway through, so park the
  // moving values first — but only when one really lands on a sibling's.
  const moving = plan.rows
    .map((d) => ({ d, cur: byKey.get(d.key) }))
    .filter(({ d, cur }) => cur && !deletedIds.has(cur.id));
  const heldSku = new Map(kept.map((r) => [r.sku, r.id]));
  const heldBarcode = new Map(kept.filter((r) => r.barcode).map((r) => [r.barcode!, r.id]));
  const skuSwaps = moving.filter(
    ({ d, cur }) => d.sku && d.sku !== cur!.sku && heldSku.has(d.sku) && heldSku.get(d.sku) !== cur!.id
  );
  const barcodeSwaps = moving.filter(
    ({ d, cur }) =>
      d.barcode && d.barcode !== cur!.barcode && heldBarcode.has(d.barcode) && heldBarcode.get(d.barcode) !== cur!.id
  );
  if (skuSwaps.length || barcodeSwaps.length) {
    // Park every row whose value is changing, not only the colliding ones — a
    // three-way rotation collides on the second write otherwise.
    for (const { d, cur } of moving) {
      const data: Prisma.ProductVariantUpdateInput = {};
      if (skuSwaps.length && d.sku && d.sku !== cur!.sku) data.sku = `${SWAP_PREFIX}${cur!.id}`;
      if (barcodeSwaps.length && d.barcode !== undefined && d.barcode !== cur!.barcode) data.barcode = null;
      if (Object.keys(data).length) await tx.productVariant.update({ where: { id: cur!.id }, data });
    }
  }

  const result: VariantSyncResult = {
    created: [],
    deleted: toDelete.map((r) => r.sku),
    retired: toRetire.map((r) => r.sku),
    restored: [],
    updated: 0,
    activeSetChanged: toDelete.some((r) => r.isActive) || toRetire.length > 0,
    rows: [],
  };

  // New combinations need generated SKUs, unique against the whole table.
  const fresh = plan.rows.filter((d) => !byKey.has(d.key));
  let taken: Set<string> | null = null;
  if (fresh.some((d) => !d.sku)) {
    const all = await tx.productVariant.findMany({ select: { sku: true } });
    taken = new Set(all.map((v) => v.sku).filter((s) => !toDelete.some((r) => r.sku === s)));
    for (const s of finalSku.values()) taken.add(s);
  }
  const prefix = skuPrefixFor(input.brandName);
  const axisOrder = plan.attributes.map((a) => a.name);

  for (const d of plan.rows) {
    const cur = byKey.get(d.key);
    if (cur && !deletedIds.has(cur.id)) {
      const next = {
        sku: d.sku ?? cur.sku,
        barcode: d.barcode === undefined ? cur.barcode : d.barcode,
        price: d.price,
        compareAtPrice: d.compareAtPrice === undefined ? cur.compareAtPrice : d.compareAtPrice,
        costPrice: d.costPrice === undefined ? cur.costPrice : d.costPrice,
        lowStockAt: d.lowStockAt === undefined ? cur.lowStockAt : d.lowStockAt,
        isActive: true,
        sortOrder: d.sortOrder,
      };
      // A row parked above always differs from its old value, so `changed`
      // also covers writing it back.
      const changed =
        next.sku !== cur.sku ||
        next.barcode !== cur.barcode ||
        next.price !== cur.price ||
        next.compareAtPrice !== cur.compareAtPrice ||
        next.costPrice !== cur.costPrice ||
        next.lowStockAt !== cur.lowStockAt ||
        next.isActive !== cur.isActive ||
        next.sortOrder !== cur.sortOrder;
      if (changed) {
        await tx.productVariant.update({ where: { id: cur.id }, data: next });
        result.updated += 1;
      }
      if (!cur.isActive) {
        result.restored.push(next.sku);
        result.activeSetChanged = true;
      }
      result.rows.push({
        key: d.key,
        sku: next.sku,
        price: next.price,
        compareAtPrice: next.compareAtPrice,
        available: cur.available,
      });
      continue;
    }

    const sku =
      d.sku ??
      generateSku({
        prefix,
        category: input.category,
        productName: input.productName,
        combo: d.combo,
        axisOrder,
        taken: taken!,
      });
    await tx.productVariant.create({
      data: {
        productId,
        comboKey: d.key,
        combo: d.combo,
        sku,
        barcode: d.barcode ?? null,
        price: d.price,
        compareAtPrice: d.compareAtPrice ?? null,
        costPrice: d.costPrice ?? null,
        lowStockAt: d.lowStockAt ?? null,
        sortOrder: d.sortOrder,
      },
    });
    result.created.push(sku);
    result.activeSetChanged = true;
    result.rows.push({ key: d.key, sku, price: d.price, compareAtPrice: d.compareAtPrice ?? null, available: 0 });
  }

  if (toRetire.length) {
    await tx.productVariant.updateMany({
      where: { id: { in: toRetire.map((r) => r.id) } },
      data: { isActive: false },
    });
  }

  return result;
}

/* ------------------------------------------------------------------ */
/*  The mirror                                                         */
/* ------------------------------------------------------------------ */

/**
 * `sellableVariants` — what checkout, the coupon quote and the product page
 * read. Built from the same settled prices just written to the rows, so they
 * cannot disagree.
 *
 * - Price: `resolveVariantPrice(row.price, Product.price)`, inside
 *   `deriveVariantModel`.
 * - `compareAtPrice` is added only where a combination has its own, so a
 *   product without any keeps a byte-identical mirror.
 * - **A tracked product's stock comes from its rows**, never from the editor:
 *   each combination's live `available` (floored at 0, as `refreshMirrors`
 *   floors the product total). A tracked product always gets one entry per
 *   combination, so the product page can say a single size is sold out rather
 *   than reading the product-wide total.
 */
export function buildSellableMirror(input: {
  plan: VariantPlan;
  options: unknown;
  stock: number;
  tracked: boolean;
  rows?: SyncedRow[];
}): SellableVariantMirror[] {
  const { plan } = input;
  let draft = plan.draft;
  if (input.tracked && draft.length === 0 && plan.attributes.length > 0) {
    draft = plan.rows.map((r) => ({ combo: r.combo, price: "", stock: "", available: true, images: [] }));
  }
  const { sellableVariants } = deriveVariantModel({
    options: input.options,
    variants: draft,
    price: plan.productPrice,
    stock: input.tracked ? 0 : input.stock,
  });
  const rowByKey = new Map((input.rows ?? []).map((r) => [r.key, r]));
  const compareByKey = new Map(plan.rows.map((r) => [r.key, r.compareAtPrice]));
  return sellableVariants.map((sv) => {
    const out: SellableVariantMirror = { ...sv };
    const row = rowByKey.get(sv.id);
    const cap = row ? row.compareAtPrice : compareByKey.get(sv.id);
    if (cap != null) out.compareAtPrice = cap;
    if (input.tracked) out.stock = Math.max(0, row?.available ?? 0);
    return out;
  });
}

/** A tracked product's `stock`: the rule `refreshMirrors` in lib/inventory.ts applies. */
export function trackedStockTotal(rows: SyncedRow[]): number {
  return rows.reduce((n, r) => n + Math.max(0, r.available), 0);
}

/**
 * Did the database refuse a delete because something still points at the row?
 * For a product, that is `StockMovement`'s `onDelete: Restrict` reached through
 * the variant cascade — P2003 from Postgres, P2014 if Prisma catches it first.
 */
export function isRestrictViolation(e: unknown): boolean {
  return (
    e instanceof Prisma.PrismaClientKnownRequestError && (e.code === "P2003" || e.code === "P2014")
  );
}

/** Is this a unique-index clash on a variant column? Names the column when it can. */
export function variantUniqueClash(e: unknown): "sku" | "barcode" | "comboKey" | null {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") return null;
  const target = JSON.stringify(e.meta?.target ?? "");
  if (/sku/i.test(target)) return "sku";
  if (/barcode/i.test(target)) return "barcode";
  if (/comboKey/i.test(target)) return "comboKey";
  return null;
}
