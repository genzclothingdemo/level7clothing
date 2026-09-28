"use server";

/**
 * The writer behind the notification matrix on Admin → Settings → Alerts.
 *
 * **It writes `AutomationRule.isActive` and nothing else.** There is no
 * notification table, no JSON blob on `SiteSettings`, no second copy of the
 * grid. A tick flips the rule the engine already reads; a tick on a cell that
 * has no rule yet creates one from the shipped catalogue and then flips that.
 * Anything else would give the owner a switch that changes nothing — the
 * failure CLAUDE.md records twice, most expensively for `defaultReturnsInfo`.
 *
 * Four rules hold this together:
 *
 * 1. **A `"use server"` file may only export async functions.** Every constant
 *    and every pure helper this needs lives in `lib/notification-channels.ts`.
 *    `export const CHECKOUT_MODES = […]` from `actions/orders.ts` once broke
 *    *every* action in that module at runtime with a clean `tsc` and a clean
 *    build, so there is nothing else exported here.
 * 2. **The browser's rule ids are never trusted.** The client sends an event
 *    key and a channel; this module resolves the rules itself, from the same
 *    `(trigger, conditions, recipient, action)` identity the matrix is built
 *    on. A tab left open while rules moved cannot toggle the wrong row.
 * 3. **A rule can never be saved active on a channel that cannot deliver.**
 *    The gate is `IMPLEMENTED_ACTIONS` — the same constant `deliverJob`
 *    cancels an unknown action against, and the same one the screen disables
 *    its cells from. One list, so a channel cannot be tickable and unsendable.
 * 4. **Every write goes through `requireAdminWrite()`**, which is the
 *    permission *and* the activity log. A view-only temporary admin is refused
 *    here whatever the browser chooses to send — a server action is a public
 *    endpoint addressable by its id, so a disabled checkbox is not a rule.
 */

import { z } from "zod";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdminWrite } from "@/lib/auth";
import { AdminReadOnlyError } from "@/lib/temp-admin";
import {
  IMPLEMENTED_ACTIONS,
  SYSTEM_RULES,
  describeConditions,
  readConditions,
  recipientLabel,
  triggerLabel,
} from "@/lib/automation";
import {
  channelLabel,
  composeFallbackLabel,
  conditionSignature,
  eventLabel,
  parseEventKey,
} from "@/lib/notification-channels";

/* ------------------------------------------------------------------ */
/*  Result shape                                                       */
/* ------------------------------------------------------------------ */

/**
 * What the browser gets back for one cell.
 *
 * The authoritative `ruleIds` and `on` are returned rather than an `ok: true`,
 * so the grid rebases on **what the database now holds** instead of on what it
 * optimistically drew. That is the same rule `settings-form.tsx` follows for
 * every other save on this screen, and it is what lets a newly created rule's
 * id land in the cell without a full page refresh.
 */
export type CellState = {
  eventKey: string;
  channel: string;
  ruleIds: string[];
  on: boolean;
};

export type NotificationWriteResult =
  | { ok: true; cells: CellState[] }
  | { ok: false; error: string };

/* ------------------------------------------------------------------ */
/*  Input                                                              */
/* ------------------------------------------------------------------ */

/**
 * A channel key, shaped rather than enumerated.
 *
 * **Not `isNotifyChannel`.** The engine owns the channel list and grows it —
 * `inapp` appeared in `IMPLEMENTED_ACTIONS` while this screen was being built
 * — and a rule may exist on a channel the settings vocabulary has not been
 * taught yet. Refusing to *switch that off* would leave the owner staring at a
 * tick they cannot clear. The gate that matters is
 * {@link deliverableOrRefusal}, which is `IMPLEMENTED_ACTIONS` and applies
 * only to switching something **on**; this is just a sanity bound on the
 * string, so nothing arbitrary reaches a `where` clause.
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
    // A group header covers one recipient inside one family; 60 is far more
    // than any family will ever hold and still bounds a hand-made request.
    .max(60, "Too many events in one change"),
  channel: channelKey,
  enabled: z.boolean(),
});

/* ------------------------------------------------------------------ */
/*  Public actions                                                     */
/* ------------------------------------------------------------------ */

/**
 * Tick or untick one cell: this event, to this person, on this channel.
 */
export async function setNotificationChannel(input: {
  eventKey: string;
  channel: string;
  enabled: boolean;
}): Promise<NotificationWriteResult> {
  const gate = await adminGate("setNotificationChannel");
  if (gate) return gate;

  const parsed = cellInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }
  const { eventKey, channel, enabled } = parsed.data;

  const refusal = deliverableOrRefusal(channel, enabled);
  if (refusal) return { ok: false, error: refusal };

  try {
    const cell = await applyCell(eventKey, channel, enabled);
    if (!cell.ok) return cell;
    refresh();
    return { ok: true, cells: [cell.cell] };
  } catch (err) {
    console.error("[notifications] setNotificationChannel failed:", err);
    return { ok: false, error: "Couldn't save that. Please try again." };
  }
}

