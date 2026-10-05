"use server";

/**
 * The writer behind Settings → Alerts — **the only screen that can create an
 * alert or switch one on or off.**
 *
 * It writes nothing itself. Every tick is handed to `setAlert` in
 * `lib/automation.ts`, the one function that inserts an `AutomationRule` or
 * changes its `isActive`, keyed by the alert's signature. That function holds
 * the three invariants — no second row for a signature, no two switched-on
 * rules that can match one event on one channel, nothing the store does not
 * ship — so this module is only the door: parse, gate, hand over, report.
 *
 * Four rules hold this together:
 *
 * 1. **A `"use server"` file may only export async functions** — and not a
 *    type re-export either (see CLAUDE.md). The two result types below are
 *    declarations, which are erased; every constant and helper lives in
 *    `lib/notification-channels.ts` or `lib/automation.ts`.
 * 2. **The browser's rule ids are never trusted.** The client sends an event
 *    key and a channel; the rows are found again under the writer's lock from
 *    what the alert *is*. A tab left open since yesterday cannot switch the
 *    wrong row.
 * 3. **A rule can never be saved active on a channel that cannot deliver** —
 *    `setAlert` refuses it against `IMPLEMENTED_ACTIONS`, the same list
 *    `deliverJob` cancels an unknown action against. Switching one *off* is
 *    always allowed, so an orphan tick can always be cleared.
 * 4. **Every write goes through `requireAdminWrite()`** — the permission and
 *    the temporary-admin activity log. A view-only admin is refused here
 *    whatever the browser sends; a disabled checkbox is not a rule.
 */

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getAdminSession, requireAdminWrite } from "@/lib/auth";
import { AdminReadOnlyError } from "@/lib/temp-admin";
import { setAlert, syncSystemAutomation, type SetAlertOutcome } from "@/lib/automation";
import { pushReach } from "@/lib/push-dispatch";
import { parseEventKey } from "@/lib/notification-channels";

/* ------------------------------------------------------------------ */
/*  Result shapes                                                      */
/* ------------------------------------------------------------------ */

/**
 * What the browser gets back for one cell — **the database's answer**, ids
 * included, so the grid rebases on what is now true rather than on what it
 * optimistically drew.
 */
export type CellState = {
  eventKey: string;
  channel: string;
  ruleIds: string[];
  on: boolean;
};

export type NotificationWriteResult =
  | { ok: true; cells: CellState[]; skipped?: string[] }
  | { ok: false; error: string };

/* ------------------------------------------------------------------ */
/*  Input                                                              */
/* ------------------------------------------------------------------ */

/**
 * A channel key, shaped rather than enumerated — the engine owns the channel
 * list and grows it, and a rule on a channel this vocabulary has not been
 * taught must still be switch-off-able. This only bounds the string.
 */
const channelKey = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]{1,23}$/, "That is not a channel this store knows about.");

const cellInput = z.object({
  /** `trigger|conditionSignature|recipient`, made by `eventKeyOf`. */
  eventKey: z.string().trim().min(3).max(300),
  channel: channelKey,
  enabled: z.boolean(),
});

const rowsInput = z.object({
  eventKeys: z
    .array(z.string().trim().min(3).max(300))
    .min(1, "Nothing to change")
    // A group covers one recipient inside one family; 60 bounds a hand-made
    // request far above anything the grid sends.
    .max(60, "Too many events in one change"),
  channel: channelKey,
  enabled: z.boolean(),
});

/* ------------------------------------------------------------------ */
/*  Public actions                                                     */
/* ------------------------------------------------------------------ */

/** Tick or untick one cell: this event, to this person, on this channel. */
export async function setNotificationChannel(input: {
  eventKey: string;
  channel: string;
  enabled: boolean;
}): Promise<NotificationWriteResult> {
  const gate = await writeGate("setNotificationChannel");
  if (gate) return gate;

  const parsed = cellInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { eventKey, channel, enabled } = parsed.data;

  try {
    const outcome = await applyCell(eventKey, channel, enabled);
    if (!outcome.ok) return { ok: false, error: outcome.error };
    refresh();
    return { ok: true, cells: [outcome.cell] };
  } catch (err) {
    console.error("[notifications] setNotificationChannel failed:", err);
    return { ok: false, error: "Couldn't save that. Please try again." };
  }
}

/**
 * A group header's "all on / all off" — one channel across every event in one
 * recipient group. The same routine per cell, in sequence: a cell the writer
 * refuses (a collision, a message not written yet) is skipped with its reason
 * rather than failing the rest, and the result names what did not move.
 */
