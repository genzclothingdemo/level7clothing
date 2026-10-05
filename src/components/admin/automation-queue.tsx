"use client";

/**
 * Delivery history — what the store sent, what is waiting, and what did not
 * go. **This is how the owner answers "why didn't they get the email?"**
 *
 * Every alert, on every channel, is an `AutomationJob` row, so one list covers
 * email, phone and bell. Each row says which alert it was, who it was about,
 * where it went and what happened — and, when something went wrong, the
 * engine's own sentence for why ("No customer email on this record", "Resend
 * rejected the message", "the alert was switched off before this was due").
 * That sentence is folded behind a tap on the row, not printed on every line.
 *
 * Filtering and "view more" are links, not client state: the list is read on
 * the server, and a filtered view is a URL the owner can refresh or send.
 *
 * **Nothing here can send anything twice.** "Run now" is the cron's own
 * `drainDueJobs`, and every job is claimed with a compare-and-set before it
 * leaves; retry only re-queues a failed or skipped job, and delivery re-asks
 * every question — including whether the alert is still on — at send time.
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Ban, Bell, BellRing, ChevronDown, Mail, Play, Radio, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import {
  JobStatusPill,
  asJobStatus,
  relativeTime,
  type JobStatus,
} from "@/components/admin/automation-summary";
import {
  cancelAutomationJob,
  retryAutomationJob,
  runDueAutomationJobs,
} from "@/app/actions/automation";
import { cn } from "@/lib/utils";

export type JobRow = {
  id: string;
  ruleName: string;
  /** The alert's channel — `email` / `push` / `inapp`. */
  channel: string;
  /** "the customer" / "you" / an address. */
  to: string;
  /** "Order L7-1042 · Riya Sharma" — resolved on the server. */
  about: string;
  status: string;
  runAt: string;
  sentAt: string | null;
  /** The engine's own sentence: why it failed, why it was skipped, or what it did. */
  note: string | null;
};

export type HistoryFilter = "all" | JobStatus;

const FILTERS: { key: HistoryFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "failed", label: "Failed" },
  { key: "pending", label: "Waiting" },
  { key: "sent", label: "Sent" },
  { key: "cancelled", label: "Skipped" },
];

const CHANNEL_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  email: Mail,
  push: BellRing,
  inapp: Bell,
};

const CHANNEL_WORD: Record<string, string> = {
  email: "Email",
  push: "Phone",
  inapp: "Bell",
};

const ICON_BUTTON =
  "inline-grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-lg text-muted-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-40 sm:h-9 sm:w-9";

