"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  Bell,
  BellRing,
  MessageSquare,
  Package,
  RotateCcw,
  ShoppingBag,
} from "lucide-react";
import { InfoTip } from "@/components/store/info-tip";
import { usePush } from "@/components/store/push-core";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  The feed                                                           */
/* ------------------------------------------------------------------ */

type FeedItem = {
  id: string;
  title: string;
  body: string;
  url: string;
  at: string;
  kind: string;
};

/**
 * **Poll cadence, and why these three numbers.**
 *
 * This is polled rather than pushed because the app is serverless — CLAUDE.md
 * says so for chat, and a notification feed is the same problem. The numbers
 * are chosen against what else is already polling this store, so the bell
 * never becomes the reason a page feels slow:
 *
 * - **30 s while the tab is visible.** The same cadence `admin/attention.tsx`
 *   already uses, so this introduces no new rhythm to the app. It is well
 *   inside what reads as "live" for a feed you glance at, and it is six times
 *   gentler than the chat widget's 5 s — which is correct, because chat is a
 *   conversation and this is a digest.
 * - **3 minutes while hidden.** A background tab does not need to be current;
 *   it needs to be *right when you come back*, and the visibility listener
 *   below refetches the instant it does. That immediate refetch is what makes
 *   30 s feel instant in practice — you almost never wait out an interval,
 *   because returning to the tab is itself the trigger.
 * - **Stop entirely for a guest.** `audience: "none"` ends the loop after one
 *   request, so anonymous traffic — most of it — costs a single query per page
 *   load and nothing thereafter. That is what keeps this affordable against
 *   `connection_limit=5`.
 */
const POLL_VISIBLE_MS = 30_000;
const POLL_HIDDEN_MS = 180_000;

/**
 * The read mark, per device.
 *
 * `AutomationJob` has no `readAt` column and this change was not allowed to
 * add one, so "unread" is the entries newer than the last time this browser
 * opened the panel. That is a genuinely different rule from a server-side
 * read flag — reading on a laptop does not clear the phone — but for a bell it
 * is the honest one anyway: it answers "what is new *to me, here*", which is
 * the question somebody opening it is actually asking.
 *
 * Every access is wrapped: a private window, cleared site data, or a browser
 * set to block storage all throw on read, and a bell that crashes the header
 * is far worse than one that shows everything as unread.
 */
const SEEN_KEY = "l7_notif_seen_at";

/**
 * Safe during server rendering too: `window` is simply undefined there, the
 * `ReferenceError` is caught, and the answer is 0 — which is the same answer
 * the client gives before anything has been read.
 */
