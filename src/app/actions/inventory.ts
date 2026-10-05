"use server";

/**
 * The three writes behind Admin → Inventory: record an entry, start tracking,
 * stop tracking.
 *
 * ## Only async functions live here
 *
 * A `"use server"` file may export nothing but async functions — CLAUDE.md
 * records `export const CHECKOUT_MODES` taking out every action in
 * `actions/orders.ts` at runtime while `tsc` and `next build` both passed. The
 * vocabulary is in `lib/inventory-types`; the `export type`s below are erased
 * at build time and are not runtime exports.
 *
 * ## Nothing here decides what is allowed
 *
 * Every rule about stock — no removing more than is on the shelf, a reason for
 * every write-off, no hand-typed sale, every size counted before tracking
 * starts — lives in `lib/inventory.ts` and comes back as a sentence. This file
 * only turns what was typed into numbers, asks the engine, and reports the
 * engine's answer word for word. A second copy of a rule here would be a copy
 * that drifts, and the screen would then refuse what the engine allows or the
 * other way round.
 *
 * What this file *does* own is permission: each verb goes through
 * `requireAdminWrite`, so a view-only temporary admin is refused by the server
 * even if a stale form is still on their screen, and a full-access one is
 * written to their activity trail by the same call.
 */

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdminWrite, type AdminSession } from "@/lib/auth";
import { AdminReadOnlyError } from "@/lib/temp-admin";
import {
  actorFromAdminSession,
  recordManualMovement,
  startTracking,
  stopTracking,
} from "@/lib/inventory";
import { MANUAL_MOVEMENT_TYPES } from "@/lib/inventory-types";

/* ------------------------------------------------------------------ */
/*  Shared                                                             */
/* ------------------------------------------------------------------ */

/**
 * The write gate, with its refusal turned into a sentence the form can print.
 * `requireAdminWrite` throws; these actions report through a result, so the
 * refusal is caught and returned as the guard's own words — a view-only holder
 * is told *why*, not "something went wrong".
 */
async function gate(
  what: string
): Promise<{ ok: true; session: AdminSession } | { ok: false; error: string }> {
  try {
    return { ok: true, session: await requireAdminWrite(what) };
  } catch (err) {
    if (err instanceof AdminReadOnlyError) return { ok: false, error: err.message };
    return { ok: false, error: "You are not signed in as an admin." };
  }
}

/**
 * A whole number exactly as typed, or `NaN`.
 *
 * `NaN` rather than an error of our own, so a bad value gets the **engine's**
 * sentence ("Enter how many — a whole number above zero."). Stricter than the
 * engine's `Math.floor` on purpose: "2.5" damaged must be refused, not
 * quietly recorded as 2.
 */
function wholeNumber(raw: string): number {
  const s = raw.trim();
  return /^\d{1,9}$/.test(s) ? Number(s) : Number.NaN;
}

/** Everything that shows a stock number, refreshed after it moves. */
function revalidateStock(slug: string | null | undefined) {
  revalidatePath("/admin/inventory", "layout");
  revalidatePath("/admin/products");
  revalidatePath("/admin");
  // `Product.stock` is the storefront's mirror of a tracked product's sizes,
  // rewritten in the same transaction as the entry.
  revalidatePath("/shop");
  revalidatePath("/");
  if (slug) revalidatePath(`/product/${slug}`);
}

const NOTE_MAX = 300;

/* ------------------------------------------------------------------ */
/*  Record an entry                                                    */
/* ------------------------------------------------------------------ */

const entrySchema = z.object({
  productId: z.string().min(1).max(64),
  type: z.enum(MANUAL_MOVEMENT_TYPES),
  /** One per size that has something typed in it. Blank sizes are not sent. */
  lines: z
    .array(z.object({ variantId: z.string().min(1).max(64), value: z.string().max(24) }))
    .max(200),
  unitCost: z.string().max(24).optional(),
  note: z.string().max(4000).optional(),
});

export type StockEntryInput = z.input<typeof entrySchema>;

export type StockEntryLineResult =
  | { variantId: string; ok: true; delta: number; onHand: number; reserved: number; available: number }
  | { variantId: string; ok: false; error: string };

export type StockEntryResult =
  | { ok: true; applied: number; results: StockEntryLineResult[] }
  | { ok: false; error: string };

/**
 * **Stock in, damaged, personal use or recount**, for one or more sizes of one
 * product, with one reason.
 *
 * A delivery or a stocktake arrives as several sizes at once, so the form takes
 * a line per size. Each line is its own `recordManualMovement` — its own
 * transaction and its own ledger row, which is what the ledger is: one entry
 * per size. So a refusal is **per size**: "only 2 on the shelf" for M does not
 * undo the S that was fine, and the result names exactly which sizes were
 * saved and which were not, so the form can clear the saved ones and a second
 * press cannot record them twice.
 *
 * Lines run one after another, not in parallel: they share the pool's five
 * connections with every shopper (CLAUDE.md, `connection_limit=5`).
 */
