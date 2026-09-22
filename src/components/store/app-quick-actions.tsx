"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Check, Share, SquarePlus } from "lucide-react";
import { InfoTip } from "@/components/store/info-tip";
import { NotificationBell } from "@/components/store/notification-bell";
import { isStandalone } from "@/components/store/push-core";
import { useSettings } from "@/context/settings";
import { cn } from "@/lib/utils";

/**
 * Install + notifications, as two icons in the utility strip above the navbar.
 *
 * ## What this replaced, and why
 *
 * Both controls used to live in `AppSettingsCard`, a panel pinned to the top of
 * the account profile. It was the first thing a customer saw after logging in,
 * it carried three paragraphs of explanation, and it took roughly 40% of a
 * phone screen to offer one button and one switch — on a page whose job is
 * orders and addresses. The owner's note was blunt: *"app notification part
 * take large place — keep it above the navbar in a small space, simple install
 * icon and notification toggle, use (i) for the explanation."*
 *
 * So: two 44px icons, and every word that was printed on that card is still
 * here — moved behind each control's own panel and its `InfoTip`. Nothing was
 * dropped. Specifically:
 *
 * - **iOS has no `beforeinstallprompt`.** Safari never fires it, so a button
 *   wired to that event is invisible on the one platform where installing
 *   matters most. The iPhone branch below spells out Share → Add to Home
 *   Screen instead, which is the only route Apple offers.
 * - **iOS only delivers push to an installed app.** That rule now lives in
 *   `NotificationBell`'s `needs-install` state (see that file) rather than in a
 *   paragraph nobody read.
 * - The permission prompt and the test send are unchanged, in the bell.
 *
 * ## Why a panel rather than a bare icon
 *
 * A single tap firing the native install prompt would be one tap shorter, but
 * then the explanation has nowhere to live, and iOS — which needs the most
 * explaining — can't use that path at all. One consistent pattern for both
 * controls beats two, and install is a once-ever action where a confirming
 * panel is not a cost.
 */
export function AppQuickActions({ className }: { className?: string }) {
  return (
    // `relative` here, and NOT on the install control's own wrapper, is what
    // keeps its panel on screen: `right-0` then resolves against the right edge
    // of the whole cluster rather than against a button that has the bell
    // sitting to its right, which at 320px would have pushed a 280px panel
    // 14px past the left edge and given the page a horizontal scrollbar. When
    // the bell renders nothing, the cluster's right edge IS the install
    // button's, so the same rule still holds.
    <div className={cn("relative flex shrink-0 items-center", className)}>
      <InstallControl />
      <NotificationBell />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Install                                                            */
/* ------------------------------------------------------------------ */

/**
 * The `beforeinstallprompt` event — Chromium-only, so not in the DOM lib.
 */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/** True for iPhone/iPad, including iPadOS, which reports itself as a Mac. */
function isApplePhoneOrTablet(): boolean {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
}

/*
 * "Is this an installed app?" and "is this an iPhone?" are both facts about the
 * browser, not React state — so they are read through `useSyncExternalStore`
 * rather than seeded by a `setState` inside an effect. Same call this repo
 * already makes for the push-prompt dismissal in `push-core.ts`, and it keeps
 * the `react-hooks/set-state-in-effect` count from growing.
 *
 * Both server snapshots are `false`, so the control is never in the
 * server-rendered HTML and there is nothing to mismatch on hydration.
 */
function subscribeDisplayMode(onChange: () => void): () => void {
  // Launching the installed app from the home screen genuinely flips this, so
  // it is a live subscription rather than a one-off read.
  const mq = window.matchMedia("(display-mode: standalone)");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** The user agent cannot change mid-session, so there is nothing to subscribe to. */
const noSubscription = () => () => {};

function InstallControl() {
  const { brandName } = useSettings();
  const standalone = useSyncExternalStore(
    subscribeDisplayMode,
    isStandalone,
    () => false
  );
  const apple = useSyncExternalStore(
    noSubscription,
    isApplePhoneOrTablet,
    () => false
  );

  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  // Set from the `appinstalled` event. Chrome does not always re-evaluate
  // `display-mode` in the tab the install was triggered from, so this covers
  // the gap until the next launch.
  const [justInstalled, setJustInstalled] = useState(false);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (standalone) return;

    const onPrompt = (e: Event) => {
      // Suppress Chrome's own mini-infobar so this is the single entry point.
      e.preventDefault();
      setPromptEvent(e as InstallPromptEvent);
    };
    const onInstalled = () => {
      setJustInstalled(true);
      setPromptEvent(null);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [standalone]);

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

  // Nothing to offer: already installed (dead UI in a standalone window), or a
  // browser that neither fires the install event nor has Apple's Share sheet
  // (desktop Firefox, most in-app webviews).
  if (standalone || justInstalled || (!promptEvent && !apple)) return null;

  return (
    // Deliberately NOT `relative` — see the note on the cluster above.
    <div ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label="Install the app"
        className="icon-btn"
      >
        {done ? (
          <Check className="h-[18px] w-[18px]" aria-hidden="true" />
        ) : (
          <SquarePlus className="h-[18px] w-[18px]" aria-hidden="true" />
        )}
      </button>

      {/* Conditionally rendered, never hidden with a transform — see the
          "Modal pattern" note in CLAUDE.md. */}
      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Install the app"
          className={cn(
            "absolute right-0 top-full z-50 mt-2 w-[min(19rem,calc(100vw-2.5rem))] rounded-lg border border-border bg-card p-4 text-left shadow-xl",
            // The strip this sits in is inverted (`text-background`), and a
            // panel that inherits that is white text on a white card.
            "text-foreground",
            "animate-[fadeIn_0.15s_ease-out_both] motion-reduce:animate-none"
          )}
        >
          <p className="flex items-center text-[11px] uppercase leading-none tracking-[0.16em] text-muted-foreground">
            Install the app
            <InfoTip term="Installing the store">
              Adds {brandName} to your home screen and opens it without browser
              chrome. It also works offline for pages you have already visited —
              and on iPhone it is the only way to receive order notifications.
            </InfoTip>
          </p>

          {promptEvent ? (
            <>
              <p className="mt-2 text-sm leading-relaxed">
                Faster to open, works offline, and it is what lets us tell you
                when your order ships.
              </p>
              <button
                type="button"
                onClick={async () => {
                  await promptEvent.prompt();
                  const { outcome } = await promptEvent.userChoice;
                  // The event is single-use: a dismissed prompt cannot be
                  // replayed, so drop it rather than leave a button that
                  // silently does nothing on the second press.
                  setPromptEvent(null);
                  setOpen(false);
                  if (outcome === "accepted") setDone(true);
                }}
                className="mt-4 min-h-[44px] w-full rounded-lg bg-foreground px-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-background transition-colors hover:bg-accent hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                Install
              </button>
            </>
          ) : (
            <>
              <p className="mt-2 text-sm leading-relaxed">
                Safari has no install button, so this is the only route on an
                iPhone:
              </p>
              <ol className="mt-3 space-y-2 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <Share className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>
                    Tap <strong className="text-foreground">Share</strong> at
                    the bottom of Safari.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <SquarePlus
                    className="mt-0.5 h-4 w-4 shrink-0"
                    aria-hidden="true"
                  />
                  <span>
                    Choose{" "}
                    <strong className="text-foreground">
                      Add to Home Screen
                    </strong>
                    .
                  </span>
                </li>
              </ol>
              <p className="mt-3 border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
                iPhone only delivers notifications to an installed app, so order
                alerts turn on after this.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