export async function setNotificationChannelForRows(input: {
  eventKeys: string[];
  channel: string;
  enabled: boolean;
}): Promise<NotificationWriteResult> {
  const gate = await writeGate("setNotificationChannelForRows");
  if (gate) return gate;

  const parsed = rowsInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const { eventKeys, channel, enabled } = parsed.data;

  const cells: CellState[] = [];
  const skipped: string[] = [];
  try {
    // Sequential on purpose: the same few rows, one pooled connection each
    // (`connection_limit=5` — see CLAUDE.md), and each cell takes the writer's
    // lock on its group anyway.
    for (const eventKey of [...new Set(eventKeys)]) {
      const outcome = await applyCell(eventKey, channel, enabled);
      if (outcome.ok) cells.push(outcome.cell);
      else skipped.push(outcome.error);
    }
  } catch (err) {
    console.error("[notifications] setNotificationChannelForRows failed:", err);
    return { ok: false, error: "Couldn't save those. Please try again." };
  }

  refresh();
  if (cells.length === 0) return { ok: false, error: skipped[0] ?? "Nothing to change." };
  return { ok: true, cells, skipped };
}

/**
 * Add every alert the store ships that this database does not have yet — the
 * button that appears on Alerts only when something is missing.
 *
 * `syncSystemAutomation` is additive: it creates what is missing with its
 * shipped default, recognises what exists by signature (never by name), and
 * never flips a switch that already exists. So pressing it twice does nothing
 * the second time, and pressing it can never un-pause anything.
 */
export async function addShippedAlerts(): Promise<
  { ok: true; summary: string; created: number } | { ok: false; error: string }
> {
  const gate = await writeGate("restoreShippedAlerts");
  if (gate) return gate;

  try {
    const report = await syncSystemAutomation();
    refresh();

    const parts: string[] = [];
    const n = report.rulesCreated.length;
    if (n > 0) parts.push(`Added ${n} alert${n === 1 ? "" : "s"}`);
    if (report.rulesRepaired.length > 0) {
      parts.push(`reconnected ${report.rulesRepaired.length} to its message`);
    }
    if (report.rulesHeld.length > 0) {
      parts.push(
        `${report.rulesHeld.length} left off because another alert already sends the same thing`
      );
    }
    if (report.rulesWaiting.length > 0) {
      parts.push(
        `${report.rulesWaiting.length} still waiting for ${report.rulesWaiting.length === 1 ? "its" : "their"} wording`
      );
    }
    return {
      ok: true,
      created: n,
      summary: parts.length
        ? `${parts.join(" · ")}. Nothing you had already was changed.`
        : "Nothing was missing — every alert the store ships is already here.",
    };
  } catch (err) {
    console.error("[notifications] addShippedAlerts failed:", err);
    return { ok: false, error: "Couldn't add them. Please try again." };
  }
}

/**
 * Who a phone alert to **you** would actually reach. Read-only.
 *
 * An admin push resolves through the alert address to the customer accounts
 * holding it, and from those to their devices — so with nobody signed in on a
 * phone with that address, every ticked "Phone" cell under "To you" reaches no
 * one, and says nothing. The grid asks this once so it can say so on the cell.
 */
export async function readAdminPushReach(): Promise<
  { configured: boolean; adminEmail: string; adminDevices: number } | null
> {
  // A read, so the read-only helper: a view-only admin may look.
  const session = await getAdminSession().catch(() => null);
  if (!session) return null;
  try {
    const reach = await pushReach();
    return {
      configured: reach.configured,
      adminEmail: reach.adminEmail,
      adminDevices: reach.adminDevices,
    };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  The one routine every write runs                                   */
/* ------------------------------------------------------------------ */

type CellOutcome = { ok: true; cell: CellState } | { ok: false; error: string };

async function applyCell(
  eventKey: string,
  channel: string,
  enabled: boolean
): Promise<CellOutcome> {
  const parsed = parseEventKey(eventKey);
  if (!parsed) return { ok: false, error: "That alert could not be identified." };

  const outcome: SetAlertOutcome = await setAlert({
    identity: { ...parsed, action: channel },
    enabled,
    onCollision: "refuse",
  });
  if (!outcome.ok) return { ok: false, error: outcome.error };
  return { ok: true, cell: { eventKey, channel, ruleIds: outcome.ruleIds, on: outcome.on } };
}

/* ------------------------------------------------------------------ */
/*  Gates                                                              */
/* ------------------------------------------------------------------ */

/**
 * `null` when the caller may write; the refusal otherwise. `what` reaches the
 * temporary-admin activity log through `requireAdminWrite`.
 */
async function writeGate(what: string): Promise<{ ok: false; error: string } | null> {
  try {
    await requireAdminWrite(what);
    return null;
  } catch (err) {
    if (err instanceof AdminReadOnlyError) return { ok: false, error: err.message };
    return { ok: false, error: "Your session expired. Sign in again." };
  }
}

/**
 * Refresh the screens these writes are visible on. Wrapped: `revalidatePath`
 * throws outside a request context, and every caller runs it after the write
 * has committed.
 */
function refresh() {
  try {
    revalidatePath("/admin/settings");
    revalidatePath("/admin/automation");
  } catch {
    // The write is done; only the cache hint was missed.
  }
}
