/**
 * How an automation is put into words, and the words for its status.
 *
 * **No `"use client"` on purpose.** The rules list is a server component and
 * the rule form is a client one, and both print the same delay wording and the
 * same pills. CLAUDE.md records what happens when a shared helper lives in a
 * client module instead — "Attempted to call isTabKey() from the server" took
 * out `/admin/settings` in production. A module with no directive can be
 * imported from either side, which is exactly what shared presentation needs.
 *
 * Everything here is pure: no hooks, no Prisma, no `getSettings()`.
 */

/* ------------------------------------------------------------------ */
/*  Words                                                              */
/* ------------------------------------------------------------------ */

/**
 * A delay, in the words an owner would use.
 *
 * Minutes are the storage unit because they are the only one that divides
 * cleanly into every case, but nobody thinks in "1440 minutes" — and a rule
 * list that says so is a rule list nobody checks.
 */
export function delaySummary(minutes: number): string {
  if (minutes <= 0) return "Immediately";
  if (minutes < 60) return `After ${minutes} minute${minutes === 1 ? "" : "s"}`;
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return `After ${days} day${days === 1 ? "" : "s"}`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `After ${hours} hour${hours === 1 ? "" : "s"}`;
  }
  const hours = Math.floor(minutes / 60);
  return `After ${hours}h ${minutes % 60}m`;
}

/**
 * The one sentence a rule is: trigger → conditions → delay → action.
 *
 * `verb` carries the channel ("email" / "notify") rather than being hardcoded:
 * a rule is one sentence, and a sentence that says "email" about a push rule is
 * a readout that lies.
 */
export function ruleSentence(opts: {
  triggerLabel: string;
  conditions: string;
  delayMinutes: number;
  recipient: string;
  verb?: string;
}): string {
  const when =
    opts.conditions === "Every time"
      ? opts.triggerLabel
      : `${opts.triggerLabel} (${opts.conditions})`;
  const delay =
    opts.delayMinutes > 0 ? `, ${delaySummary(opts.delayMinutes).toLowerCase()}` : "";
  return `When ${when.charAt(0).toLowerCase()}${when.slice(1)}${delay} → ${opts.verb ?? "email"} ${opts.recipient.toLowerCase()}.`;
}

/** The preset delays worth one tap. Anything else is typed. */
export const DELAY_PRESETS: { value: number; label: string }[] = [
  { value: 0, label: "Immediately" },
  { value: 60, label: "1 hour" },
  { value: 360, label: "6 hours" },
  { value: 1440, label: "24 hours" },
  { value: 4320, label: "3 days" },
];

/* ------------------------------------------------------------------ */
/*  Pills                                                              */
/* ------------------------------------------------------------------ */

const PILL =
  "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-wider";

export function RuleStatusPill({ isActive }: { isActive: boolean }) {
  return (
    <span
      className={
        isActive
          ? `${PILL} bg-success/15 text-success`
          : `${PILL} bg-muted text-muted-foreground`
      }
    >
      {isActive ? "On" : "Paused"}
    </span>
  );
}

export type JobStatus = "pending" | "sent" | "failed" | "cancelled";

const JOB_TONE: Record<JobStatus, string> = {
  pending: "bg-accent/15 text-accent",
  sent: "bg-success/15 text-success",
  failed: "bg-danger/15 text-danger",
  cancelled: "bg-muted text-muted-foreground",
};

const JOB_WORD: Record<JobStatus, string> = {
  pending: "Queued",
  sent: "Sent",
  failed: "Failed",
  // "Skipped" rather than "Cancelled": most of these were not cancelled by a
  // person, they stopped applying — the shopper bought before the nudge went.
  cancelled: "Skipped",
};

export function asJobStatus(raw: string): JobStatus {
  return (["pending", "sent", "failed", "cancelled"] as const).includes(raw as JobStatus)
    ? (raw as JobStatus)
    : "pending";
}

export function JobStatusPill({ status }: { status: JobStatus }) {
  return <span className={`${PILL} ${JOB_TONE[status]}`}>{JOB_WORD[status]}</span>;
}

/* ------------------------------------------------------------------ */
/*  Relative time                                                      */
/* ------------------------------------------------------------------ */

/**
 * "in 23 hours" / "2 minutes ago" — the only question worth asking of a queued
 * job is how long until it goes, and an absolute timestamp makes the reader do
 * that arithmetic themselves.
 */
export function relativeTime(value: Date | string | null | undefined, now = new Date()): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const diff = d.getTime() - now.getTime();
  const ahead = diff > 0;
  const mins = Math.round(Math.abs(diff) / 60_000);
  const say = (n: number, unit: string) =>
    ahead ? `in ${n} ${unit}${n === 1 ? "" : "s"}` : `${n} ${unit}${n === 1 ? "" : "s"} ago`;
  if (mins < 1) return ahead ? "any moment" : "just now";
  if (mins < 60) return say(mins, "minute");
  const hours = Math.round(mins / 60);
  if (hours < 48) return say(hours, "hour");
  return say(Math.round(hours / 24), "day");
}