export async function recordStockEntry(input: StockEntryInput): Promise<StockEntryResult> {
  const g = await gate("recordStockEntry");
  if (!g.ok) return g;

  const parsed = entrySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That entry could not be read. Reload the page and try again." };
  const { productId, type } = parsed.data;

  const lines = parsed.data.lines.filter((l) => l.value.trim() !== "");
  if (lines.length === 0) {
    return {
      ok: false,
      error:
        type === "ADJUSTMENT"
          ? "Enter what you counted for at least one size."
          : "Enter how many for at least one size.",
    };
  }

  const note = (parsed.data.note ?? "").trim();
  if (note.length > NOTE_MAX) {
    return { ok: false, error: `Keep the reason under ${NOTE_MAX} characters.` };
  }

  // Unit cost is the one field the engine takes on trust — it stores whatever
  // it is handed, and a fraction would fail the Int column as a generic "could
  // not save". So it is read here, and only for a stock-in.
  let unitCost: number | null = null;
  if (type === "RECEIPT") {
    const raw = (parsed.data.unitCost ?? "").replace(/[₹,\s]/g, "");
    if (raw) {
      if (!/^\d{1,8}$/.test(raw)) {
        return {
          ok: false,
          error: "Unit cost is whole rupees — for example 310. Leave it blank if you don't know it.",
        };
      }
      unitCost = Number(raw);
    }
  }

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { slug: true, variantRows: { select: { id: true } } },
  });
  if (!product) return { ok: false, error: "That product no longer exists." };
  const sizes = new Set(product.variantRows.map((v) => v.id));

  const actor = actorFromAdminSession(g.session);
  const results: StockEntryLineResult[] = [];

  for (const line of lines) {
    if (!sizes.has(line.variantId)) {
      results.push({ variantId: line.variantId, ok: false, error: "That size is not part of this product." });
      continue;
    }
    const n = wholeNumber(line.value);
    const res = await recordManualMovement({
      variantId: line.variantId,
      type,
      ...(type === "ADJUSTMENT" ? { countedOnHand: n } : { quantity: n }),
      unitCost,
      note: note || null,
      actor,
    });
    results.push(
      res.ok
        ? {
            variantId: line.variantId,
            ok: true,
            delta: res.delta,
            onHand: res.onHand,
            reserved: res.reserved,
            available: res.available,
          }
        : { variantId: line.variantId, ok: false, error: res.error }
    );
  }

  const applied = results.filter((r) => r.ok).length;
  if (applied > 0) revalidateStock(product.slug);
  return { ok: true, applied, results };
}

/* ------------------------------------------------------------------ */
/*  Start and stop tracking                                            */
/* ------------------------------------------------------------------ */

const startSchema = z.object({
  productId: z.string().min(1).max(64),
  /** variantId → what was typed. Blank sizes are not sent. */
  counts: z.record(z.string().max(64), z.string().max(24)),
});

export type StartTrackingInput = z.input<typeof startSchema>;

export type StartTrackingActionResult =
  | { ok: true; opening: number; reservedForOpenOrders: number; oversold: string[] }
  | { ok: false; error: string };

/**
 * **The stocktake.** Every size counted, then open orders reserved against
 * the count — both by `startTracking`, in one transaction.
 *
 * A size left blank is simply not sent, so the engine's "Count every size
 * first — missing …" names it by SKU. Its `oversold` list comes back untouched:
 * those are the sizes where open orders already need more than was counted,
 * and the screen shows them before anything else.
 */
export async function startTrackingProduct(input: StartTrackingInput): Promise<StartTrackingActionResult> {
  const g = await gate("startTracking");
  if (!g.ok) return g;

  const parsed = startSchema.safeParse(input);
  if (!parsed.success || Object.keys(parsed.data.counts).length > 500) {
    return { ok: false, error: "That count could not be read. Reload the page and try again." };
  }

  const counts: Record<string, number> = {};
  for (const [variantId, raw] of Object.entries(parsed.data.counts)) {
    if (raw.trim() === "") continue;
    counts[variantId] = wholeNumber(raw);
  }

  const res = await startTracking({
    productId: parsed.data.productId,
    counts,
    actor: actorFromAdminSession(g.session),
  });

  if (res.ok) {
    const p = await prisma.product.findUnique({
      where: { id: parsed.data.productId },
      select: { slug: true },
    });
    revalidateStock(p?.slug);
  }
  return res;
}

export type StopTrackingActionResult = { ok: true } | { ok: false; error: string };

/**
 * **Stop tracking.** The ledger is kept; the product goes back to selling from
 * `Product.stock`, left at its last mirrored value. Starting again later means
 * a fresh count — the engine's rule, not this file's.
 */
export async function stopTrackingProduct(productId: string): Promise<StopTrackingActionResult> {
  const g = await gate("stopTracking");
  if (!g.ok) return g;

  const id = z.string().min(1).max(64).safeParse(productId);
  if (!id.success) return { ok: false, error: "That product could not be read." };

  const res = await stopTracking(id.data);
  if (!res.ok) return { ok: false, error: res.error ?? "Could not stop tracking." };

  const p = await prisma.product.findUnique({ where: { id: id.data }, select: { slug: true } });
  revalidateStock(p?.slug);
  return { ok: true };
}
