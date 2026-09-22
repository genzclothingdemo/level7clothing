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
  type CustomerRecord,
  type CustomerSignal,
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
  className,
}: {
  status: CustomerStatus;
  /** Only the detail page explains it; a list of 40 tips is noise. */
  withTip?: boolean;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)}>
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

/** "a, b and c" — a sentence, not a machine-readable join. */
function sentenceList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/**
 * The merge, behind an "(i)".
 *
 * This used to be a line of prose under every name — "Account + 4 account
 * orders + 1 cart lead + 1 chat + 1 return" — which made the longest string on
 * the row the one answering the question nobody asks first. It is still the
 * most important thing to be able to check (a record that quietly absorbed a
 * guest order looks like it lost one), so it moves behind a tap rather than
 * going away, and it now says *why* the sources folded together rather than
 * only that they did.
 *
 * Rendered only when there is more than one source. A record built from one
 * table has nothing to explain, and 40 rows of "(i) Account" is noise.
 */
export function MergeTip({
  customer,
  className,
}: {
  customer: CustomerRecord;
  className?: string;
}) {
  const parts = customer.sourceParts;
  if (parts.length < 2) return null;

  const linkedBy = [...customer.emails, ...customer.phones];

  return (
    <InfoTip term="One person, several records" className={className}>
      Built from {sentenceList(parts)}.
      {linkedBy.length > 0 && (
        <>
          {" "}
          They were folded together because they share{" "}
          {linkedBy.length === 1 ? "this contact detail" : "these contact details"}:{" "}
          <b>{linkedBy.join(", ")}</b>.
        </>
      )}{" "}
      Matching is on lowercased email first and phone number second. Two
      registered accounts are never merged, even when they share a number.
    </InfoTip>
  );
}

/**
 * The same facts as a plain string, for a `title` attribute — used where a
 * second tap target would be in the way.
 */
export function sourceSummary(customer: CustomerRecord): string {
  return customer.sourceParts.length
    ? `Built from ${sentenceList(customer.sourceParts)}`
    : "";
}

/* ------------------------------------------------------------------ */
/*  Signals                                                            */
/* ------------------------------------------------------------------ */

/**
 * The things that want doing, as badges.
 *
 * `linked` is off in the customer list, where the row is already one big link
 * to the person and five more destinations per row would fight it, and on
 * wherever the reader is meant to act — the detail page's strip.
 */
export function SignalBadges({
  signals,
  linked = false,
  className,
}: {
  signals: CustomerSignal[];
  linked?: boolean;
  className?: string;
}) {
  if (signals.length === 0) return null;

  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {signals.map((s) =>
        linked ? (
          <Link
            key={s.kind}
            href={s.href}
            title={s.help}
            className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Badge tone={s.tone} className="hover:brightness-95">
              {s.label}
            </Badge>
          </Link>
        ) : (
          <Badge key={s.kind} tone={s.tone} title={s.help}>
            {s.label}
          </Badge>
        )
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
      {/*
        The label wraps rather than truncating. At 320px a two-column tile row
        leaves about 90px for it, which turned "Still to collect" into "STILL
        TO …" — a label nobody can read is worse than a tile one line taller,
        and grid items stretch so the row stays level either way.
      */}
      <div className="flex items-start gap-0.5">
        <span className="eyebrow min-w-0 break-words">{label}</span>
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
        <p className="mt-0.5 break-words text-xs text-muted-foreground">{sub}</p>
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
        // Vertical padding on an *inline* element grows the hit box without
        // touching the line height, so a 14px reference in a dense ledger row
        // becomes something a thumb can land on and nothing moves. `display`
        // is deliberately left alone: `inline-block` would stop a long product
        // name wrapping mid-link, which overflows at 320px.
        "py-1.5",
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
