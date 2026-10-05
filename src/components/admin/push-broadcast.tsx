"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";
import { Card, Field } from "@/components/admin/form-kit";
import { InfoTip } from "@/components/store/info-tip";
import { broadcastPush } from "@/app/actions/push";

/**
 * Compose and send one push to every subscribed device.
 *
 * It lives on its own screen (`/admin/notifications/send`) rather than under
 * the feed, because the two jobs pull in opposite directions: the feed is
 * read many times a day, and a broadcast is rare and lands on real lock
 * screens. A composer sitting open under the feed was the loudest thing on
 * the page for the errand people least often came to run.
 *
 * Deliberate frictions, because a broadcast cannot be recalled:
 *
 * 1. **Send is two presses.** The first opens a confirmation that names the
 *    number of devices; only its "Yes" sends. Any edit to the message closes
 *    it again — the confirmation applied to the text that was on screen when
 *    it opened, not to whatever it says now.
 * 2. **A double-click cannot answer its own question.** The "Yes" button sits
 *    under the confirmation's sentence, not where the first button was, and
 *    ignores presses in the first {@link ARM_GUARD_MS}ms — the second half of
 *    a double-click lands on text, or inside that window, and does nothing.
 *    Focus moves to Cancel, so Enter on a freshly opened confirmation is the
 *    safe answer.
 * 3. **The preview is the real payload.** Title, body and link are shown in
 *    the shape they will arrive in, against the same length limits the server
 *    enforces — so "it looked fine in the box" and "it looked fine on the
 *    phone" are the same thing.
 *
 * None of that is the permission. `broadcastPush` routes through
 * `requireAdminWrite` (a view-only admin is refused there) and rate-limits
 * itself; this screen only makes the two presses deliberate.
 *
 * The limits are passed in from the page rather than re-typed here: they are
 * defined once in `@/lib/push`, which is server-only and cannot be imported
 * into a client component.
 */

/**
 * What a phone shows when a push arrives with a blank message — the service
 * worker's `PUSH_FALLBACK.body` in `public/sw.js`, which cannot be imported
 * here. Previewing a placeholder instead would show the owner something no
 * phone will ever display.
 */
const BLANK_BODY_ON_PHONE = "Open the app for the latest.";

/** The icon the service worker attaches to every notification. */
const NOTIFICATION_ICON = "/icons/icon-192.png";

/** A double-click's second press lands roughly 100–300 ms after the first. */
const ARM_GUARD_MS = 450;

