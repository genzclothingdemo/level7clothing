"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useState } from "react";
import {
  Bell,
  MessageSquare,
  Package,
  RotateCcw,
  ShoppingBag,
} from "lucide-react";
import { formatStoreDateTime } from "@/components/admin/coupon-summary";
import { cn } from "@/lib/utils";

/**
 * **The owner's notification feed** — the first thing Admin → Notifications
 * shows, because "what has happened?" is the question that screen is opened
 * to answer.
 *
 * What is listed here is `AutomationJob` rows delivered on the `inapp`
 * channel — the same rows Admin → Automation lists, and the same rules
 * Settings → Alerts switches on and off. There is no second notification
 * store, so an entry here and a rule there can never disagree about what the
 * shop announced.
 *
 * It polls rather than subscribing, because the app is serverless — the same
 * reason chat polls. See the cadence note in `notification-bell.tsx`; this
 * component deliberately uses the same two numbers rather than inventing a
 * third rhythm.
 *
 * Three presentation rules, each a decision rather than a default:
 *
 * - **One card, one status line.** "3 new · Mark all read", or "All caught
 *   up". The page heading already says what this is, so the card spends no
 *   words naming itself.
 * - **Long lists fold; unread rows never do.** Ten rows show and the rest sit
 *   behind "Show older" — but the fold moves down past the last unread row,
 *   so a busy morning can never tuck something new under a button.
 * - **A dot and a heavier title mark a new row, not a tinted background.** An
 *   unread row in a different colour reads as a warning.
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

/** Rows shown before "Show older". Unread rows are never folded — see above. */
const PREVIEW_ROWS = 10;

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

/**
 * The phone-width form of {@link ago}: "now", "4m", "2h", "3d". At 375px the
 * long form took a quarter of the row and broke titles like "L7-1031" at the
 * hyphen; the exact time is still in the `title` either way.
 */
function agoShort(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 90) return "now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
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
  // Only ever consulted while the list is empty: a poll that fails after
  // something has loaded keeps the last good list on screen instead.
  const [failed, setFailed] = useState(false);
  const [showAll, setShowAll] = useState(false);
  // A lazy initialiser, not a mount effect — see the long note on the same
  // line in `notification-bell.tsx`. Nothing rendered from this differs
  // between server and client at hydration, because `items` is empty on both.
  const [seenAt, setSeenAt] = useState<number>(readSeen);
  const headingId = useId();

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
          if (!cancelled) {
            setItems(Array.isArray(data.items) ? data.items : []);
            setFailed(false);
          }
        } else if (!cancelled) {
          setFailed(true);
        }
      } catch {
        // Keep whatever was already on screen; the next poll is 30s away.
        if (!cancelled) setFailed(true);
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

  const isNew = (item: FeedItem) => new Date(item.at).getTime() > seenAt;
  const unread = items.filter(isNew).length;

  const markRead = useCallback(() => {
    const newest = items.reduce((max, i) => Math.max(max, new Date(i.at).getTime()), 0);
    if (!newest) return;
    writeSeen(newest);
    setSeenAt(newest);
  }, [items]);

  // The fold never hides an unread row. The feed is newest-first, so unread
  // rows are normally a prefix — but `at` is the delivery stamp, not the sort
  // key, so the last unread index is found rather than assumed.
  let lastUnread = -1;
  items.forEach((item, index) => {
    if (isNew(item)) lastUnread = index;
  });
  const foldAt = Math.max(PREVIEW_ROWS, lastUnread + 1);
  const visible = showAll ? items : items.slice(0, foldAt);
  const folded = items.length - visible.length;
  const canFold = items.length > foldAt;

  return (
    <section
      aria-labelledby={headingId}
      className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card"
    >
      <h2 id={headingId} className="sr-only">
        Latest notifications
      </h2>

      {!loaded ? (
        <FeedSkeleton />
      ) : items.length === 0 ? (
        <FeedEmpty failed={failed} />
      ) : (
        <>
          <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border pl-4 pr-2">
            {unread > 0 ? (
              <p className="flex items-center gap-2 text-xs font-medium text-foreground">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
                {/* One string: a wrapped text chunk loses its leading space
                    in this JSX transform, and the flex gap was hiding "2new". */}
                {`${unread} new`}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">All caught up</p>
            )}
            {unread > 0 && (
              <button
                type="button"
                onClick={markRead}
                className="inline-flex min-h-11 cursor-pointer items-center rounded-lg px-2 text-[11px] font-medium uppercase tracking-widest text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-9"
              >
                Mark all read
              </button>
            )}
          </div>

          <ul className="divide-y divide-border">
            {visible.map((item) => {
              const fresh = isNew(item);
              return (
                <li key={item.id}>
                  <Link
                    href={item.url}
                    className="flex gap-3 px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <span
                      aria-hidden
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"
                    >
                      {iconFor(item.kind)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-start justify-between gap-3">
                        <span
                          className={cn(
                            "min-w-0 break-words text-sm leading-snug text-foreground",
                            fresh ? "font-semibold" : "font-medium"
                          )}
                        >
                          {fresh && <span className="sr-only">New: </span>}
                          {item.title}
                        </span>
                        <span className="mt-px flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[11px] text-muted-foreground">
                          {fresh && (
                            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
                          )}
                          <time dateTime={item.at} title={formatStoreDateTime(item.at)}>
                            <span className="sm:hidden">{agoShort(item.at)}</span>
                            <span className="hidden sm:inline">{ago(item.at)}</span>
                          </time>
                        </span>
                      </span>
                      {item.body && (
                        <span className="mt-0.5 line-clamp-2 block break-words text-xs leading-relaxed text-muted-foreground">
                          {item.body}
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>

          {canFold && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              aria-expanded={showAll}
              className="flex min-h-11 w-full cursor-pointer items-center justify-center border-t border-border text-[11px] font-medium uppercase tracking-widest text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              {showAll ? "Show fewer" : `Show ${folded} older`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

/** Three quiet placeholder rows — static on purpose; see "Motion" in CLAUDE.md. */
function FeedSkeleton() {
  return (
    <div role="status">
      <span className="sr-only">Loading notifications…</span>
      <ul aria-hidden className="divide-y divide-border">
        {[0, 1, 2].map((row) => (
          <li key={row} className="flex gap-3 px-4 py-3">
            <span className="h-8 w-8 shrink-0 rounded-lg bg-muted" />
            <span className="flex-1 space-y-2 pt-1">
              <span className="block h-3 w-2/3 rounded bg-muted" />
              <span className="block h-2.5 w-1/2 rounded bg-muted" />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Nothing to list. A failed first load says so rather than claiming the store
 * has been quiet — "Nothing yet" on a broken request is a small lie.
 */
function FeedEmpty({ failed }: { failed: boolean }) {
  return (
    <div className="px-6 py-12 text-center">
      <span className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-muted text-muted-foreground">
        <Bell className="h-5 w-5" aria-hidden />
      </span>
      <p className="mt-3 text-sm font-medium text-foreground">
        {failed ? "Couldn’t load notifications" : "Nothing yet"}
      </p>
      <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
        {failed
          ? "Trying again in a moment."
          : "New orders, messages and returns show up here as they happen."}
      </p>
    </div>
  );
}
