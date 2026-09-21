"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Bell, BellRing } from "lucide-react";
import { InfoTip } from "@/components/store/info-tip";
import { usePush } from "@/components/store/push-core";
import { cn } from "@/lib/utils";

/**
 * Permanent home for the notification setting — a bell in the header that
 * opens a small panel: what the current state is, the one control that changes
 * it, and a test send that proves it works.
 *
 * It renders **nothing at all** unless subscribing could actually succeed.
 * Three cases are hidden rather than shown disabled, because a control that
 * cannot do its job is worse than no control:
 *
 * - The deployment has no VAPID public key.
 * - The browser has no Push API (older Firefox ESR, most in-app webviews).
 * - iOS Safari in a normal tab. Apple only exposes `PushManager` once the site
 *   is installed to the home screen, so the bell would be a dead switch. The
 *   route out of that state is installation, which `InstallAppButton` already
 *   offers, so this component stays out of the way.
 *
 * The one state it does render without an enable button is `denied`: the site
 * cannot reopen that prompt, so the panel says where the real switch is.
 *
 * Mount it in the navbar's right-hand icon cluster — see the note in that
 * file's icon row.
 */
export function NotificationBell({ className }: { className?: string }) {
  const push = usePush();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (wrapRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };

    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [open]);

  // Clear any stale success/error line when the panel is closed, so reopening
  // it never shows the result of something that happened ten minutes ago.
  useEffect(() => {
    if (!open) push.clearMessages();
    // `clearMessages` is stable; re-running on every state change would wipe
    // the message the moment it was set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (push.support !== "ready") return null;

  const on = push.permission === "granted" && push.subscribed;
  const blocked = push.permission === "denied";
  const Icon = on ? BellRing : Bell;

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={
          on ? "Notifications are on" : blocked ? "Notifications are blocked" : "Turn on notifications"
        }
        className="relative grid h-11 w-11 cursor-pointer place-items-center rounded-full border border-border transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <Icon className="h-[18px] w-[18px]" />
        {on && (
          <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-success ring-2 ring-background" />
        )}
      </button>

      {/* Conditionally rendered, never hidden with a transform — see the
          "Modal pattern" note in CLAUDE.md. */}
      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Notifications"
          className={cn(
            "absolute right-0 top-full z-50 mt-2 w-[min(19rem,calc(100vw-2.5rem))] rounded-lg border border-border bg-card p-4 text-left shadow-xl",
            "animate-[fadeIn_0.15s_ease-out_both] motion-reduce:animate-none"
          )}
        >
          <p className="flex items-center text-[11px] uppercase leading-none tracking-[0.16em] text-muted-foreground">
            Notifications
            <InfoTip term="Push notifications">
              A short message from the store that appears on your device even
              when the app is closed — order packed, dispatched, out for
              delivery. No marketing unless you ask for it, and you can turn
              them off again at any time.
            </InfoTip>
          </p>

          <p className="mt-2 text-sm leading-relaxed text-foreground">
            {on
              ? "On for this device. You'll hear about your orders."
              : blocked
                ? "Blocked for this site."
                : "Off. Turn them on to hear when your order is packed and dispatched."}
          </p>

          {blocked && (
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              The store can&apos;t reopen that prompt — browsers only let you
              undo it yourself. On a phone: device Settings → Apps → this app →
              Notifications. On a desktop browser: the icon at the left of the
              address bar → Notifications → Allow.
            </p>
          )}

          {!blocked && (
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void (on ? push.disable() : push.enable())}
                disabled={push.busy}
                className={cn(
                  "min-h-[44px] flex-1 rounded-lg px-4 text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors disabled:opacity-60",
                  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                  on
                    ? "border border-border text-foreground hover:border-accent hover:text-accent"
                    : "bg-foreground text-background hover:bg-accent hover:text-white"
                )}
              >
                {push.busy ? "Working…" : on ? "Turn off" : "Turn on"}
              </button>

              {on && (
                <button
                  type="button"
                  onClick={() => void push.test()}
                  disabled={push.busy}
                  className="min-h-[44px] flex-1 rounded-lg bg-foreground px-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-background transition-colors hover:bg-accent hover:text-white disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  Send a test
                </button>
              )}
            </div>
          )}

          {(push.error || push.notice) && (
            <p
              role="status"
              className={cn(
                "mt-3 text-xs leading-relaxed",
                push.error ? "text-danger" : "text-success"
              )}
            >
              {push.error ?? push.notice}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
