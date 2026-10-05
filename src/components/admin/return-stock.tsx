/**
 * What has been decided about the stock of one returned piece.
 *
 * Shared by the returns page (which decides what to offer) and the return
 * actions (which enforce it), so the prompt on the card and the rule on the
 * server are one rule. **No directive, on purpose**: a server component may not
 * call a function exported from a `"use client"` module — see CLAUDE.md, "RSC
 * boundary traps".
 *
 * Only ever consulted for a product whose stock is tracked. An untracked
 * product has no stock decision to make, and nothing here applies to it.
 *
 * - `restocked` — a `RETURN` entry exists for this return: it is back on sale.
 * - `kept_out`  — someone decided it cannot be sold again. Written into the
 *   return's own history (the ledger records movements, and this is the
 *   decision *not* to make one), so the question is not asked twice.
 * - `counted`   — it was received **before** its product's latest opening
 *   count, so that count already has it on the shelf. Putting it back as well
 *   would count one garment twice — the case that matters on the day tracking
 *   starts, when received returns are still sitting in the queue.
 * - `null`      — nobody has decided yet.
 */
export type ReturnStockDecision = "restocked" | "kept_out" | "counted" | null;

/** The marker a kept-out decision leaves on its history entry. */
export const KEPT_OUT_MARKER = "kept_out";

type HistoryLike = { status?: unknown; at?: unknown; stock?: unknown };

function entries(history: unknown): HistoryLike[] {
  return Array.isArray(history)
    ? history.filter((h): h is HistoryLike => !!h && typeof h === "object")
    : [];
}

/** When the parcel first reached the store, from the return's own history. */
export function receivedAtOf(history: unknown): Date | null {
  for (const h of entries(history)) {
    if (h.status !== "received" || typeof h.at !== "string") continue;
    const at = new Date(h.at);
    if (!Number.isNaN(at.getTime())) return at;
  }
  return null;
}

export function returnStockDecision(input: {
  /** A `RETURN` movement exists for this return. */
  restocked: boolean;
  /** `ReturnRequest.statusHistory`. */
  history: unknown;
  /** The product's most recent opening count, or null if it has none. */
  countedAt: Date | null;
}): ReturnStockDecision {
  if (input.restocked) return "restocked";
  const list = entries(input.history);
  if (list.some((h) => h.stock === KEPT_OUT_MARKER)) return "kept_out";
  const receivedAt = receivedAtOf(list);
  if (receivedAt && input.countedAt && receivedAt < input.countedAt) return "counted";
  return null;
}
