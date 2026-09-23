/**
 * "Can this store actually send email?" — answered on the screen where the
 * answer matters.
 *
 * **No `"use client"` on purpose**, the same as `automation-summary.tsx`: this
 * is rendered by a server component and takes plain data, so it must not become
 * a client reference. CLAUDE.md records what happens otherwise — "Attempted to
 * call isTabKey() from the server" took out `/admin/settings` in production.
 *
 * ## Why this exists at all
 *
 * `EMAIL_FROM` was a gmail.com address for weeks. Resend can only send from a
 * domain you have verified and nobody can verify gmail.com, so **every** send
 * returned 403 — order confirmations, password resets, contact replies. The
 * code caught it, logged a `console.error` and returned normally, so the app
 * looked like it had worked. Nothing on any screen said otherwise, which is the
 * only reason it survived weeks.
 *
 * So the three facts that decide deliverability get a permanent home:
 *
 * 1. is there an API key,
 * 2. what address is mail sent *from*, and can that domain plausibly be
 *    verified,
 * 3. what happened to the last message.
 *
 * ## The API key is never rendered
 *
 * Only whether one is set. A screen that prints a send key is a screen that
 * leaks it into the first screenshot anybody takes of it — and this screen is
 * one an owner will screenshot to ask for help.
 *
 * ## Why there are two "last send" readings
 *
 * They answer different questions and neither alone is enough.
 *
 * - **This server** is `lib/email.ts`'s in-memory record of the last message it
 *   handed to Resend, whatever sent it — including the password reset and the
 *   contact form, which are not rules. It is the only place a *direct* send's
 *   outcome is visible. On Vercel it is per-instance and short-lived, so it is
 *   labelled as such rather than dressed up as history.
 * - **The queue** is `AutomationJob`, which is durable and survives deploys,
 *   but only covers rule-driven mail.
 */

import { AlertTriangle, CheckCircle2, Mail, XCircle } from "lucide-react";
import type { EmailHealth } from "@/lib/email";
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
  const cls = `h-5 w-5 shrink-0 ${TONE_TEXT[tone]}`;
  if (tone === "good") return <CheckCircle2 className={cls} />;
  if (tone === "warn") return <AlertTriangle className={cls} />;
  return <XCircle className={cls} />;
}

/**
 * The headline, in the owner's terms.
 *
 * Three judgements worth stating, because each one was a real failure:
 *
 * - A **missing key** is named before a bad sender. With no key nothing is even
 *   attempted, so it is the first thing to fix and the first thing to say.
 * - A `resend.dev` sender is a **warning, not a pass**. It delivers only to the
 *   Resend account owner, which looks exactly like success while it reaches no
 *   customer at all.
 * - A domain of your own is **not called "Sending" until something has actually
 *   sent.** Nothing here can check whether a domain is verified in Resend — the
 *   send-only API key this store uses returns `401 restricted_api_key` for
 *   `GET /domains`, so asking is not an option. A green "Sending" on an
 *   unverified domain would be precisely the false reassurance that let every
 *   message 403 for weeks. One successful send settles it; until then this says
 *   so.
 */
function headline(health: EmailHealth, queue: QueueOutcome): { tone: Tone; line: string } {
  if (!health.hasApiKey) {
    return { tone: "bad", line: "Nothing is being sent" };
  }
  if (health.verdict === "unverifiable") {
    return { tone: "bad", line: "Every message is being rejected" };
  }
  if (health.lastSend?.outcome === "rejected" || health.lastSend?.outcome === "threw") {
    return { tone: "bad", line: "The last message did not go out" };
  }
  if (queue.failedCount > 0) {
    return {
      tone: "warn",
      line: `${queue.failedCount} message${queue.failedCount === 1 ? "" : "s"} failed and ${queue.failedCount === 1 ? "is" : "are"} waiting in the queue below`,
    };
  }
  if (health.verdict === "resend-test" || health.verdict === "fallback") {
    return { tone: "warn", line: "Sending, but only to you" };
  }

  const proven = health.lastSend?.outcome === "sent" || Boolean(queue.lastSentAt);
  return proven
    ? { tone: "good", line: "Sending" }
    : {
        tone: "warn",
        line: "Set up — but nothing has gone out yet to prove the domain is verified",
      };
}

const OUTCOME_WORD: Record<string, string> = {
  sent: "Sent",
  rejected: "Rejected by Resend",
  threw: "Failed to send",
  "no-api-key": "Skipped — no API key",
};

