"use server";

/**
 * Writes for Admin → Automation.
 *
 * Two traps from CLAUDE.md are designed out rather than guarded against, the
 * same way `actions/promotions.ts` does it:
 *
 * 1. **"Zod strips anything not in the schema — silently."** Each model has
 *    exactly one column list — {@link ruleRow} and {@link templateRow} — and
 *    both writers use it. There is no second place a field can be forgotten,
 *    which is the failure mode that made the Returns control save nothing.
 * 2. **An optional value collapses to `null`, never `undefined`.** `undefined`
 *    in a Prisma `update` means "leave this column alone", so detaching a
 *    template by choosing "none" would silently keep the old one.
 *
 * Conditions get a third rule of their own: they are **rebuilt from the
 * trigger's catalogue**, never copied from the request. A `conditions` column
 * is `Json`, so without that a form post could write any key it liked into a
 * blob the engine then matches on — and a condition key the engine never reads
 * is a rule that looks narrowed on screen and fires on everything.
 */

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdminWrite } from "@/lib/auth";
import {
  IMPLEMENTED_ACTIONS,
  TRIGGER_KEYS,
  drainDueJobs,
  isTriggerKey,
  syncSystemAutomation,
  triggerSpec,
  type DrainReport,
} from "@/lib/automation";
import { isPushRecipient } from "@/lib/push-dispatch";

/**
 * Identity **and** permission for every write in this module, routed through
 * the one write gate in `lib/auth.ts`. See the long note there: it is also
 * where a temporary admin's activity is recorded, so a new action that calls
 * this is gated and logged without its author doing anything.
 */
async function requireAdmin(what?: string, opts?: { quiet?: boolean }) {
  return requireAdminWrite(what, opts);
}

export type AutomationActionResult = { success: boolean; error?: string };

/**
 * Refresh the two screens these writes affect.
 *
 * Wrapped, because `revalidatePath` throws outside a request context — the same
 * reason `/api/cron/nimbus-sync` guards its call. Every caller here runs it
 * *after* the database write has committed, so letting it escape would turn a
 * save that worked into an error message, and the admin would press Save again
 * on a rule that was already saved.
 */
function revalidateAutomation() {
  try {
    revalidatePath("/admin/automation");
    revalidatePath("/admin/automation/templates");
  } catch {
    // Nothing to do: the write is done, only the cache hint was missed.
  }
}

function explain(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues[0]?.message ?? "Check the fields and try again.";
  }
  if (error instanceof Error && error.message === "Unauthorized") {
    return "Your session expired. Sign in again.";
  }
  if (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "P2002"
  ) {
    return "Something with that name already exists — pick another.";
  }
  console.error("[automation] write failed:", error);
  return "Couldn't save. Please try again.";
}

/* ------------------------------------------------------------------ */
/*  Rules                                                              */
/* ------------------------------------------------------------------ */

const ruleInput = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Give the rule a name you'll recognise in a list")
      .max(80, "Keep the name under 80 characters"),
    trigger: z
      .string()
      .refine(isTriggerKey, { message: "Pick what sets this rule off." }),
    action: z
      .string()
      .refine((v) => (IMPLEMENTED_ACTIONS as readonly string[]).includes(v), {
        message: "That channel isn't something this build can send.",
      }),
    // "" from the select means "no template", which is only valid while the
    // rule is switched off — enforced in the superRefine below.
    templateId: z.string().trim(),
    recipient: z
      .string()
      .trim()
      .min(1, "Say who this email goes to")
      .max(120, "That address is too long"),
    delayMinutes: z.coerce
      .number()
      .int("Use a whole number of minutes")
      .min(0, "A delay can't be negative")
      .max(43200, "30 days is the longest delay — anything longer is a campaign, not a rule"),
    isActive: z.boolean(),
  })
  .superRefine((v, ctx) => {
    /**
     * **A notification goes to a device, and a device belongs to an account.**
     *
     * So the two named recipients are the only ones a push rule can carry:
     * `customer` resolves through the order's account (or the account holding
     * its email), and `admin` through `adminNotifyEmail`. A literal address is
     * refused here rather than at send time, because the alternative is a rule
     * that looks configured, sits in the list looking healthy, and cancels
     * every job it ever creates. The editor hides the option; this is what
     * makes hiding it a rule — a server action is callable by id from
     * anywhere, so a hidden control is not a constraint.
     */
    if (v.action === "push" && !isPushRecipient(v.recipient)) {
      ctx.addIssue({
        code: "custom",
        path: ["recipient"],
        message:
          "A notification can only go to the customer or to you — an email address has no device behind it.",
      });
    } else if (
      v.action !== "push" &&
      v.recipient !== "customer" &&
      v.recipient !== "admin" &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.recipient)
    ) {
      // A literal recipient has to look like an address, or the job only fails
      // at send time — hours later, on a screen nobody is watching.
      ctx.addIssue({
        code: "custom",
        path: ["recipient"],
        message: "Enter a valid email address, or pick the customer or yourself.",
      });
    }
    // An active rule with no template sends nothing and reports a failed job
    // for every order — on either channel, since push takes its title from the
    // template's subject line. Refuse it up front; allow it while paused so a
    // half-built rule can be saved.
    if (v.isActive && !v.templateId) {
      ctx.addIssue({
        code: "custom",
        path: ["templateId"],
        message: "Choose a template, or save the rule switched off.",
      });
    }
  });