type LastSend = { sent: number; failed: number; pruned: number };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function PushBroadcast({
  limits,
  deviceCount,
  appName,
}: {
  limits: { title: number; body: number; url: number };
  deviceCount: number;
  /** The installed app's name (`short_name` in the manifest), for the preview. */
  appName: string;
}) {
  const router = useRouter();
  const [form, setForm] = useState({ title: "", body: "", url: "" });
  // When the confirmation opened, or null while it is closed — one value, so
  // the guard below can never disagree with whether it is showing.
  const [armedAt, setArmedAt] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [last, setLast] = useState<LastSend | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmId = useId();
  const armed = armedAt !== null;

  const set = (patch: Partial<typeof form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setArmedAt(null);
  };

  const urlInvalid = form.url !== "" && (!form.url.startsWith("/") || form.url.startsWith("//"));
  const ready = deviceCount > 0 && form.title.trim().length > 0 && !urlInvalid;
  const devices = plural(deviceCount, "device");

  // Cancel, never Send, takes focus when the confirmation opens.
  useEffect(() => {
    if (armed) cancelRef.current?.focus();
  }, [armed]);

  async function send() {
    if (armedAt === null || performance.now() - armedAt < ARM_GUARD_MS) return;
    setSending(true);
    try {
      const result = await broadcastPush(form);
      if (!result.ok) {
        toast.error(result.error ?? "Send failed");
        return;
      }
      setLast({
        sent: result.sent ?? 0,
        failed: result.failed ?? 0,
        pruned: result.pruned ?? 0,
      });
      toast.success(`Sent to ${plural(result.sent ?? 0, "device")}`);
      setForm({ title: "", body: "", url: "" });
      // A send prunes expired subscriptions, so the count this screen was
      // rendered with may now be too high. Re-read it rather than keep it.
      router.refresh();
    } catch {
      toast.error("Send failed");
    } finally {
      setSending(false);
      setArmedAt(null);
    }
  }

  const title = form.title.trim();
  const body = form.body.trim();
  const opens = form.url.trim() || "/";

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
      <Card title="Message">
        <Field
          label="Title"
          required
          hint={`${form.title.length}/${limits.title}`}
        >
          {(id) => (
            <input
              id={id}
              className="input"
              value={form.title}
              maxLength={limits.title}
              disabled={sending}
              onChange={(e) => set({ title: e.target.value })}
              placeholder="New drop is live"
            />
          )}
        </Field>

        <Field
          label="Message"
          hint={`${form.body.length}/${limits.body}`}
          tip="Android and desktop show about two lines before cutting off; iOS shows a little more. Put the point first."
        >
          {(id) => (
            <textarea
              id={id}
              rows={3}
              className="input resize-none"
              value={form.body}
              maxLength={limits.body}
              disabled={sending}
              onChange={(e) => set({ body: e.target.value })}
              placeholder="Twelve new tees, out now."
            />
          )}
        </Field>

        <Field
          label="Opens"
          tip="Where a tap lands. A page on this site only — an outside link is refused, because a notification that opens somewhere else is how push gets reported as spam."
          hint={
            urlInvalid
              ? "Must start with a single / — for example /shop"
              : "Blank opens the home page."
          }
        >
          {(id) => (
            <input
              id={id}
              className="input"
              value={form.url}
              maxLength={limits.url}
              disabled={sending}
              onChange={(e) => set({ url: e.target.value })}
              placeholder="/shop"
            />
          )}
        </Field>
      </Card>

      <Card
        title="Preview"
        tip="Roughly how it lands. Every phone styles notifications its own way, so treat the line breaks as a guide. The sound is the phone's own notification sound — a web app can't choose it."
      >
        <div className="rounded-2xl bg-muted/60 p-3">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Image
              src={NOTIFICATION_ICON}
              alt=""
              width={20}
              height={20}
              className="h-5 w-5 shrink-0 rounded-md"
            />
            <span className="min-w-0 flex-1 truncate font-medium">{appName}</span>
            <span className="shrink-0">now</span>
          </div>
          <p
            className={
              title
                ? "mt-2 truncate text-sm font-semibold text-foreground"
                : "mt-2 truncate text-sm font-semibold text-muted-foreground/60"
            }
          >
            {title || "Title"}
          </p>
          <p className="mt-0.5 line-clamp-2 break-words text-xs leading-relaxed text-muted-foreground">
            {body || BLANK_BODY_ON_PHONE}
          </p>
        </div>
        <p className="break-words text-xs text-muted-foreground">
          Tapping it opens <span className="font-mono text-foreground">{opens}</span>
        </p>
      </Card>

      <div className="min-w-0 lg:col-start-1">
        {armed ? (
          <div
            role="group"
            aria-labelledby={confirmId}
            onKeyDown={(e) => {
              if (e.key === "Escape" && !sending) setArmedAt(null);
            }}
            className="rounded-2xl border border-accent/40 bg-accent/5 p-4 sm:p-5"
          >
            {/* Template strings for every sentence with a value in it: the
                JSX transform drops the leading space of a text chunk that
                wraps onto a second line ("1 devicenow?"). */}
            <p id={confirmId} className="text-sm font-semibold text-foreground">
              {`Send this to ${devices} now?`}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              It arrives straight away and can&apos;t be recalled or edited.
            </p>
            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                ref={cancelRef}
                type="button"
                onClick={() => setArmedAt(null)}
                disabled={sending}
                className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-border bg-card px-5 text-[11px] font-medium uppercase tracking-widest transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void send()}
                disabled={sending}
                className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg bg-foreground px-6 text-[11px] font-medium uppercase tracking-widest text-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-40"
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Send className="h-4 w-4" aria-hidden />
                )}
                {sending ? "Sending…" : `Yes — send to ${devices}`}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col-reverse gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 text-xs leading-relaxed text-muted-foreground" aria-live="polite">
              {last && <LastSendLine last={last} />}
            </div>
            <button
              type="button"
              onClick={() => setArmedAt(performance.now())}
              disabled={!ready}
              className="inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-lg bg-foreground px-6 text-[11px] font-medium uppercase tracking-widest text-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Send className="h-4 w-4" aria-hidden />
              Send to {devices}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * What the last send did. "Expired" is the one word here that needs a gloss —
 * it is why the device count can drop after a send — so it carries the (i).
 */
function LastSendLine({ last }: { last: LastSend }) {
  const parts = [`${last.sent} delivered`];
  if (last.failed > 0) parts.push(`${last.failed} failed`);
  if (last.pruned > 0) parts.push(`${last.pruned} expired and removed`);
  return (
    <p className="flex flex-wrap items-center gap-x-1">
      <span>{`Last send: ${parts.join(", ")}.`}</span>
      {last.pruned > 0 && (
        <InfoTip term="Expired">
          The push service reported that device gone — the store was deleted
          from its home screen, its browser data was cleared, or notifications
          were switched off. It has been taken off the list, and comes back if
          that device turns notifications on again.
        </InfoTip>
      )}
    </p>
  );
}