export function EmailHealthCard({
  health,
  queue,
}: {
  health: EmailHealth;
  queue: QueueOutcome;
}) {
  const { tone, line } = headline(health, queue);
  const last = health.lastSend;

  return (
    <section className={`min-w-0 rounded-2xl border p-4 sm:p-5 ${TONE_BOX[tone]}`}>
      <div className="flex items-start gap-3">
        <ToneIcon tone={tone} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h2 className="font-serif text-lg">Email</h2>
            <span className={`text-sm font-medium ${TONE_TEXT[tone]}`}>{line}</span>
          </div>
          <p className="mt-1 max-w-2xl break-words text-sm text-muted-foreground">
            {health.advice}
          </p>
        </div>
      </div>

      <dl className="mt-4 grid gap-4 border-t border-border/60 pt-4 sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="eyebrow text-muted-foreground">Sends from</dt>
          <dd className="mt-1 break-all font-mono text-xs">{health.from}</dd>
          <dd className="mt-1 text-xs text-muted-foreground">
            Set by the <code className="font-mono">EMAIL_FROM</code> environment
            variable. Changing it is a deploy, not a setting.
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="eyebrow text-muted-foreground">Resend API key</dt>
          <dd className="mt-1 text-sm font-medium">
            {health.hasApiKey ? "Set" : "Not set"}
          </dd>
          <dd className="mt-1 text-xs text-muted-foreground">
            {health.hasApiKey
              ? "The key itself is never shown here, on purpose."
              : "Without it every message is skipped with a line in the log and nothing reaches anyone."}
          </dd>
        </div>

        <div className="min-w-0">
          <dt className="eyebrow text-muted-foreground">
            Last send · this server
          </dt>
          {last ? (
            <>
              <dd className="mt-1 text-sm">
                <span
                  className={
                    last.outcome === "sent" ? "font-medium" : `font-medium ${TONE_TEXT["bad"]}`
                  }
                >
                  {OUTCOME_WORD[last.outcome] ?? last.outcome}
                </span>
                <span className="text-muted-foreground"> · {relativeTime(last.at)}</span>
              </dd>
              <dd className="mt-1 break-words text-xs text-muted-foreground">
                “{last.subject}” → {last.to}
              </dd>
              {last.error && (
                <dd className="mt-1 break-words font-mono text-xs text-danger">
                  {last.error}
                </dd>
              )}
            </>
          ) : (
            <dd className="mt-1 text-sm text-muted-foreground">
              Nothing yet since this server started.
            </dd>
          )}
          <dd className="mt-1 text-xs text-muted-foreground">
            Covers every message, including the password reset and the contact
            form. Held in memory, so it resets on each deploy.
          </dd>
        </div>

        <div className="min-w-0">
          <dt className="eyebrow text-muted-foreground">Last send · the queue</dt>
          <dd className="mt-1 text-sm">
            {queue.lastSentAt ? (
              <>
                <span className="font-medium">Sent</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {relativeTime(queue.lastSentAt)}
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">No rule has sent yet.</span>
            )}
          </dd>
          {queue.lastSentRule && (
            <dd className="mt-1 break-words text-xs text-muted-foreground">
              {queue.lastSentRule}
            </dd>
          )}
          {queue.lastFailedAt && (
            <dd className="mt-2 break-words text-xs">
              <span className="font-medium text-danger">
                Last failure {relativeTime(queue.lastFailedAt)}
              </span>
              {queue.lastFailedRule ? ` · ${queue.lastFailedRule}` : ""}
              {queue.lastFailedError ? (
                <span className="mt-0.5 block font-mono text-danger">
                  {queue.lastFailedError}
                </span>
              ) : null}
            </dd>
          )}
          <dd className="mt-1 text-xs text-muted-foreground">
            Durable — this is the record that survives a deploy, and it covers
            the rules below.
          </dd>
        </div>
      </dl>
    </section>
  );
}

/**
 * The mail that is **not** a rule, listed so this screen is the whole picture.
 *
 * Read-only with a reason each, the same treatment the order pipeline gets: the
 * page's job is to answer "what does my store send?", and an answer that
 * quietly omits two messages is not an answer. `DIRECT_MAIL` in
 * `lib/automation.ts` is the list — add to it when a direct sender is added, or
 * this stops being true.
 */
export function DirectMailCard({
  items,
}: {
  items: { name: string; to: string; why: string }[];
}) {
  return (
    <div className="mt-3 min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <Mail className="h-4 w-4 text-muted-foreground" />
        <h3 className="font-serif text-lg">Mail that isn&rsquo;t a rule</h3>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Everything else your store emails is a rule above, and pausing it stops
        the message. These two are not, because switching them off would break
        something rather than quieten it.
      </p>
      <ul className="mt-4 divide-y divide-border text-sm">
        {items.map((item) => (
          <li key={item.name} className="py-3 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="min-w-0 font-medium">{item.name}</p>
              <span className="shrink-0 text-xs text-muted-foreground">
                → {item.to}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">{item.why}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