type ParsedRule = z.output<typeof ruleInput>;

/**
 * Conditions, rebuilt from the catalogue.
 *
 * Only keys the chosen trigger actually declares survive, and only values it
 * offers. Anything blank is dropped entirely rather than stored as `""`, so
 * "any status" is the *absence* of the key — which is what
 * `conditionsMatch` treats as "no opinion".
 */
function readConditionsFrom(formData: FormData, trigger: string): Record<string, string> {
  const spec = triggerSpec(trigger);
  const out: Record<string, string> = {};
  for (const field of spec?.conditions ?? []) {
    const raw = String(formData.get(`condition.${field.key}`) ?? "").trim();
    if (!raw) continue;
    if (!field.options.some((o) => o.value === raw)) continue;
    out[field.key] = raw;
  }
  return out;
}

function readRule(formData: FormData) {
  return {
    name: String(formData.get("name") ?? ""),
    trigger: String(formData.get("trigger") ?? ""),
    action: String(formData.get("action") ?? "email"),
    templateId: String(formData.get("templateId") ?? ""),
    recipient: String(formData.get("recipient") ?? "customer"),
    delayMinutes: formData.get("delayMinutes"),
    isActive: formData.get("isActive") === "true",
  };
}

/** The single column list for `AutomationRule`. Both writers use it. */
function ruleRow(v: ParsedRule, conditions: Record<string, string>) {
  return {
    name: v.name,
    trigger: v.trigger,
    conditions,
    action: v.action,
    // Explicit `null`, never `undefined` — see note 2 in the header.
    templateId: v.templateId || null,
    recipient: v.recipient,
    delayMinutes: v.delayMinutes,
    isActive: v.isActive,
  };
}

export async function createAutomationRule(
  formData: FormData
): Promise<AutomationActionResult> {
  try {
    await requireAdmin("createAutomationRule");
    const parsed = ruleInput.parse(readRule(formData));
    const conditions = readConditionsFrom(formData, parsed.trigger);
    await prisma.automationRule.create({ data: ruleRow(parsed, conditions) });
    revalidateAutomation();
    return { success: true };
  } catch (error) {
    return { success: false, error: explain(error) };
  }
}

export async function updateAutomationRule(
  id: string,
  formData: FormData
): Promise<AutomationActionResult> {
  try {
    await requireAdmin("updateAutomationRule");
    const parsed = ruleInput.parse(readRule(formData));
    const conditions = readConditionsFrom(formData, parsed.trigger);
    await prisma.automationRule.update({
      where: { id },
      data: ruleRow(parsed, conditions),
    });
    revalidateAutomation();
    return { success: true };
  } catch (error) {
    return { success: false, error: explain(error) };
  }
}

/**
 * The list's pause switch — the one edit worth making without opening a form,
 * and the fastest way to stop a rule that is emailing the wrong people.
 */
export async function setAutomationRuleActive(
  id: string,
  isActive: boolean
): Promise<AutomationActionResult> {
  try {
    await requireAdmin("setAutomationRuleActive");
    await prisma.automationRule.update({ where: { id }, data: { isActive } });
    revalidateAutomation();
    return { success: true };
  } catch (error) {
    return { success: false, error: explain(error) };
  }
}

