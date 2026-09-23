"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { AdminThreadDTO } from "@/lib/chat";

/**
 * "Somebody is waiting" — visible from every admin screen, not just the inbox.
 *
 * A customer message used to be discoverable in exactly two places: the
 * dashboard's work queue, and the Inquiries screen itself. Both require already
 * being there. An operator working through Orders for twenty minutes had no way
 * to know a shopper had asked a question, which is the whole point of a chat
 * that is meant to be answered.
 *
 * ## Why this polls, and why it is not a second loop
 *
 * Chat is polled rather than socketed because this app is serverless
 * (CLAUDE.md). `chat-inbox.tsx` already runs two loops — a thread list and an
 * open conversation — but both are mounted by `/admin/messages` and both die
 * when you leave it. This one covers the other twenty screens, and the two are
 * **mutually exclusive by construction**: `paused` is true exactly while the
 * inbox is on screen, and a paused hook holds no timer. There is never more
 * than one thread-list poll in flight.
 *
 * It also reuses the inbox's own endpoint (`GET /api/chat/admin` with no
 * `threadId`) rather than adding one. That call is deliberately **read-only** —
 * it never passes `seen=1`, so a badge can never mark its own subject read.
 *
 * ## The count is honest, and this is the part worth keeping
 *
 * An indicator that lights up and never clears is worse than none, so there is
 * exactly one rule: **this hook reports `adminUnread` as the database holds it,
 * and never writes it.** `adminUnread` drops to zero in two places, both in
 * `lib/chat.ts`: `markSeen(threadId, "user")` when an admin actually opens that
 * conversation, and inside `createChatMessage` when an admin replies to it
 * (replying is reading). Nothing else clears it — not loading the inbox list,
 * not looking at this badge.
 *
 * So while the inbox is open the badge is **hidden rather than frozen**. The
 * alternative was showing a stale "3" in the sidebar next to a list that had
 * already dropped to 0, which is exactly the dishonesty this is meant to avoid.
 * Leaving `/admin/messages` unpauses the hook, which ticks immediately.
 */

/**
 * Slower than the inbox's 10s, on purpose. This is an ambient "is anyone
 * waiting", not a conversation — and it is paid for on every admin screen,
 * where the inbox's cadence is paid for only while somebody is reading.
 */
const POLL_VISIBLE_MS = 30_000;

/**
 * Unread messages waiting for a reply, or 0 while paused.
 *
 * A hidden tab stops polling altogether rather than backing off: an admin panel
 * in a background tab has nobody looking at the badge, and the visibility
 * listener fires an immediate catch-up the moment it comes back. That is
 * strictly better than a slow poll nobody reads.
 */
export function useAdminChatUnread(paused: boolean): number {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (paused) {
      // Not merely "stop polling": drop the number too. The inbox is the
      // authority while it is mounted, and a second copy of a count that is
      // about to change is how a stale badge is born.
      setUnread(0);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const res = await fetch("/api/chat/admin", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { threads?: AdminThreadDTO[] };
        if (cancelled) return;
        setUnread(
          (data.threads ?? []).reduce((n, t) => n + (t.adminUnread || 0), 0)
        );
      } catch {
        // A failed poll leaves the last known count alone. Zeroing on a network
        // blip would say "nobody is waiting", which is a worse lie than a
        // number that is thirty seconds old.
        if (cancelled) return;
      }
      if (cancelled) return;
      if (document.visibilityState === "visible") {
        timer = setTimeout(tick, POLL_VISIBLE_MS);
      }
    };

    const onVisibility = () => {
      if (document.visibilityState !== "visible") {
        if (timer) clearTimeout(timer);
        timer = null;
        return;
      }
      if (timer) clearTimeout(timer);
      void tick();
    };

    if (document.visibilityState === "visible") void tick();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [paused]);

  return unread;
}

/**
 * The count beside a sidebar entry.
 *
 * Violet fill rather than a bare dot, because the number is the useful part —
 * "someone is waiting" and "eleven people are waiting" are different mornings.
 * Capped at 9+ so a busy inbox cannot widen the nav item and reflow the label.
 *
 * `aria-label` carries the sentence; the digit alone would be read out as a
 * number with no noun attached.
 */
export function NavAttention({
  count,
  what,
  className,
}: {
  count: number;
  /** Plural noun for the screen reader: "unread messages". */
  what: string;
  className?: string;
}) {
  if (count <= 0) return null;
  return (
    <span
      role="status"
      aria-label={`${count} ${what}`}
      className={cn(
        "ml-auto grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-accent px-1.5",
        "text-[10px] font-semibold leading-none tabular-nums text-accent-foreground",
        className
      )}
    >
      {count > 9 ? "9+" : count}
    </span>
  );
}