/**
 * The group header's "all on / all off" — one channel across every event in
 * one recipient group.
 *
 * It exists because the alternative is eight taps to stop emailing customers
 * about returns, and eight taps is where a settings screen stops being used.
 * It is the same per-cell routine underneath, run in sequence, so a row it
 * cannot create (no template anywhere) is skipped rather than failing the
 * whole change — and the result names how many actually moved.
 */
export async function setNotificationChannelForRows(input: {
  eventKeys: string[];
  channel: string;
  enabled: boolean;
}): Promise<NotificationWriteResult> {
  const gate = await adminGate("setNotificationChannelForRows");
  if (gate) return gate;

  const parsed = rowsInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }
  const { eventKeys, channel, enabled } = parsed.data;

  const refusal = deliverableOrRefusal(channel, enabled);
  if (refusal) return { ok: false, error: refusal };

  const cells: CellState[] = [];
  let firstError: string | null = null;

  try {
    // Sequential on purpose. These writes hit the same few rows and the same
    // pooled connection — `connection_limit=5` is not a budget to spend on a
    // fan-out of twelve upserts, and the whole thing is a handful of
    // millisecond queries anyway. See the pool note in CLAUDE.md.
    for (const eventKey of [...new Set(eventKeys)]) {
      const result = await applyCell(eventKey, channel, enabled);
      if (result.ok) cells.push(result.cell);
      else if (!firstError) firstError = result.error;
    }
  } catch (err) {
    console.error("[notifications] setNotificationChannelForRows failed:", err);
    return { ok: false, error: "Couldn't save those. Please try again." };
  }

  refresh();

  // Nothing moved at all — report the reason rather than a silent success.
  if (cells.length === 0) {
    return { ok: false, error: firstError ?? "Nothing to change." };
  }
  return { ok: true, cells };
}

/* ------------------------------------------------------------------ */
/*  The one routine both actions run                                   */
/* ------------------------------------------------------------------ */

type CellOutcome = { ok: true; cell: CellState } | { ok: false; error: string };

/**
 * Resolve one cell to real rules and set `isActive` on all of them.
 *
 * **Toggling every matching rule together is deliberate.** Normally there is
 * exactly one; there can be more when someone duplicated a rule by hand in
 * Admin → Automation, and in that case a checkbox that flipped only one of two
 * identical rules would be telling the truth about one and lying about the
 * other. The grid shows the count beside a cell that governs more than one.
 */
async function applyCell(
  eventKey: string,
  channel: string,
  enabled: boolean
): Promise<CellOutcome> {
  const parsed = parseEventKey(eventKey);
  if (!parsed) return { ok: false, error: "That alert could not be identified." };

  const { trigger, conditions, recipient } = parsed;
  const signature = conditionSignature(conditions);

  // Narrowed in the database on the three columns that are plain strings, then
  // filtered on the JSON one in memory. Prisma cannot compare a normalised
  // `conditions` blob, and the candidate set here is a handful of rows.
  const candidates = await prisma.automationRule.findMany({
    where: { trigger, action: channel, recipient },
    select: { id: true, conditions: true, isActive: true },
  });
  const matching = candidates.filter(
    (r) => conditionSignature(readConditions(r.conditions)) === signature
  );

  if (matching.length > 0) {
    const ids = matching.map((r) => r.id);
    await prisma.automationRule.updateMany({
      where: { id: { in: ids } },
      data: { isActive: enabled },
    });
    return { ok: true, cell: { eventKey, channel, ruleIds: ids, on: enabled } };
  }

  // Nothing here, and nothing asked for: already off, so there is nothing to
  // write. Creating a paused rule just to record "off" would fill the
  // automation list with rows that do nothing.
  if (!enabled) {
    return { ok: true, cell: { eventKey, channel, ruleIds: [], on: false } };
  }

  return createFromCatalogue({ eventKey, trigger, conditions, signature, recipient, channel });
}

/**
 * Bring a shipped-but-absent rule into existence, switched on.
 *
 * The template is the interesting part. A rule with no template cannot send —
 * for email it has no words, and for push `pushCopyFrom` builds the banner out
 * of the **email template's** subject and opening line, which is exactly why
 * the four shipped push rules point at email templates rather than carrying
 * their own copy. So the search goes, in order:
 *
 *   1. the shipped rule for this exact event *and* channel — use it whole, so
 *      ticking "phone alert on order confirmed" creates precisely the row the
 *      store ships, name and all, and `syncSystemAutomation` will then leave
 *      it alone;
 *   2. the shipped rule for this event on any channel — borrow its template
 *      and its timing, and generate a name;
 *   3. a live sibling rule for this event on any channel — same, for an event
 *      somebody built by hand.
 *
 * If none of the three can name a template the tick is refused with a sentence
 * that says where to fix it, rather than creating a rule that would be
 * cancelled the first time it fired.
 */
