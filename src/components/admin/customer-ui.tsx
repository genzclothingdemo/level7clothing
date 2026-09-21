/**
 * The small shared furniture of Admin → Customers.
 *
 * Server components on purpose — nothing here is interactive, so nothing here
 * needs to ship to the browser. The pieces that *are* interactive (the info
 * tips, the filter bar) are their own client components.
 *
 * Everything is built out of the existing kit: `Badge`/`Line` from `order-ui`,
 * `InfoTip` from the storefront. There is no second badge and no second tip.
 */

import Link from "next/link";
import { Badge } from "@/components/admin/order-ui";
import { InfoTip } from "@/components/store/info-tip";
import { cn } from "@/lib/utils";
import {
  CUSTOMER_STATUS_HELP,
  CUSTOMER_STATUS_LABEL,
  CUSTOMER_STATUS_TONE,
  type CustomerStatus,
} from "@/lib/customers";

/* ------------------------------------------------------------------ */
/*  Dates                                                              */
/* ------------------------------------------------------------------ */

/**
 * Asia/Kolkata is pinned rather than left to the runtime. Vercel's functions
 * run with TZ=UTC whatever region they sit in, so an order placed at 01:00 IST
 * would otherwise be filed under the previous day on production and the right
 * day on the dev machine. These strings are only ever produced on the server,
 * so there is no client formatter to disagree with.
 */
const DAY_FMT = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Kolkata",
});

const DAY_TIME_FMT = new Intl.DateTimeFormat("en-IN", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Kolkata",
});

export const formatDay = (d: Date) => DAY_FMT.format(d);
export const formatDayTime = (d: Date) => DAY_TIME_FMT.format(d);

/** "3 days ago" — relative, for the one column where recency is the point. */
export function formatAgo(d: Date, now: number): string {
  const seconds = Math.max(0, Math.round((now - d.getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.round(days / 30.44);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.round(months / 12);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

/* ------------------------------------------------------------------ */
/*  Status                                                             */
/* ------------------------------------------------------------------ */

export function CustomerStatusBadge({
  status,
  withTip = false,
}: {
  status: CustomerStatus;
  /** Only the detail page explains it; a list of 40 tips is noise. */
  withTip?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-0.5">
      <Badge tone={CUSTOMER_STATUS_TONE[status]} title={CUSTOMER_STATUS_HELP[status]}>
        {CUSTOMER_STATUS_LABEL[status]}
      </Badge>
      {withTip && (
        <InfoTip term={CUSTOMER_STATUS_LABEL[status]}>
          {CUSTOMER_STATUS_HELP[status]} Worked out from the records themselves
          every time this page loads — there is no status column to fall out of
          date.
        </InfoTip>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Provenance                                                         */
/* ------------------------------------------------------------------ */

/**
 * Which tables fed this record — "Account + 2 guest orders".
 *
 * This is the merge, made visible. Without it a record that quietly absorbed a
 * guest order looks like it lost one, and nobody can tell whether the person
 * they are looking at is one shopper or two that were welded together.
 */
export function SourceLine({
  parts,
  className,
  withTip = false,
}: {
  parts: string[];
  className?: string;
  withTip?: boolean;
}) {
  if (parts.length === 0) return null;
  return (
    <span
      className={cn("inline-flex min-w-0 items-center gap-0.5", className)}
      title={parts.join(" + ")}
    >
      <span className="truncate">{parts.join(" + ")}</span>
      {withTip && (
        <InfoTip term="Sources">
          A customer here is a person, not a row. Records are matched on
          lowercased email, falling back to phone number, and anything sharing a
          contact detail is folded into one record — so a guest order and the
          account opened later are the same shopper. Two registered accounts are
          never merged, even if they share a phone.
        </InfoTip>
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Stat tile                                                          */
/* ------------------------------------------------------------------ */

/** One number with its name. Used for the analytics row on the detail page. */
export function Stat({
  label,
  value,
  sub,
  tip,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tip?: React.ReactNode;
  tone?: "default" | "accent" | "success" | "danger";
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-0.5">
        <span className="eyebrow truncate">{label}</span>
        {tip && <InfoTip term={label}>{tip}</InfoTip>}
      </div>
      <p
        className={cn(
          "mt-1.5 truncate text-lg font-medium tabular-nums",
          tone === "accent" && "text-accent",
          tone === "success" && "text-success",
          tone === "danger" && "text-danger"
        )}
      >
        {value}
      </p>
      {sub && (
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Links                                                              */
/* ------------------------------------------------------------------ */

/**
 * An internal admin link. Every reference on these pages goes through it, so
 * "no dead ends" is enforced by the type: there is no variant that renders a
 * reference without somewhere to go.
 */
export function AdminRef({
  href,
  children,
  className,
  title,
  mono = false,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
  title?: string;
  mono?: boolean;
}) {
  return (
    <Link
      href={href}
      title={title}
      className={cn(
        "rounded-sm underline decoration-border underline-offset-2 transition-colors hover:text-accent hover:decoration-accent",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        mono && "font-mono",
        className
      )}
    >
      {children}
    </Link>
  );
}

/** A reference whose target no longer exists — stated, never linked. */
export function DeadRef({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="text-muted-foreground line-through decoration-muted-foreground/50"
      title="This product has been deleted from the catalogue"
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Empty state                                                        */
/* ------------------------------------------------------------------ */

export function Nothing({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}
