"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Bell, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, Field } from "@/components/admin/form-kit";
import { broadcastPush } from "@/app/actions/push";

/**
 * Compose and send one push to every subscribed device.
 *
 * Two deliberate frictions, because a broadcast cannot be recalled:
 *
 * 1. **Send is two presses.** The first arms it and names the number of
 *    devices; the second sends. An accidental click costs nothing.
 * 2. **The preview is the real payload.** Title, body and link are shown in
 *    the shape they will arrive in, against the same length limits the server
 *    enforces — so "it looked fine in the box" and "it looked fine on the
 *    phone" are the same thing.
 *
 * The limits are passed in from the page rather than re-typed here: they are
 * defined once in `@/lib/push`, which is server-only and cannot be imported
 * into a client component.
 */
export function PushBroadcast({
  limits,
  deviceCount,
  configured,
}: {
  limits: { title: number; body: number; url: number };
  deviceCount: number;
  configured: boolean;
}) {
  const [form, setForm] = useState({ title: "", body: "", url: "" });
  const [arming, setArming] = useState(false);
  const [sending, setSending] = useState(false);
  const [last, setLast] = useState<{ sent: number; failed: number; pruned: number } | null>(
    null
  );

  const set = (patch: Partial<typeof form>) => {
    setForm((f) => ({ ...f, ...patch }));
    // Any edit disarms: the confirmation applied to the text that was on
    // screen when it was armed, not to whatever it says now.
    setArming(false);
  };

  const urlInvalid = form.url !== "" && (!form.url.startsWith("/") || form.url.startsWith("//"));
  const canSend =
    configured && deviceCount > 0 && form.title.trim().length > 0 && !urlInvalid && !sending;

  async function send() {
    setSending(true);
    setArming(false);
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
      toast.success(`Sent to ${result.sent ?? 0} device${result.sent === 1 ? "" : "s"}`);
      setForm({ title: "", body: "", url: "" });
    } catch {
      toast.error("Send failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <Card
        title="Compose"
        tip="This goes to every device that has opted in, on every platform, immediately. There is no way to recall a push once it has left."
      >
        <Field
          label="Title"
          required
          hint={`${form.title.length}/${limits.title} characters`}
        >
          {(id) => (
            <input
              id={id}
              className="input"
              value={form.title}
              maxLength={limits.title}
              onChange={(e) => set({ title: e.target.value })}
              placeholder="New drop is live"
            />
          )}
        </Field>

        <Field
          label="Message"
          hint={`${form.body.length}/${limits.body} characters`}
          tip="Android and desktop show two lines before truncating. iOS shows a little more. Put the point first."
        >
          {(id) => (
            <textarea
              id={id}
              rows={3}
              className="input resize-none"
              value={form.body}
              maxLength={limits.body}
              onChange={(e) => set({ body: e.target.value })}
              placeholder="Twelve new tees, out now."
            />
          )}
        </Field>

        <Field
          label="Opens"
          tip="Where a tap lands. A path on this site only — an outside link is rejected, because a notification that opens somewhere else is how push gets reported as spam."
          hint={
            urlInvalid
              ? "Must start with a single / — for example /shop"
              : "Leave blank to open the home page."
          }
        >
          {(id) => (
            <input
              id={id}
              className="input"
              value={form.url}
              maxLength={limits.url}
              onChange={(e) => set({ url: e.target.value })}
              placeholder="/shop"
            />
          )}
        </Field>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          {arming ? (
            <>
              <Button onClick={() => void send()} disabled={!canSend}>
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Yes — send to {deviceCount} device{deviceCount === 1 ? "" : "s"}
              </Button>
              <Button variant="ghost" onClick={() => setArming(false)} disabled={sending}>
                Cancel
              </Button>
            </>
          ) : (
            <Button onClick={() => setArming(true)} disabled={!canSend}>
              <Send className="h-4 w-4" />
              Send to all
            </Button>
          )}

          {!configured && (
            <p className="text-xs text-danger">
              VAPID keys are missing on this deployment.
            </p>
          )}
          {configured && deviceCount === 0 && (
            <p className="text-xs text-muted-foreground">
              Nobody has opted in yet, so there is nothing to send to.
            </p>
          )}
        </div>

        {last && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Last send: {last.sent} delivered
            {last.failed > 0 && `, ${last.failed} failed`}
            {last.pruned > 0 &&
              `, ${last.pruned} expired subscription${last.pruned === 1 ? "" : "s"} removed`}
            .
          </p>
        )}
      </Card>

      <Card
        title="Preview"
        tip="Roughly how it lands. Every platform styles notifications differently, so treat the wrapping as indicative."
      >
        <div className="rounded-lg border border-border bg-muted/50 p-3">
          <div className="flex gap-3">
            <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-foreground text-background">
              <Bell className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">
                {form.title.trim() || "Title"}
              </p>
              <p className="mt-0.5 line-clamp-2 break-words text-xs leading-relaxed text-muted-foreground">
                {form.body.trim() || "Your message appears here."}
              </p>
              <p className="mt-1.5 truncate text-[11px] text-muted-foreground">
                Opens {form.url.trim() || "/"}
              </p>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
