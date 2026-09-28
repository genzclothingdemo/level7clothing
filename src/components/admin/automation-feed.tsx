"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Bell,
  MessageSquare,
  Package,
  RotateCcw,
  ShoppingBag,
} from "lucide-react";

/**
 * **The owner's notification feed.**
 *
 * This is the screen the complaint was about. Admin → Notifications used to be
 * a *composer*: a box to type a broadcast into and a list of subscribed
 * devices. So the only thing that ever appeared as a notification was
 * something the owner had sent by hand, and a customer writing in chat, an
 * order shipping or a return being approved showed up nowhere at all.
 *
 * What is listed here is `AutomationJob` rows delivered on the `inapp`
 * channel — the same rows Admin → Automation lists, pauses and rewords. There
 * is no second notification store, so an entry here and a rule there can never
 * disagree about what the shop announced.
 *
 * It polls rather than subscribing, because the app is serverless — the same
 * reason chat polls. See the cadence note in `notification-bell.tsx`; this
 * component deliberately uses the same two numbers rather than inventing a
 * third rhythm.
 */

type FeedItem = {
  id: string;
  title: string;
  body: string;
  url: string;
  at: string;
  kind: string;
};

const POLL_VISIBLE_MS = 30_000;
const POLL_HIDDEN_MS = 180_000;

/**
 * The read mark, per device — the same rule and the same reasoning as the
 * storefront bell, under its own key so the owner's two roles do not clear
 * each other's counts.
 */
const SEEN_KEY = "l7_admin_notif_seen_at";

/** Safe during server rendering: `window` is undefined, the throw is caught, 0. */
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
    // Storage unavailable — everything stays marked new, which is the safe way
    // for this to fail.
  }
}

function ago(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 90) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** An element, never a component — see the RSC note in CLAUDE.md. */
function iconFor(kind: string) {
  const cls = "h-4 w-4";
  if (kind === "chat") return <MessageSquare className={cls} />;
  if (kind === "return") return <RotateCcw className={cls} />;
  if (kind === "lead") return <ShoppingBag className={cls} />;
  return <Package className={cls} />;
}

export function AutomationFeed() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  // A lazy initialiser, not a mount effect — see the long note on the same
  // line in `notification-bell.tsx`. Nothing rendered from this differs
  // between server and client at hydration, because `items` is empty on both.
  const [seenAt, setSeenAt] = useState<number>(readSeen);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    // A chain of timeouts, not an interval: a slow response can never stack
    // requests behind itself.
    const tick = async () => {
      try {
        const res = await fetch("/api/notifications", { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as { items?: FeedItem[] };
          if (!cancelled) setItems(Array.isArray(data.items) ? data.items : []);
        }
      } catch {
        // Keep whatever was already on screen; the next poll is 30s away.
      }
      if (cancelled) return;
      // Set unconditionally rather than behind a `useRef` "first time only"
      // guard. React's development double-mount runs this effect twice, and a
      // ref survives the remount while the state it was guarding does not — so
      // the guard gets spent on the instance whose state is thrown away, and
      // the surviving one renders "Loading…" for ever. `setLoaded(true)` is
      // idempotent, so there was nothing to guard in the first place.
      setLoaded(true);
      timer = setTimeout(tick, document.hidden ? POLL_HIDDEN_MS : POLL_VISIBLE_MS);
    };

    void tick();

    const onVisible = () => {
      if (document.hidden || cancelled) return;
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

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-[11px] uppercase leading-none tracking-[0.16em] text-muted-foreground">
          What&apos;s happened
          {unread > 0 && <span className="ml-2 text-accent">{unread} new</span>}
        </h2>
        {unread > 0 && (
          <button
            type="button"
            onClick={markRead}
            className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Mark all read
          </button>
        )}
      </div>

      {!loaded ? (
        <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <div className="mt-3 rounded-2xl border border-dashed border-border p-10 text-center">
          <Bell className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Nothing yet. New orders, chat messages, return requests and courier
            scans land here as they happen.
          </p>
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-border rounded-2xl border border-border">
          {items.map((item) => {
            const isNew = new Date(item.at).getTime() > seenAt;
            return (
              <li key={item.id}>
                <Link
                  href={item.url}
                  className="flex gap-3 px-4 py-3 transition-colors hover:bg-muted"
                >
                  <span className="mt-0.5 shrink-0 text-muted-foreground">
                    {iconFor(item.kind)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold leading-snug text-foreground">
                      {item.title}
                      {/* A dot, not a colour change on the row: an unread row
                          that is a different colour reads as a warning. */}
                      {isNew && (
                        <span
                          aria-label="new"
                          className="ml-2 inline-block h-1.5 w-1.5 -translate-y-px rounded-full bg-accent align-middle"
                        />
                      )}
                    </span>
                    {item.body && (
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
            );
          })}
        </ul>
      )}
    </div>
  );
}
