/**
 * "Can this store actually send email?" — one line on Admin → Automation,
 * with the evidence one tap away.
 *
 * **No `"use client"` on purpose**: it is rendered by a server component and
 * takes plain data. `Disclosure` inside it is a client component, which a
 * server component may render — its children are serialised, never called.
 *
 * ## Why it is a line and not a card any more
 *
 * The sending identity — who mail is from, whether a key is set, where your
 * own copy lands — has one home now: **Settings → Alerts**, the card "How mail
 * leaves this store". This page used to print the same facts in a card of its
 * own, which is the two-homes shape the owner reads as duplication. What stays
 * here is only the part that belongs to *delivery*: did the last message
 * actually leave, and has anything failed. That is the question somebody
 * brings to this screen ("why didn't they get the email?"), and the answer is
 * a verdict, not a form.
 *
 * ## The two "last send" readings
 *
 * - **This server** is `lib/email.ts`'s in-memory record of the last message
 *   handed to Resend by *anything* — including the one-time code, the password
 *   reset and the contact form, which are not rules. Per-instance and
 *   short-lived on Vercel, and labelled as such.
 * - **The queue** is `AutomationJob`: durable, survives deploys, rule-driven
 *   mail only.
 *
 * The API key is never rendered — only whether one is set.
 */

import Link from "next/link";
import { AlertTriangle, ArrowUpRight, CheckCircle2, XCircle } from "lucide-react";
import type { EmailHealth } from "@/lib/email";
import { Disclosure } from "@/components/store/disclosure";
import { relativeTime } from "@/components/admin/automation-summary";

/** The durable half, read from `AutomationJob` by the page. */
export type QueueOutcome = {
  lastSentAt: string | null;
  lastSentRule: string | null;
  lastFailedAt: string | null;
  lastFailedRule: string | null;
  lastFailedError: string | null;
  failedCount: number;
};

type Tone = "good" | "warn" | "bad";

const TONE_BOX: Record<Tone, string> = {
  good: "border-success/40 bg-success/5",
  warn: "border-accent/40 bg-accent/5",
  bad: "border-danger/40 bg-danger/5",
};

const TONE_TEXT: Record<Tone, string> = {
  good: "text-success",
  warn: "text-accent",
  bad: "text-danger",
};

function ToneIcon({ tone }: { tone: Tone }) {
  const cls = `h-4 w-4 shrink-0 ${TONE_TEXT[tone]}`;
  if (tone === "good") return <CheckCircle2 className={cls} aria-hidden />;
  if (tone === "warn") return <AlertTriangle className={cls} aria-hidden />;
  return <XCircle className={cls} aria-hidden />;
}

/**
 * The verdict, in the owner's terms. Three judgements, each a real failure
 * once: a missing key is named first (nothing is even attempted); a
 * `resend.dev` sender is a warning, not a pass (it reaches only the Resend
 * account owner); and an own domain is not called "Sending" until something
 * has actually sent — this key cannot ask Resend whether a domain is verified.
 */
function verdict(health: EmailHealth, queue: QueueOutcome): { tone: Tone; line: string } {
  if (!health.hasApiKey) return { tone: "bad", line: "Nothing is being sent — no API key" };
  if (health.verdict === "unverifiable") {
    return { tone: "bad", line: "Every message is being rejected" };
  }
  if (health.lastSend?.outcome === "rejected" || health.lastSend?.outcome === "threw") {
    return { tone: "bad", line: "The last message did not go out" };
  }
  if (queue.failedCount > 0) {
    return {
      tone: "warn",
      line: `${queue.failedCount} message${queue.failedCount === 1 ? "" : "s"} failed`,
    };
  }
  if (health.verdict === "resend-test" || health.verdict === "fallback") {
    return { tone: "warn", line: "Sending, but only to you" };
  }
  const proven = health.lastSend?.outcome === "sent" || Boolean(queue.lastSentAt);
  return proven
    ? { tone: "good", line: "Sending" }
    : { tone: "warn", line: "Set up — nothing has gone out yet" };
}

