"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { InfoTip } from "@/components/store/info-tip";
import { dismissPrompt, usePromptDismissed, usePush } from "@/components/store/push-core";

/**
 * The "notifications are off" bar.
 *
 * Deliberately not a modal and not a toast. It is the announcement bar's twin,
 * mirrored to the bottom of the installed app — same ink surface, same rule,
 * same wide-tracked label — so it reads as part of the store's chrome rather
 * than as something that flew in over the top of it.
 *
 * The conditions are strict on purpose, because the failure mode of a
 * permission prompt is permanent:
 *
 * - **Installed apps only.** In a browser tab this is noise; on an installed
 *   app a shopper has already said they want the store on their home screen,
 *   which is the moment the offer makes sense. It is also the only context in
 *   which iOS supports web push at all.
 * - **`permission === "default"` only.** Once a shopper has said no, the site
 *   can never reopen that prompt — `requestPermission()` resolves instantly
 *   with `"denied"` and shows nothing. Asking again would be a button that
 *   provably does nothing, so the denied case gets an explanation of where the
 *   switch actually lives instead.
 * - **Dismissal is persisted** before the bar is removed, so it cannot come
 *   back on the next launch. An installed app relaunches constantly; a second
 *   ask would be the thing that gets notifications blocked for good.
 *
 * Mounted from `PwaRegister`, which is the storefront's existing service
 * worker entry point, so no layout needs to change to carry it.
 */
export function PushPrompt() {
  const pathname = usePathname();
  const push = usePush();

  // Read straight from the store: it fails closed (server snapshot `true`),
  // so the bar is never in the server HTML and there is nothing to mismatch
  // on hydration — and no setState-in-effect cascade.
  const dismissed = usePromptDismissed();
  // Once the shopper has pressed anything, the bar stops being governed by
  // the "should we ask?" rules and becomes the result of what they pressed —
  // otherwise granting permission would make the bar vanish mid-interaction,
  // taking the "send a test" confirmation with it.
  const [engaged, setEngaged] = useState(false);


  const close = () => {
    dismissPrompt();
    // `dismissPrompt` notifies the store, which re-renders this component.
  };

  // The admin panel shares the root layout. A shopper-facing opt-in has no
  // business appearing over the orders table.
  if (pathname?.startsWith("/admin")) return null;

  // `"unknown"` is the pre-mount state — render nothing rather than guess.
  if (push.support !== "ready") return null;
  if (!push.standalone) return null;
  if (dismissed) return null;
  if (!engaged && push.permission !== "default") return null;

  const blocked = push.permission === "denied";
  const granted = push.permission === "granted" && push.subscribed;

  return (
    <div
      role="region"
      aria-label="Notification settings"
      className={[
        // Sits above the fixed mobile tab bar rather than under it; on md+
        // there is no tab bar, so it meets the bottom edge.
        "fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom,0px))] z-40 md:bottom-0",
        "border-t border-background/15 bg-foreground text-background",
        // Opacity only. Its resting position is its own `bottom`, so an
        // interrupted animation can never strand it off screen.
        "animate-[fadeIn_0.2s_ease-out_both] motion-reduce:animate-none",
      ].join(" ")}
    >
      <div className="container-px mx-auto flex max-w-7xl flex-wrap items-center gap-x-5 gap-y-3 py-3">
        <div className="min-w-0 flex-1 basis-full sm:basis-64">
          <p className="flex items-center text-[11px] uppercase leading-none tracking-[0.16em] text-background/65">
            {/* Written out rather than using `.eyebrow`: that utility is
                unlayered, so its muted grey would win over any colour class
                and drop below AA on this ink surface. */}
            Notifications
            <InfoTip term="Push notifications">
              A short message from the store that appears on your device even
              when the app is closed — order packed, dispatched, out for
              delivery. No marketing unless you ask for it, and you can turn
              them off again at any time.
            </InfoTip>
          </p>

          <p className="mt-1.5 text-sm leading-relaxed">
            {granted
              ? "You're all set. Send yourself a test to see how it looks."
              : blocked
                ? "Notifications are blocked for this app. Open your device's app settings and allow notifications — the store can't reopen that prompt itself."
                : "Get told the moment your order is packed and dispatched."}
          </p>

          {(push.error || push.notice) && !granted && !blocked && (
            <p
              role="status"
              className={`mt-1.5 text-xs ${push.error ? "text-background/85" : "text-background/70"}`}
            >
              {push.error ?? push.notice}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {granted ? (
            <button
              type="button"
              onClick={() => void push.test()}
              disabled={push.busy}
              className="min-h-[44px] rounded-lg bg-background px-5 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground transition-colors hover:bg-accent hover:text-white disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {push.busy ? "Sending…" : "Send a test"}
            </button>
          ) : blocked ? null : (
            <button
              type="button"
              onClick={() => {
                setEngaged(true);
                void push.enable();
              }}
              disabled={push.busy}
              className="min-h-[44px] rounded-lg bg-background px-5 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground transition-colors hover:bg-accent hover:text-white disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {push.busy ? "Turning on…" : "Turn on"}
            </button>
          )}

          <button
            type="button"
            onClick={close}
            aria-label={granted ? "Close" : "Not now — don't ask again"}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-background/70 transition-colors hover:bg-background/10 hover:text-background focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <span aria-hidden="true" className="text-xl leading-none">
              &times;
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
