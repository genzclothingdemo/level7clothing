"use client";

/**
 * The queue: what is waiting to send, what went, and what did not.
 *
 * This is the screen that makes a delay believable. A rule that says "after 24
 * hours" is otherwise a promise with nothing behind it — the owner cannot see
 * that anything was scheduled, and when the email does not arrive there is no
 * way to tell whether the rule never matched, the job never drained, or Resend
 * refused it. Every one of those reads differently here.
 *
 * "Run due jobs now" exists because the cron runs **once a day** (see
 * `vercel.json`), which is coarse for a 30-minute delay and far too slow for
 * "did that work?". Pressing it is safe at any time: it calls the same
 * `drainDueJobs` as the cron, and every job is claimed with a compare-and-set
 * before anything is sent, so a press that lands on top of a cron pass cannot
 * send anything twice.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Play, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import {
  JobStatusPill,
  asJobStatus,
  relativeTime,
} from "@/components/admin/automation-summary";
import {
  cancelAutomationJob,
  retryAutomationJob,
  runDueAutomationJobs,
} from "@/app/actions/automation";

export type JobRow = {
  id: string;
  ruleName: string;
  status: string;
  runAt: string;
  sentAt: string | null;
  error: string | null;
  subjectType: string;
  subjectId: string;
};

const ICON_BUTTON =
  "inline-grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-lg text-muted-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-40";

export function AutomationQueue({
  jobs,
  due,
  pending,
}: {
  jobs: JobRow[];
  due: number;
  pending: number;
}) {
  const router = useRouter();
  const [running, startRun] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  function runNow() {
    startRun(async () => {
      const res = await runDueAutomationJobs();
      if (res.success && res.report) {
        const r = res.report;
        toast.success(
          r.due === 0
            ? "Nothing was due."
            : `${r.sent} sent · ${r.failed} failed · ${r.skipped} skipped`
        );
        router.refresh();
      } else {
        toast.error(res.error ?? "Couldn't run the queue.");
      }
    });
  }

  async function act(id: string, what: "cancel" | "retry") {
    setBusy(id);
    const res =
      what === "cancel"
        ? await cancelAutomationJob(id)
        : await retryAutomationJob(id);
    setBusy(null);
    if (res.success) {
      toast.success(what === "cancel" ? "Job cancelled" : "Job re-queued");
      router.refresh();
    } else {
      toast.error(res.error ?? "Couldn't update the job.");
    }
  }

  return (
    <section className="min-w-0">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-serif text-xl">The queue</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {pending === 0
              ? "Nothing waiting."
              : `${pending} waiting${due > 0 ? `, ${due} due now` : ""}.`}{" "}
            The scheduled job drains this once a day.
          </p>
        </div>
        <button
          type="button"
          onClick={runNow}
          disabled={running || due === 0}
          className="inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-border px-4 text-[11px] font-medium uppercase tracking-widest transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Play className="h-4 w-4" />
          {running ? "Running…" : "Run due jobs now"}
        </button>
      </div>

      {jobs.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-border p-8 text-center">
          <p className="font-serif text-lg">Nothing has run yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            Jobs appear here the first time a rule matches something. An
            immediate rule shows up already sent; a delayed one shows up queued
            with the time it will go.
          </p>
        </div>
      ) : (
        <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
          <div className="w-full max-w-full overflow-x-auto overscroll-x-contain">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Rule</th>
                  <th className="px-4 py-3 font-medium">About</th>
                  <th className="px-4 py-3 font-medium">When</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {jobs.map((job) => {
                  const status = asJobStatus(job.status);
                  return (
                    <tr key={job.id} className="align-top hover:bg-muted/40">
                      <td className="px-4 py-3">
                        <p className="max-w-[18rem] font-medium">{job.ruleName}</p>
                        {job.error && (
                          <p className="mt-0.5 max-w-[22rem] break-words text-xs text-muted-foreground">
                            {job.error}
                          </p>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                        {job.subjectType}
                        <br />
                        <code className="font-mono text-[11px]">
                          {job.subjectId.slice(-12)}
                        </code>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                        {status === "sent" && job.sentAt
                          ? relativeTime(job.sentAt)
                          : relativeTime(job.runAt)}
                      </td>
                      <td className="px-4 py-3">
                        <JobStatusPill status={status} />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-0.5">
                          {status === "pending" && (
                            <button
                              type="button"
                              onClick={() => act(job.id, "cancel")}
                              disabled={busy === job.id}
                              aria-label="Cancel this job"
                              title="Cancel"
                              className={`${ICON_BUTTON} hover:bg-danger/10 hover:text-danger`}
                            >
                              <Ban className="h-4 w-4" />
                            </button>
                          )}
                          {(status === "failed" || status === "cancelled") && (
                            <button
                              type="button"
                              onClick={() => act(job.id, "retry")}
                              disabled={busy === job.id}
                              aria-label="Try this job again"
                              title="Try again"
                              className={`${ICON_BUTTON} hover:bg-muted hover:text-foreground`}
                            >
                              <RotateCcw className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