export function DeliveryHistory({
  jobs,
  counts,
  filter,
  hasMore,
  nextLimit,
  due,
  pending,
}: {
  jobs: JobRow[];
  counts: Record<HistoryFilter, number>;
  filter: HistoryFilter;
  hasMore: boolean;
  /** The `?limit=` that shows the next page. */
  nextLimit: number;
  due: number;
  pending: number;
}) {
  const router = useRouter();
  const [running, startRun] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  function runNow() {
    startRun(async () => {
      const res = await runDueAutomationJobs();
      if (res.success && res.report) {
        const r = res.report;
        toast.success(
          r.due === 0 && r.sent === 0
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
    const res = what === "cancel" ? await cancelAutomationJob(id) : await retryAutomationJob(id);
    setBusy(null);
    if (res.success) {
      toast.success(what === "cancel" ? "Cancelled" : "Queued to try again");
      router.refresh();
    } else {
      toast.error(res.error ?? "Couldn't update it.");
    }
  }

  const href = (key: HistoryFilter) =>
    key === "all" ? "/admin/automation" : `/admin/automation?status=${key}`;

  return (
    <section className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex min-w-0 items-center gap-1 font-serif text-xl leading-none">
          Delivery history
        </h2>
        <button
          type="button"
          onClick={runNow}
          disabled={running}
          className="inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-border px-4 text-[11px] font-medium uppercase tracking-widest transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-9"
          title="Send anything that is due now. Safe to press at any time."
        >
          <Play className="h-4 w-4" aria-hidden />
          {running ? "Running…" : "Run now"}
        </button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {pending === 0 ? "Nothing waiting." : `${pending} waiting${due > 0 ? ` · ${due} due now` : ""}.`}
      </p>

      {/* Filters — links, so a filtered view is a URL. */}
      <nav aria-label="Filter the history" className="mt-3 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const on = f.key === filter;
          const n = counts[f.key] ?? 0;
          return (
            <Link
              key={f.key}
              href={href(f.key)}
              aria-current={on ? "page" : undefined}
              className={cn(
                "inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium uppercase tracking-wider transition-colors",
                on
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                f.key === "failed" && n > 0 && !on && "border-danger/40 text-danger"
              )}
            >
              {f.label}
              <span className="tabular-nums opacity-80">{n}</span>
            </Link>
          );
        })}
      </nav>

      {jobs.length === 0 ? (
        <div className="mt-3 rounded-2xl border border-dashed border-border p-6 text-center">
          <p className="font-serif text-lg">
            {filter === "all" ? "Nothing has been sent yet" : "Nothing here"}
          </p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
            A message appears here the moment an alert matches something. If a
            customer says they heard nothing and there is no row, the alert for
            that event is switched off —{" "}
            <Link href="/admin/settings?tab=alerts" className="text-accent underline-offset-2 hover:underline">
              check it in Settings → Alerts
            </Link>
            .
          </p>
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {jobs.map((job) => {
            const status = asJobStatus(job.status);
            const Icon = CHANNEL_ICON[job.channel] ?? Radio;
            const expanded = open === job.id;
            const when =
              status === "sent" && job.sentAt ? relativeTime(job.sentAt) : relativeTime(job.runAt);
            return (
              <li key={job.id} className="min-w-0">
                <div className="flex min-w-0 items-start gap-3 px-3 py-2.5 sm:px-4">
                  <span
                    className="mt-0.5 inline-grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"
                    title={CHANNEL_WORD[job.channel] ?? job.channel}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>

                  <button
                    type="button"
                    onClick={() => setOpen(expanded ? null : job.id)}
                    aria-expanded={expanded}
                    disabled={!job.note}
                    className="min-w-0 flex-1 cursor-pointer text-left disabled:cursor-default"
                  >
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="min-w-0 break-words text-sm font-medium">{job.about}</span>
                      <JobStatusPill status={status} />
                    </span>
                    <span className="mt-0.5 block break-words text-xs text-muted-foreground">
                      {job.ruleName} · {CHANNEL_WORD[job.channel] ?? job.channel} to {job.to} ·{" "}
                      {status === "pending" ? `due ${when}` : when}
                      {job.note && (
                        <ChevronDown
                          aria-hidden
                          className={cn(
                            "ml-1 inline h-3 w-3 align-[-1px] transition-transform duration-200 motion-reduce:transition-none",
                            expanded && "rotate-180"
                          )}
                        />
                      )}
                    </span>
                  </button>

                  <div className="flex shrink-0 items-center gap-0.5">
                    {status === "pending" && (
                      <button
                        type="button"
                        onClick={() => act(job.id, "cancel")}
                        disabled={busy === job.id}
                        aria-label={`Cancel: ${job.about}`}
                        title="Cancel this one"
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
                        aria-label={`Try again: ${job.about}`}
                        title="Try again"
                        className={`${ICON_BUTTON} hover:bg-muted hover:text-foreground`}
                      >
                        <RotateCcw className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
                {/* Mounted only while open — never hidden in place. */}
                {expanded && job.note && (
                  <p
                    className={cn(
                      "animate-[fadeIn_0.15s_ease-out_both] break-words px-3 pb-3 pl-[3.25rem] text-xs leading-relaxed motion-reduce:animate-none sm:px-4 sm:pl-[3.5rem]",
                      status === "failed" ? "text-danger" : "text-muted-foreground"
                    )}
                  >
                    {job.note}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {hasMore && (
        <div className="mt-2 text-center">
          <Link
            href={`${href(filter)}${filter === "all" ? "?" : "&"}limit=${nextLimit}`}
            scroll={false}
            className="inline-flex min-h-11 items-center gap-1 text-[11px] font-medium uppercase tracking-widest text-accent transition-opacity hover:opacity-80"
          >
            View more <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          </Link>
        </div>
      )}
    </section>
  );
}
