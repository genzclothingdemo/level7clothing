"use server";

/**
 * Writes for Admin → Automation — **and deliberately nothing that touches a
 * rule.**
 *
 * This module used to create, edit, pause and delete `AutomationRule` rows,
 * which made Admin → Automation a second editor for the same switches
 * Settings → Alerts draws. Two editors meant the owner's own example: tick
 * "order shipped → email → customer" in Alerts, build the same rule again
 * here, and the customer is emailed twice — each rule deduped perfectly
 * against itself, neither knowing about the other.
 *
 * Those actions are **removed, not hidden.** A server action is a public
 * endpoint addressable by its id, so a missing button is not a missing writer;
 * the only safe version of "you can't do that here" is a function that no
 * longer exists. Every rule write now goes through `setAlert` in
 * `lib/automation.ts`, reached only from `actions/notification-settings.ts`.
 *
 * What is left is the other half of the screen:
 *
 * - **the wording** — `updateEmailTemplate`. Creating or deleting a template
 *   went with the rule editor: a new template could never be attached to
 *   anything, and every template the store has is one it ships.
 * - **the queue** — run it now, cancel a queued job, retry a failed one. These
 *   touch `AutomationJob` rows, and each is protected by the same claim the
 *   cron uses, so none of them can send anything twice.
 *
 * Every write here goes through `requireAdminWrite()` — the permission and the
 * temporary-admin activity log in one call — so a view-only admin is refused
 * whatever the browser sends.
 */

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdminWrite } from "@/lib/auth";
import { AdminReadOnlyError } from "@/lib/temp-admin";
import { drainDueJobs, type DrainReport } from "@/lib/automation";

export type AutomationActionResult = { success: boolean; error?: string };

/**
 * Refresh the screens these writes affect. Wrapped, because `revalidatePath`
 * throws outside a request context and every caller runs it after the write
 * has committed — letting it escape would report a save that worked as a
 * failure.
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
  // A view-only temporary admin, refused by the gate. Its own sentence says
  // what happened and who to ask — "couldn't save, try again" would send them
  // round in a loop that can never succeed.
  if (error instanceof AdminReadOnlyError) return error.message;
  if (error instanceof Error && error.message === "Unauthorized") {
    return "Your session expired. Sign in again.";
  }
  console.error("[automation] write failed:", error);
  return "Couldn't save. Please try again.";
}

/* ------------------------------------------------------------------ */
/*  Templates — the words                                              */
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

/**
 * Save a template's wording.
 *
 * The column list is written out — `name`, `subject`, `body` and nothing else
 * — so `key` (the stable handle the sync matches on) and `isSystem` can never
 * be changed by a post. The alert that uses a template is not chosen here
 * either: which template an alert sends is fixed by the catalogue it ships in.
 */
export async function updateEmailTemplate(
  id: string,
  formData: FormData
): Promise<AutomationActionResult> {
  try {
    await requireAdminWrite("updateEmailTemplate");
    const parsed = templateInput.parse({
      name: String(formData.get("name") ?? ""),
      subject: String(formData.get("subject") ?? ""),
      body: String(formData.get("body") ?? ""),
    });
    const res = await prisma.emailTemplate.updateMany({
      where: { id: String(id) },
      data: { name: parsed.name, subject: parsed.subject, body: parsed.body },
    });
    if (res.count === 0) return { success: false, error: "That template no longer exists." };
    revalidateAutomation();
    return { success: true };
  } catch (error) {
    return { success: false, error: explain(error) };
  }
}

/* ------------------------------------------------------------------ */
/*  The queue                                                          */
/* ------------------------------------------------------------------ */

/**
 * Drain the queue by hand — the same `drainDueJobs` as the cron, protected by
 * the same claim, so pressing it twice, or while the cron is mid-pass, cannot
 * send anything twice.
 */
export async function runDueAutomationJobs(): Promise<
  AutomationActionResult & { report?: DrainReport }
> {
  try {
    await requireAdminWrite("runDueAutomationJobs");
    const report = await drainDueJobs();
    revalidateAutomation();
    return { success: true, report };
  } catch (error) {
    return { success: false, error: explain(error) };
  }
}

/** Withdraw a queued job without touching the alert that made it. */
export async function cancelAutomationJob(
  id: string
): Promise<AutomationActionResult> {
  try {
    await requireAdminWrite("cancelAutomationJob");
    // Scoped to `pending` so this can never rewrite a job that already sent.
    const res = await prisma.automationJob.updateMany({
      where: { id: String(id), status: "pending" },
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

/**
 * Re-queue a failed or skipped job so the next drain tries it again.
 *
 * Safe against a double send for three reasons, none of which is this
 * function: a `sent` job is not selectable here; the drain claims the job with
 * a compare-and-set before anything leaves; and delivery re-asks every
 * question at send time — including whether the alert is still switched on —
 * so a job skipped because it no longer applied is skipped again.
 */
export async function retryAutomationJob(
  id: string
): Promise<AutomationActionResult> {
  try {
    await requireAdminWrite("retryAutomationJob");
    const res = await prisma.automationJob.updateMany({
      where: { id: String(id), status: { in: ["failed", "cancelled"] } },
      data: { status: "pending", runAt: new Date(), error: null, sentAt: null },
    });
    if (res.count === 0) {
      return { success: false, error: "Only a failed or skipped job can be retried." };
    }
    revalidateAutomation();
    return { success: true };
  } catch (error) {
    return { success: false, error: explain(error) };
  }
}