function readSeen(): number {
  try {
    return Number(window.localStorage.getItem(SEEN_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeSeen(value: number) {
  try {
    window.localStorage.setItem(SEEN_KEY, String(value));
  } catch {
    // Storage is unavailable. Everything simply stays marked unread.
  }
}

/** "just now" / "12 min ago" / "3 days ago" — a feed needs no clock times. */
function ago(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 90) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

/** An element, never a component — see the RSC note in CLAUDE.md. */
function iconFor(kind: string) {
  const cls = "h-4 w-4";
  if (kind === "chat") return <MessageSquare className={cls} />;
  if (kind === "return") return <RotateCcw className={cls} />;
  if (kind === "lead") return <ShoppingBag className={cls} />;
  return <Package className={cls} />;
}

/**
 * Fetch the feed, keep it current, and say how much of it is new.
 *
 * The loop is a chain of `setTimeout`s rather than a `setInterval`, so a slow
 * response can never stack requests on top of each other — the next wait
 * starts when the last one finished.
 */
function useFeed() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [audience, setAudience] = useState<"admin" | "customer" | "none" | "unknown">("unknown");
  /**
   * Read in a lazy initialiser rather than a mount effect.
   *
   * The usual reason localStorage has to be read in an effect is hydration:
   * the server cannot know the stored value, so initialising from it makes
   * the first client render disagree with the server's HTML. **That cannot
   * happen here**, because `items` starts empty on both sides and `seenAt`
   * only ever affects the rendering of items — so at hydration the unread
   * count is 0 whatever this returns. The feed arrives strictly afterwards,
   * from a fetch. Doing it this way avoids a second render and one more
   * `react-hooks/set-state-in-effect` error on the pile CLAUDE.md records.
   */
  const [seenAt, setSeenAt] = useState<number>(readSeen);
  const stopped = useRef(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const tick = async () => {
      try {
        const res = await fetch("/api/notifications", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { audience: typeof audience; items: FeedItem[] };
        if (cancelled) return;
        setAudience(data.audience);
        setItems(Array.isArray(data.items) ? data.items : []);
        // A guest has nothing to poll for. One request, then silence.
        if (data.audience === "none") {
          stopped.current = true;
          return;
        }
      } catch {
        // A failed poll is not worth surfacing — the next one is 30 seconds
        // away and the bell keeps showing what it already had.
        if (cancelled) return;
      }
      if (cancelled || stopped.current) return;
      timer = setTimeout(tick, document.hidden ? POLL_HIDDEN_MS : POLL_VISIBLE_MS);
    };

    void tick();

    // Coming back to the tab is itself a reason to refetch — this is what
    // makes a 30-second interval feel immediate.
    const onVisible = () => {
      if (document.hidden || stopped.current || cancelled) return;
      clearTimeout(timer);
      void tick();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const unread = items.filter((i) => new Date(i.at).getTime() > seenAt).length;

  const markRead = useCallback(() => {
    const newest = items.reduce((max, i) => Math.max(max, new Date(i.at).getTime()), 0);
    if (!newest) return;
    writeSeen(newest);
    setSeenAt(newest);
  }, [items]);

  return { items, audience, unread, markRead };
}

/**
 * The bell in the header: **what has happened**, and the one setting that
 * decides whether it also reaches you when the app is closed.
 *
 * It used to be the setting alone. That was the owner's actual complaint —
 * the only thing a notification could ever be was something they had typed
 * into Admin → Notifications and broadcast by hand, so a chat message
 * arriving, an order shipping or a return being approved appeared nowhere.
 * Now the panel leads with the feed and the push switch sits under it, which
 * is the right order: the list is why anybody opens a bell, and the switch is
 * something you touch once.
 *
 * The feed comes from `/api/notifications`, which is `AutomationJob` rows on
 * the `inapp` channel — the same rows the owner can pause and reword in
 * Admin → Automation. There is no second notification store.
 *
 * **The bell renders whenever there is either a feed or a usable push
 * control.** It used to render nothing at all when push was unavailable, which
 * would now hide the feed from every browser without a Push API — including
 * every in-app webview an Instagram link opens in.
 *
 * Three push states render *without* an enable button, because in all of them
 * the customer has somewhere to go and hiding the reason would help nobody:
 *
 * - `denied` — the site cannot reopen that prompt, so the panel says where the
 *   real switch is.
 * - `needs-install` — iOS Safari in a normal tab. Apple only exposes
 *   `PushManager` once the site is on the home screen.
 * - `needs-ios-update` — installed already, but on an iOS older than 16.4.
 *   Telling this person to install the app is the one piece of advice
 *   guaranteed not to help.
 *
 * Mounted in the utility strip above the navbar, via `AppQuickActions`.
 */
export function NotificationBell({ className }: { className?: string }) {
  const push = usePush();
  const feed = useFeed();
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

  // Two iPhone states where the switch cannot work yet but the way out is
  // knowable, so the bell stays and explains rather than vanishing:
  // `needs-install` (iOS in a Safari tab — the install icon is right beside
  // this one) and `needs-ios-update` (installed already, but on an iOS older
  // than 16.4, where Apple had not shipped web push). Both render the panel
  // with no control in it, because a button that provably does nothing is
  // worse than a sentence that explains why.
  const needsInstall = push.support === "needs-install";
  const needsUpdate = push.support === "needs-ios-update";
  const explainOnly = needsInstall || needsUpdate;
  const pushUsable = push.support === "ready" || explainOnly;
  // Somebody signed in has a feed whether or not this browser can do push, and
  // the feed is now the main reason the bell exists. Only a browser with
  // neither — a guest, with no Push API — gets nothing.
  const hasFeed = feed.audience === "customer" || feed.audience === "admin";
  if (!pushUsable && !hasFeed) return null;

  const on = !explainOnly && push.permission === "granted" && push.subscribed;
  const blocked = !explainOnly && push.permission === "denied";
  const Icon = feed.unread > 0 || on ? BellRing : Bell;

  return (
    <div ref={wrapRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => {
          // Opening is reading. Doing it here rather than on close means the
          // count clears the moment you look, which is what every other bell
          // in the world does.
          if (!open) feed.markRead();
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={
          feed.unread > 0
            ? `Notifications — ${feed.unread} new`
            : explainOnly
              ? // "Turn on notifications" would be a promise this button cannot
                // keep in either iPhone state, and a screen-reader user has no
                // other way to find that out before pressing it.
                "Why notifications aren't available"
              : on
                ? "Notifications are on"
                : blocked
                  ? "Notifications are blocked"
                  : "Notifications"
        }
        // Squared and borderless, matching the rest of the top bar — see
        // `.icon-btn` in globals.css.
        className="icon-btn"
      >
        <Icon className="h-[18px] w-[18px]" />
        {/* No `ring-background` here, unlike the navbar's badges: this button
            sits on the inverted utility strip, where the surface behind it is
            `--foreground`, not `--background`. The dot clears the bell glyph on
            its own, so it needs no separator.

            An unread count beats the plain "push is on" dot whenever there is
            one — a number is information, a dot is decoration. */}
        {feed.unread > 0 ? (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-accent px-1 text-[10px] font-semibold leading-[18px] text-white"
          >
            {feed.unread > 9 ? "9+" : feed.unread}
          </span>
        ) : (
          on && (
            <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-success" />
          )
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
            // The strip this hangs from is inverted (`text-background`), and an
            // inherited text colour there is white-on-white.
            "text-foreground",
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

          {/*
            The feed, and it comes first. This is what somebody opens a bell
            to look at; the switch below is something you touch once and then
            never again.
          */}
          {hasFeed && (
            <div className="-mx-1 mt-3 max-h-[19rem] overflow-y-auto">
              {feed.items.length === 0 ? (
                <p className="px-1 text-sm leading-relaxed text-muted-foreground">
                  Nothing yet. Updates about your orders and returns show up
                  here.
                </p>
              ) : (
                <ul className="space-y-0.5">
                  {feed.items.map((item) => (
                    <li key={item.id}>
                      <Link
                        href={item.url}
                        onClick={() => setOpen(false)}
                        className="flex gap-2.5 rounded-lg px-1 py-2 transition-colors hover:bg-muted"
                      >
                        <span className="mt-0.5 shrink-0 text-muted-foreground">
                          {iconFor(item.kind)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-semibold leading-snug text-foreground">
                            {item.title}
                          </span>
                          {item.body && (
                            // Two lines, then an ellipsis. The whole thing is
                            // a link to the screen that has the detail.
                            <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-muted-foreground">
                              {item.body}
                            </span>
                          )}
                          <span className="mt-1 block text-[11px] text-muted-foreground">
                            {ago(item.at)}
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* A divider only when there is something above it to divide from. */}
          {hasFeed && pushUsable && (
            <p className="mt-3 border-t border-border pt-3 text-[11px] uppercase leading-none tracking-[0.16em] text-muted-foreground">
              On your device
            </p>
          )}

          {pushUsable && (
            <p className="mt-2 text-sm leading-relaxed text-foreground">
              {needsInstall
                ? "Install the app first."
                : needsUpdate
                  ? "Your iPhone is too old for this."
                  : on
                    ? "On for this device. You'll hear about your orders."
                    : blocked
                      ? "Blocked for this site."
                      : "Off. Turn them on to hear the moment your order is packed and dispatched, even when the app is closed."}
            </p>
          )}

          {/* The rule this carries used to live in a paragraph on the account
              page. iPhone genuinely cannot subscribe from a Safari tab, so the
              only honest control here is a pointer to the icon next door. */}
          {needsInstall && (
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              iPhone only delivers notifications to an app on the home screen.
              Add the store with the install icon beside this one, open it from
              there, and this switch starts working.
            </p>
          )}

          {needsUpdate && (
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Apple added notifications for installed web apps in iOS 16.4. This
              app is already on your home screen, so the only thing missing is
              the update: Settings → General → Software Update.
            </p>
          )}

          {blocked && (
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              The store can&apos;t reopen that prompt — browsers only let you
              undo it yourself. On a phone: device Settings → Apps → this app →
              Notifications. On a desktop browser: the icon at the left of the
              address bar → Notifications → Allow.
            </p>
          )}

          {!blocked && !explainOnly && (
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
