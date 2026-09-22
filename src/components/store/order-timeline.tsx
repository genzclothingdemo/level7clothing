"use client";

import { MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { Disclosure } from "./disclosure";
import {
  FALLBACK_STATUS_ICON,
  ORDER_FLOW,
  ORDER_STATUS_ICON,
  isOffFlow,
  orderStageIndex,
  orderStatusLabel,
  orderStatusPill,
  stampFor,
  type TrailEntry,
} from "./order-status";

export type { StatusEntry, TrailEntry } from "./order-status";

/**
 * Where an order has got to — in about 90px.
 *
 * ## Why this replaced a vertical timeline
 *
 * The previous version drew four 36px dots stacked vertically with 24px of
 * padding between them, a timestamp under each, and a note panel at the bottom.
 * On a phone that is the entire screen for one order, which is how the account
 * page ended up showing tracking and nothing else. A customer opening an order
 * wants one fact first — *where is it* — and the other three steps only as
 * context for that one.
 *
 * So: a horizontal stepper (the context, at a glance), one line naming the
 * current status and when it happened (the answer), and the dated history
 * behind a disclosure (the audit trail, for the one person in fifty who wants
 * it). Same four steps as before, a fifth of the height.
 *
 * ## What it does not do
 *
 * It does not format dates. `trail` arrives pre-formatted from the server —
 * `buildOrderTimeline` in `order-status.ts` — because `toLocaleString()` in a
 * client component reads the renderer's timezone and mismatches on hydration.
 *
 * It does not render notes. `statusHistory` mixes internal courier/NimbusPost
 * chatter in with the admin's customer-facing messages, and only the latter
 * are safe to show; those come out of `buildStoreMessages` and are rendered
 * once, loudly, by `StoreMessages` — not scattered through this list.
 */
export function OrderTimeline({
  status,
  trail,
  deliveryStatus,
  deliveryLocation,
  className,
}: {
  status: string;
  /** Pre-built, pre-formatted journey. See `buildOrderTimeline`. */
  trail: TrailEntry[];
  /** Live courier status from NimbusPost, e.g. "In Transit". */
  deliveryStatus?: string | null;
  /** Where the parcel was last scanned. */
  deliveryLocation?: string | null;
  className?: string;
}) {
  const activeIndex = Math.max(0, orderStageIndex(status));
  const offFlow = isOffFlow(status);
  const Icon = ORDER_STATUS_ICON[status] ?? FALLBACK_STATUS_ICON;
  const currentStamp = stampFor(trail, status);

  return (
    <div className={cn("min-w-0", className)}>
      {offFlow ? (
        /* Cancelled / payment failed: the stepper would be a lie, so it is
           replaced rather than drawn with a dead dot hanging off the end. */
        <p
          className={cn(
            "flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2.5 text-xs"
          )}
        >
          <Icon aria-hidden className="h-4 w-4 shrink-0 text-danger" />
          <span className="font-medium text-danger">
            {orderStatusLabel(status)}
          </span>
          {currentStamp && (
            <span className="text-muted-foreground">{currentStamp}</span>
          )}
        </p>
      ) : (
        <>
          {/* ── The four steps ── */}
          <ol className="flex items-start">
            {ORDER_FLOW.map((step, i) => {
              const done = i <= activeIndex;
              const isCurrent = i === activeIndex;
              const StepIcon = step.icon;
              return (
                <li
                  key={step.key}
                  className="relative flex min-w-0 flex-1 flex-col items-center"
                >
                  {/* Rail back to the previous dot: `right-1/2 w-full` spans
                      exactly one column, so it lands on the other centre
                      whatever the container width is. */}
                  {i > 0 && (
                    <span
                      aria-hidden
                      className={cn(
                        "absolute right-1/2 top-3 z-0 h-0.5 w-full -translate-y-1/2",
                        done ? "bg-accent" : "bg-border"
                      )}
                    />
                  )}
                  <span
                    className={cn(
                      "relative z-10 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 bg-card",
                      done
                        ? "border-accent bg-accent text-accent-foreground"
                        : "border-border text-muted-foreground",
                      isCurrent && "ring-2 ring-accent/25"
                    )}
                  >
                    <StepIcon aria-hidden className="h-3 w-3" />
                  </span>
                  <span
                    className={cn(
                      "mt-1.5 px-0.5 text-center text-[10px] leading-tight",
                      done ? "text-foreground" : "text-muted-foreground"
                    )}
                  >
                    {step.label}
                  </span>
                  {isCurrent && <span className="sr-only">(current)</span>}
                </li>
              );
            })}
          </ol>

          {/* ── The one line that answers "where is it?" ── */}
          <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium",
                orderStatusPill(status)
              )}
            >
              <Icon aria-hidden className="h-3 w-3" />
              {orderStatusLabel(status)}
            </span>
            {currentStamp && (
              <span className="text-muted-foreground">{currentStamp}</span>
            )}
            {deliveryStatus && (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground/80">
                {deliveryStatus}
              </span>
            )}
            {deliveryLocation && (
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <MapPin aria-hidden className="h-3 w-3" />
                {deliveryLocation}
              </span>
            )}
          </p>
        </>
      )}

      {/* ── The full trail, for whoever wants the dates ── */}
      {trail.length > 0 && (
        <Disclosure
          label="View updates"
          summary={`${trail.length} update${trail.length === 1 ? "" : "s"}`}
        >
          <ol className="space-y-1.5">
            {trail.map((entry) => {
              const EntryIcon =
                ORDER_STATUS_ICON[entry.status] ?? FALLBACK_STATUS_ICON;
              return (
                <li
                  key={`${entry.status}-${entry.at}`}
                  className="flex items-start gap-2 text-[11px]"
                >
                  <EntryIcon
                    aria-hidden
                    className={cn(
                      "mt-0.5 h-3 w-3 shrink-0",
                      entry.status === status ? "text-accent" : "text-muted-foreground"
                    )}
                  />
                  <span className="min-w-0 font-medium">{entry.label}</span>
                  {entry.at && (
                    <span className="ml-auto shrink-0 text-right text-muted-foreground">
                      {entry.at}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </Disclosure>
      )}
    </div>
  );
}