const OUTCOME_WORD: Record<string, string> = {
  sent: "Sent",
  rejected: "Rejected by Resend",
  threw: "Failed to send",
  "no-api-key": "Skipped — no API key",
};

export function DeliveryHealth({
  health,
  queue,
}: {
  health: EmailHealth;
  queue: QueueOutcome;
}) {
  const { tone, line } = verdict(health, queue);
  const last = health.lastSend;
  const lastSent = queue.lastSentAt ? relativeTime(queue.lastSentAt) : null;

  return (
    <section className={`min-w-0 rounded-2xl border px-4 py-3 sm:px-5 ${TONE_BOX[tone]}`}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <p className="flex min-w-0 items-center gap-2 text-sm">
          <ToneIcon tone={tone} />
          <span className="font-medium">Email</span>
          <span className={`font-medium ${TONE_TEXT[tone]}`}>{line}</span>
        </p>
        <p className="min-w-0 text-xs text-muted-foreground">
          {lastSent ? `Last sent ${lastSent}` : "No alert has sent yet"}
          {queue.failedCount === 0 ? " · nothing failed" : ""}
        </p>
        <Link
          href="/admin/settings?tab=alerts"
          className="ml-auto inline-flex min-h-11 items-center gap-1 text-[11px] font-medium uppercase tracking-widest text-accent transition-opacity hover:opacity-80 sm:min-h-9"
        >
          Sender settings <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>

      <Disclosure label="Details" summary={health.advice ? "What decides this" : undefined}>
        <p className="mb-3 max-w-2xl break-words text-xs leading-relaxed text-muted-foreground">
          {health.advice}
        </p>
        <dl className="grid gap-3 text-xs sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="eyebrow text-muted-foreground">Last send · this server</dt>
            {last ? (
              <>
                <dd className="mt-1">
                  <span className={last.outcome === "sent" ? "font-medium" : "font-medium text-danger"}>
                    {OUTCOME_WORD[last.outcome] ?? last.outcome}
                  </span>
                  <span className="text-muted-foreground"> · {relativeTime(last.at)}</span>
                </dd>
                <dd className="mt-0.5 break-words text-muted-foreground">
                  “{last.subject}” → {last.to}
                </dd>
                {last.error && (
                  <dd className="mt-0.5 break-words font-mono text-danger">{last.error}</dd>
                )}
              </>
            ) : (
              <dd className="mt-1 text-muted-foreground">Nothing since this server started.</dd>
            )}
            <dd className="mt-1 text-muted-foreground">
              Every message, including the one-time code and password reset. Held
              in memory, so it resets on each deploy.
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="eyebrow text-muted-foreground">Last send · the queue</dt>
            <dd className="mt-1">
              {queue.lastSentAt ? (
                <>
                  <span className="font-medium">Sent</span>
                  <span className="text-muted-foreground"> · {relativeTime(queue.lastSentAt)}</span>
                </>
              ) : (
                <span className="text-muted-foreground">No alert has sent yet.</span>
              )}
            </dd>
            {queue.lastSentRule && (
              <dd className="mt-0.5 break-words text-muted-foreground">{queue.lastSentRule}</dd>
            )}
            {queue.lastFailedAt && (
              <dd className="mt-1 break-words">
                <span className="font-medium text-danger">
                  Last failure {relativeTime(queue.lastFailedAt)}
                </span>
                {queue.lastFailedRule ? ` · ${queue.lastFailedRule}` : ""}
                {queue.lastFailedError ? (
                  <span className="mt-0.5 block font-mono text-danger">{queue.lastFailedError}</span>
                ) : null}
              </dd>
            )}
            <dd className="mt-1 text-muted-foreground">
              Durable — survives a deploy, and covers every alert.
            </dd>
          </div>
        </dl>
      </Disclosure>
    </section>
  );
}