/**
 * Deleting a rule cascades its jobs (`onDelete: Cascade`), which includes the
 * `sent` ones. That history is what proves an email went out, so any queued
 * work is cancelled first and the count is reported — deleting is still a
 * choice, but not a silent one.
 */
export async function deleteAutomationRule(
  id: string
): Promise<AutomationActionResult> {
  try {
    await requireAdmin("deleteAutomationRule");
    await prisma.automationJob.updateMany({
      where: { ruleId: id, status: "pending" },
      data: { status: "cancelled", error: "Cancelled — the rule was deleted." },
    });
    await prisma.automationRule.delete({ where: { id } });
    revalidateAutomation();
    return { success: true };
  } catch (error) {
    return { success: false, error: explain(error) };
  }
}

/* ------------------------------------------------------------------ */
/*  Templates                                                          */
/* ------------------------------------------------------------------ */

const templateInput = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Give the template a name")
    .max(80, "Keep the name under 80 characters"),
  subject: z
    .string()
    .trim()
    .min(2, "An email needs a subject line")
    .max(160, "Keep the subject under 160 characters — inboxes truncate it"),
  body: z
    .string()
    .trim()
    .min(2, "Write the message")
    .max(8000, "That's longer than an email should be"),
});

type ParsedTemplate = z.output<typeof templateInput>;

function readTemplate(formData: FormData) {
  return {
    name: String(formData.get("name") ?? ""),
    subject: String(formData.get("subject") ?? ""),
    body: String(formData.get("body") ?? ""),
  };
}

/**
 * The single column list for `EmailTemplate`.
 *
 * `key` and `isSystem` are deliberately absent. `key` is the stable handle the
 * seeder uses and is generated once, on create; `isSystem` is only ever set by
 * the seeder. Neither is a form field, so neither can be flipped by a post —
 * which is what stops a system template being renamed into deletability.
 */
function templateRow(v: ParsedTemplate) {
  return { name: v.name, subject: v.subject, body: v.body };
}

/** Slug from the name, with a short suffix so two "Welcome" templates can coexist. */
function keyFrom(name: string): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "template";
  return `${slug}-${Math.random().toString(36).slice(2, 7)}`;
}

export async function createEmailTemplate(
  formData: FormData
): Promise<AutomationActionResult> {
  try {
    await requireAdmin("createEmailTemplate");
    const parsed = templateInput.parse(readTemplate(formData));
    await prisma.emailTemplate.create({
      data: { ...templateRow(parsed), key: keyFrom(parsed.name), isSystem: false },
    });
    revalidateAutomation();
    return { success: true };
  } catch (error) {
    return { success: false, error: explain(error) };
  }
}

/** System templates are editable — only deleting them is refused. */
export async function updateEmailTemplate(
  id: string,
  formData: FormData
): Promise<AutomationActionResult> {
  try {
    await requireAdmin("updateEmailTemplate");
    const parsed = templateInput.parse(readTemplate(formData));
    await prisma.emailTemplate.update({ where: { id }, data: templateRow(parsed) });
    revalidateAutomation();
    return { success: true };
  } catch (error) {
    return { success: false, error: explain(error) };
  }
}

/**
 * Two refusals, and both are enforced here rather than only in the UI, because
 * a hidden button is not a rule:
 *
 * - **A system template is never deletable.** The store ships with it and the
 *   seeder expects it to exist; editing it covers every legitimate reason to
 *   want it gone.
 * - **A template in use is never deletable.** `onDelete: SetNull` would leave
 *   the rules pointing at nothing — still active, still matching orders, and
 *   failing a job every time. Naming the rules is more useful than refusing
 *   blankly.
 */
export async function deleteEmailTemplate(
  id: string
): Promise<AutomationActionResult> {
  try {
    await requireAdmin("deleteEmailTemplate");
    const template = await prisma.emailTemplate.findUnique({
      where: { id },
      include: { rules: { select: { name: true } } },
    });
    if (!template) return { success: false, error: "That template no longer exists." };
    if (template.isSystem) {
      return {
        success: false,
        error:
          "This is one of the templates the store ships with. You can edit every word of it, but it can't be deleted.",
      };
    }
    if (template.rules.length > 0) {
      const names = template.rules.map((r) => `"${r.name}"`).join(", ");
      return {
        success: false,
        error: `${names} ${template.rules.length === 1 ? "uses" : "use"} this template. Point ${template.rules.length === 1 ? "it" : "them"} somewhere else first.`,
      };
    }
    await prisma.emailTemplate.delete({ where: { id } });
    revalidateAutomation();
    return { success: true };
  } catch (error) {
    return { success: false, error: explain(error) };
  }
}

