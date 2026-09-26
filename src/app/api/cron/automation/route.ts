/**
 * Runs one automation pass: sweep, then drain.
 * GET /api/cron/automation
 *
 * This route is the reason `AutomationJob` exists. A rule with a delay — "nudge
 * an abandoned cart 24 hours later" — cannot be a `setTimeout`, because a
 * serverless function is killed seconds after it flushes its response. The
 * delay has to be durable state that somebody comes back for, and this is that
 * somebody.
 *
 * The sweep half is inside `drainDueJobs`, not here, so every caller gets it.
 * It catches reverse-leg statuses written by the courier paths — a pickup that
 * was collected or delivered back — which have no code of their own that could
 * raise a trigger. See `sweepReturnStatuses` in `lib/automation.ts`.
 *
 * **On the schedule.** `vercel.json` carries two cron entries because that is
 * the Hobby plan's budget, and this route is not one of them: the daily
 * `/api/cron/nimbus-sync` calls `drainDueJobs()` directly so the pass still
 * happens. This route stays because it is the right target for an hourly
 * schedule the moment the plan allows one, and because it is what the admin's
 * "Run now" button mirrors. Admin → Automation states the schedule as it
 * actually is.
 *
 * Auth is the same shape as `/api/cron/nimbus-sync`, deliberately: Vercel sends
 * `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is set on the project,
 * and **without the env var the route refuses everything rather than sitting
 * open**. Failing closed matters more here than it does for the sync — an open
 * drain is an endpoint a stranger can hit to make the store email its
 * customers, or push to their phones, on demand and at the store's expense.
 * The push half raised the stakes rather than changing them: a stranger who
 * could drain this queue could put a banner on a customer's lock screen.
 *
 * It cannot double-send. Every job is claimed with a compare-and-set on its
 * status before anything reaches Resend or a push service, so two overlapping
 * invocations — a cron run and the admin's "Run due jobs now" landing together
 * — have exactly one winner per job. The full argument is in the header of
 * `lib/automation.ts`.
 */

import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { drainDueJobs } from "@/lib/automation";

export const dynamic = "force-dynamic";
// Jobs are delivered one at a time to stay inside the Prisma connection pool
// (see CLAUDE.md on `connection_limit=5`), so a backlog needs the longer budget.
export const maxDuration = 60;

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const header = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return header === secret || req.nextUrl.searchParams.get("secret") === secret;
}

export async function GET(req: NextRequest) {
  if (!authorised(req)) {
    const configured = Boolean(process.env.CRON_SECRET?.trim());
    return NextResponse.json(
      {
        error: configured
          ? "Unauthorized"
          : "Set CRON_SECRET to enable the automation queue.",
      },
      { status: configured ? 401 : 403 }
    );
  }

  // `drainDueJobs` never throws — it reports. A queue that failed to drain is a
  // line in the log and a backlog on the admin screen, not a 500 that Vercel
  // retries into a second pass over the same jobs.
  const report = await drainDueJobs();

  console.log(
    `[automation] swept ${report.swept} returns · ${report.due} due · ${report.sent} sent · ${report.failed} failed · ${report.skipped} skipped`
  );

  if (report.due > 0 || report.swept > 0) {
    try {
      revalidatePath("/admin/automation");
    } catch {
      // revalidatePath can throw outside a request context on some runtimes.
    }
  }

  return NextResponse.json(report);
}
