"use client";

import { useLinkStatus } from "next/link";
import { Loader2 } from "lucide-react";

/**
 * Pending indicator for the enclosing <Link>. Must be rendered as a descendant
 * of the Link it reports on — `useLinkStatus` reads that Link's transition state.
 *
 * The `.link-pending` class starts at opacity 0 and fades in after ~150ms, so a
 * fast navigation never flashes an indicator; only a genuinely slow one does.
 * This is what stops people clicking a product tile repeatedly: the tile they
 * clicked visibly acknowledges the click straight away.
 */
export function LinkPendingOverlay() {
  const { pending } = useLinkStatus();
  if (!pending) return null;

  return (
    <span
      aria-hidden
      className="link-pending absolute inset-0 z-20 grid place-items-center bg-background/55 backdrop-blur-[1px]"
    >
      <Loader2 className="h-5 w-5 animate-spin text-foreground/70" />
    </span>
  );
}

/** Inline variant for text links (nav, breadcrumbs) — a small trailing spinner. */
export function LinkPendingDot() {
  const { pending } = useLinkStatus();
  if (!pending) return null;

  return (
    <Loader2
      aria-hidden
      className="link-pending ml-1.5 inline-block h-3 w-3 animate-spin align-middle"
    />
  );
}