async function createFromCatalogue(args: {
  eventKey: string;
  trigger: string;
  conditions: Record<string, string>;
  signature: string;
  recipient: string;
  channel: string;
}): Promise<CellOutcome> {
  const { eventKey, trigger, conditions, signature, recipient, channel } = args;

  const onThisEvent = SYSTEM_RULES.filter(
    (r) =>
      r.trigger === trigger &&
      r.recipient === recipient &&
      conditionSignature(r.conditions) === signature
  );
  const exact = onThisEvent.find((r) => (r.action ?? "email") === channel);
  const sibling = exact ?? onThisEvent[0];

  let templateId: string | null = null;
  let delayMinutes = sibling?.delayMinutes ?? 0;
  let name = exact?.name ?? "";

  if (sibling) {
    const template = await prisma.emailTemplate.findUnique({
      where: { key: sibling.templateKey },
      select: { id: true },
    });
    templateId = template?.id ?? null;
  }

  if (!templateId) {
    // No catalogue entry, or its template has been deleted. Borrow from a live
    // rule on the same event — the case for a rule somebody wrote by hand.
    const live = await prisma.automationRule.findMany({
      where: { trigger, recipient, NOT: { templateId: null } },
      select: { conditions: true, templateId: true, delayMinutes: true },
    });
    const match = live.find(
      (r) => conditionSignature(readConditions(r.conditions)) === signature
    );
    if (match?.templateId) {
      templateId = match.templateId;
      delayMinutes = match.delayMinutes;
    }
  }

  if (!templateId) {
    return {
      ok: false,
      error:
        "This alert has no message to send yet. Open Admin → Automation and press Restore built-in rules, or write a template for it there first.",
    };
  }

  if (!name) {
    const label = eventLabel(
      trigger,
      conditions,
      composeFallbackLabel(triggerLabel(trigger), describeConditions(trigger, conditions))
    );
    name = `${label} — ${channelLabel(channel)} to ${recipientLabel(recipient).toLowerCase()}`
      // `AutomationRule.name` is edited under an 80-character limit in the rule
      // form; staying inside it keeps a row created here editable there.
      .slice(0, 80);
  }

  const created = await prisma.automationRule.create({
    data: {
      name,
      trigger,
      conditions: conditions as Prisma.InputJsonValue,
      action: channel,
      templateId,
      recipient,
      delayMinutes,
      isActive: true,
    },
    select: { id: true },
  });

  return { ok: true, cell: { eventKey, channel, ruleIds: [created.id], on: true } };
}

/* ------------------------------------------------------------------ */
/*  Gates                                                              */
/* ------------------------------------------------------------------ */

/**
 * `null` when the caller may write; the refusal to return otherwise.
 *
 * `what` reaches the temporary-admin activity log through `requireAdminWrite`,
 * so the two actions name themselves separately — "they switched one alert" and
 * "they switched a whole group" are different things to read back later.
 */
async function adminGate(
  what: string
): Promise<{ ok: false; error: string } | null> {
  try {
    await requireAdminWrite(what);
    return null;
  } catch (err) {
    if (err instanceof AdminReadOnlyError) {
      return { ok: false, error: err.message };
    }
    return { ok: false, error: "Your session expired. Sign in again." };
  }
}

/**
 * The hard gate: a channel this build cannot send may never be saved active.
 *
 * Switching one **off** is always allowed. If an `sms` rule somehow exists and
 * is active — a hand-written row, or a channel that was supported and is not
 * any more — refusing to switch it off would leave the owner staring at a tick
 * they cannot clear.
 */
function deliverableOrRefusal(channel: string, enabled: boolean): string | null {
  if (!enabled) return null;
  if ((IMPLEMENTED_ACTIONS as readonly string[]).includes(channel)) return null;
  return `${channelLabel(channel)} can't be sent from this store yet, so it can't be switched on. Connect a gateway first — the alert itself is already wired for it.`;
}

/**
 * Refresh the two screens these writes are visible on.
 *
 * Wrapped for the same reason `actions/automation.ts` wraps it: `revalidatePath`
 * throws outside a request context, and every caller runs it *after* the write
 * has committed — letting it escape would turn a save that worked into an error
 * message, and the owner would tick the box again on a rule already switched on.
 */
function refresh() {
  try {
    revalidatePath("/admin/settings");
    revalidatePath("/admin/automation");
  } catch {
    // The write is done; only the cache hint was missed.
  }
}
