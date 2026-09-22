"use client";

import { Bell, BellOff, Download, Smartphone } from "lucide-react";
import { usePush } from "@/components/store/push-core";
import { InstallAppButton } from "@/components/store/install-app-button";
import { InfoTip } from "@/components/store/info-tip";

/**
 * "App & notifications" — the one place a customer can install the app and
 * control order alerts.
 *
 * Both controls used to be effectively hidden: install lived only in the
 * footer, and notifications could only be turned on from a prompt bar that
 * appears once and never returns. Someone who dismissed that bar had no way
 * back. The account page is where people go looking for their own settings,
 * so both live here permanently.
 *
 * Every state is explained rather than hidden, because the failure modes of
 * web push are all invisible otherwise:
 *  - blocked: the site cannot reopen the permission prompt, ever
 *  - iOS: push only works for an app added to the home screen
 *  - unsupported: some browsers simply have no push at all
 */
export function AppSettingsCard() {
  const push = usePush();

  const blocked = push.permission === "denied";
  const on = push.permission === "granted" && push.subscribed;
  // iOS only delivers push to an installed app, so offering the switch in a
  // Safari tab would be a control that provably cannot work.
  const iosNeedsInstall = push.apple && !push.standalone;

  return (
    <section
      aria-label="App and notifications"
      className="rounded-2xl border border-border p-4 sm:p-5"
    >
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <Smartphone className="h-4 w-4 text-accent" aria-hidden="true" />
        App &amp; notifications
      </h3>

      {/* ── Install ─────────────────────────────────────────────────── */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 p-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            Install the app
            <InfoTip term="Installing the store">
              Adds {`Level7`} to your home screen and opens it without browser
              chrome. It also works offline for pages you have already
              visited — and on iPhone it is the only way to receive order
              notifications.
            </InfoTip>
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {push.standalone
              ? "Already installed — you're using the app now."
              : "Faster to open, works offline, and enables order alerts."}
          </p>
        </div>

        {push.standalone ? (
          <span className="shrink-0 rounded-lg bg-success/10 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-success">
            Installed
          </span>
        ) : (
          /* Renders nothing when the browser has not offered installation —
             notably iOS Safari, which has no beforeinstallprompt event, so
             the hint below carries that case instead. */
          <InstallAppButton />
        )}
      </div>

      {!push.standalone && push.apple && (
        <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
          <Download className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          On iPhone: tap Share, then <strong>Add to Home Screen</strong>. Safari
          gives no install button, so this is the only route.
        </p>
      )}

      {/* ── Notifications ───────────────────────────────────────────── */}
      <div className="mt-3 rounded-lg border border-border/70 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-medium">
              {on ? (
                <Bell className="h-4 w-4 text-accent" aria-hidden="true" />
              ) : (
                <BellOff className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              )}
              Order notifications
              <InfoTip term="Order notifications">
                A short message when your order is confirmed, packed,
                dispatched or out for delivery. No marketing unless you ask for
                it, and you can switch them off here at any time.
              </InfoTip>
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {blocked
                ? "Blocked in your browser settings. The store can't reopen that prompt — allow notifications for this site, then come back."
                : iosNeedsInstall
                  ? "Install the app first — iPhone only delivers notifications to an installed app."
                  : push.support !== "ready"
                    ? "This browser doesn't support notifications."
                    : on
                      ? "On. You'll hear about your order as it moves."
                      : "Off. Turn them on to hear when your order ships."}
            </p>
          </div>

          {push.support === "ready" && !blocked && !iosNeedsInstall && (
            <button
              type="button"
              role="switch"
              aria-checked={on}
              aria-label="Order notifications"
              disabled={push.busy}
              onClick={() => void (on ? push.disable() : push.enable())}
              className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                on ? "bg-accent" : "bg-border"
              }`}
            >
              <span
                className={`inline-block h-5 w-5 rounded-full bg-background transition-transform ${
                  on ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          )}
        </div>

        {(push.error || push.notice) && (
          <p
            role="status"
            className={`mt-2 text-xs ${push.error ? "text-danger" : "text-muted-foreground"}`}
          >
            {push.error ?? push.notice}
          </p>
        )}

        {on && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/70 pt-3">
            <button
              type="button"
              onClick={() => void push.test()}
              disabled={push.busy}
              className="min-h-11 rounded-lg border border-border px-4 text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors hover:border-accent hover:text-accent disabled:opacity-60 sm:min-h-9"
            >
              {push.busy ? "Sending…" : "Send a test"}
            </button>
            <span className="text-xs text-muted-foreground">
              Proves it works end to end.
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