/* ------------------------------------------------------------------ */
/*  Jobs                                                               */
/* ------------------------------------------------------------------ */

/**
 * Drain the queue by hand.
 *
 * The cron is the real drain; this exists because the cron's schedule is coarse
 * (see `vercel.json`) and because "did that actually send?" is a question an
 * owner asks immediately, not tomorrow. It calls the same `drainDueJobs` and is
 * protected by the same claim, so pressing it twice — or pressing it while the
 * cron is mid-pass — cannot send anything twice.
 */
export async function runDueAutomationJobs(): Promise<
  AutomationActionResult & { report?: DrainReport }
> {
  try {
    await requireAdmin("runDueAutomationJobs");
    const report = await drainDueJobs();
    revalidateAutomation();
    return { success: true, report };
  } catch (error) {
    return { success: false, error: explain(error) };
  }
}

/** Withdraw a queued job without touching the rule that made it. */
export async function cancelAutomationJob(
  id: string
): Promise<AutomationActionResult> {
  try {
    await requireAdmin("cancelAutomationJob");
    // Scoped to `pending` so this can never rewrite a job that already sent.
    const res = await prisma.automationJob.updateMany({
      where: { id, status: "pending" },
      data: { status: "cancelled", error: "Cancelled by hand from the admin." },
    });
    if (res.count === 0) {
      return { success: false, error: "That job has already run — there's nothing to cancel." };
    }
    revalidateAutomation();
    return { success: true };
  } catch (error) {
    return { success: false, error: explain(error) };
  }
}

/** Re-queue a failed job so the next drain retries it. */
export async function retryAutomationJob(
  id: string
): Promise<AutomationActionResult> {
  try {
    await requireAdmin("retryAutomationJob");
    const res = await prisma.automationJob.updateMany({
      where: { id, status: { in: ["failed", "cancelled"] } },
      data: { status: "pending", runAt: new Date(), error: null, sentAt: null },
    });
    if (res.count === 0) {
      return { success: false, error: "Only a failed or cancelled job can be retried." };
    }
    revalidateAutomation();
    return { success: true };
  } catch (error) {
    return { success: false, error: explain(error) };
  }
}

/** Exported for the rule form's trigger picker; keeps the list in one place. */
export async function listTriggerKeys(): Promise<readonly string[]> {
  return TRIGGER_KEYS;
}

/* ------------------------------------------------------------------ */
/*  What the store ships with                                          */
/* ------------------------------------------------------------------ */

/**
 * Put back any shipped template or rule that is missing.
 *
 * This is the only way the store's own mail gets into a database, and it is
 * deliberately a **button, not a startup hook**. Running it on every boot would
 * mean a rule you deleted comes back on the next deploy, which is a store that
 * argues with its owner.
 *
 * It is additive: it never edits words you have written, never re-points a rule
 * at a different template and never un-pauses anything. Pressing it twice does
 * nothing the second time, so it is safe to press when you are not sure.
 */
export async function restoreSystemAutomation(): Promise<
  AutomationActionResult & { summary?: string }
> {
  try {
    await requireAdmin("restoreSystemAutomation");
    const report = await syncSystemAutomation();
    revalidateAutomation();

    const added: string[] = [];
    if (report.templatesCreated.length) {
      added.push(
        `${report.templatesCreated.length} template${report.templatesCreated.length === 1 ? "" : "s"}`
      );
    }
    if (report.rulesCreated.length) {
      added.push(
        `${report.rulesCreated.length} rule${report.rulesCreated.length === 1 ? "" : "s"}`
      );
    }

    return {
      success: true,
      summary: added.length
        ? `Restored ${added.join(" and ")}. Nothing you had already was changed.`
        : "Nothing was missing — every template and rule the store ships with is already here.",
    };
  } catch (error) {
    return { success: false, error: explain(error) };
  }
}
