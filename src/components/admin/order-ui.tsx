"use client";

import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Clock,
  PackageCheck,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The shared furniture of Admin → Orders: one button, one badge, one labelled
 * block, one money line. Everything on the orders screen is built from these,
 * so the whole page shares a single spacing and colour scale instead of the
 * pill-here / square-there mix it grew into.
 *
 * Two rules baked in:
 *
 * 1. **Buttons are squared, uppercase and change colour only** — the house
 *    style (see CLAUDE.md). No lifts, no shines, no shadows.
 * 2. **44px tap targets on phones, 36px from `sm` up.** An ops tool is used
 *    on a phone between packing parcels; on a desktop the same control should
 *    not eat the row.
 */

/* ------------------------------------------------------------------ */
/*  Buttons                                                            */
/* ------------------------------------------------------------------ */

const BTN_BASE =
  "inline-flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-lg px-3 text-[11px] font-medium uppercase tracking-wider transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background sm:min-h-9";

const BTN_TONES = {
  /** The one obvious action in a block. */
  solid: "bg-foreground text-background hover:bg-foreground/85",
  /** Violet — reserved for anything that reaches the customer or the courier. */
  accent: "bg-accent text-accent-foreground hover:bg-accent/85",
  outline: "border border-border text-foreground hover:bg-muted",
  danger: "border border-danger/40 text-danger hover:bg-danger/10",
  ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
} as const;

export type BtnTone = keyof typeof BTN_TONES;

export function Btn({
  tone = "outline",
  className,
  type = "button",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { tone?: BtnTone }) {
  return (
    <button
      type={type}
      className={cn(BTN_BASE, BTN_TONES[tone], className)}
      {...rest}
    />
  );
}

/** An `<a>` that looks exactly like a `Btn` — used for WhatsApp / tracking. */
export function BtnLink({
  tone = "outline",
  className,
  ...rest
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { tone?: BtnTone }) {
  return <a className={cn(BTN_BASE, BTN_TONES[tone], className)} {...rest} />;
}

/* ------------------------------------------------------------------ */
/*  Badges                                                             */
/* ------------------------------------------------------------------ */

const BADGE_TONES = {
  neutral: "bg-muted text-muted-foreground",
  accent: "bg-accent/15 text-accent",
  success: "bg-success/15 text-success",
  danger: "bg-danger/15 text-danger",
  warn: "bg-orange-500/15 text-orange-600 dark:text-orange-400",
  info: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
} as const;

export type BadgeTone = keyof typeof BADGE_TONES;

export function Badge({
  tone = "neutral",
  title,
  className,
  children,
}: {
  tone?: BadgeTone;
  title?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider",
        BADGE_TONES[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Order status                                                       */
/* ------------------------------------------------------------------ */

/**
 * One status, one colour, one icon, one word.
 *
 * The icon is not decoration. Roughly one man in twelve cannot separate the
 * warn-orange of `pending` from the success-green of `delivered`, and this is
 * a screen people scan down a column of. Every status therefore carries a
 * distinct glyph *and* its label, so the colour is the third signal rather
 * than the only one.
 */
export const ORDER_STATUS_META: Record<
  string,
  { label: string; tone: BadgeTone; icon: LucideIcon }
> = {
  pending: { label: "Pending", tone: "warn", icon: Clock },
  confirmed: { label: "Confirmed", tone: "info", icon: CheckCircle2 },
  shipped: { label: "Shipped", tone: "accent", icon: Truck },
  delivered: { label: "Delivered", tone: "success", icon: PackageCheck },
  cancelled: { label: "Cancelled", tone: "danger", icon: AlertTriangle },
  payment_failed: { label: "Payment failed", tone: "danger", icon: AlertTriangle },
};

export function statusMeta(status: string) {
  return (
    ORDER_STATUS_META[status] ?? {
      label: status.replace(/_/g, " "),
      tone: "neutral" as BadgeTone,
      icon: CircleDashed,
    }
  );
}

export function StatusPill({
  status,
  title,
  className,
}: {
  status: string;
  title?: string;
  className?: string;
}) {
  const meta = statusMeta(status);
  const Icon = meta.icon;
  return (
    <Badge tone={meta.tone} title={title} className={className}>
      <Icon className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
      {meta.label}
    </Badge>
  );
}

/* ------------------------------------------------------------------ */
/*  Labelled block                                                     */
/* ------------------------------------------------------------------ */

/**
 * One titled section of an order. `self-start` matters: the detail is a grid,
 * and without it a short block stretches to the height of the tall one beside
 * it, which is what made the old layout look so airy.
 */
export function Block({
  title,
  icon,
  aside,
  className,
  bodyClassName,
  children,
}: {
  title: string;
  /**
   * A rendered element (`<Package />`), NOT a component reference.
   *
   * This file is `"use client"`. Passing `icon={Package}` from a *server*
   * component crosses the RSC boundary with a function — lucide icons are
   * `forwardRef` objects — and React refuses:
   *
   *   "Functions cannot be passed directly to Client Components…
   *    {$$typeof: ..., render: function, displayName: ...}"
   *
   * That took out /admin/customers/[id] in production. It only showed up
   * there because every other caller happens to be a client component, where
   * the same prop is legal. An element serialises fine from either side, so
   * this shape cannot reintroduce the bug.
   */
  icon: React.ReactNode;
  /** Right-aligned extras in the header — a badge, a count, an InfoTip. */
  aside?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "min-w-0 self-start overflow-hidden rounded-lg border border-border bg-card",
        className
      )}
    >
      <header className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-2">
        <span
          aria-hidden="true"
          className="grid h-3.5 w-3.5 shrink-0 place-items-center text-muted-foreground [&>svg]:h-3.5 [&>svg]:w-3.5"
        >
          {icon}
        </span>
        <h3 className="eyebrow truncate">{title}</h3>
        {aside ? (
          <span className="ml-auto flex shrink-0 items-center gap-1.5">{aside}</span>
        ) : null}
      </header>
      <div className={cn("p-3", bodyClassName)}>{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Rows                                                               */
/* ------------------------------------------------------------------ */

/** A label/value line — money totals, payment facts. */
export function Line({
  label,
  value,
  tone = "muted",
  strong,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  tone?: "muted" | "success" | "accent" | "foreground";
  strong?: boolean;
}) {
  const valueTone =
    tone === "success"
      ? "text-success"
      : tone === "accent"
        ? "text-accent"
        : "text-foreground";
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className={tone === "muted" ? "text-muted-foreground" : valueTone}>
        {label}
      </span>
      <span
        className={cn("shrink-0 tabular-nums", valueTone, strong && "font-medium")}
      >
        {value}
      </span>
    </div>
  );
}

/** A form control with a small uppercase label above it. */
export function LabelledField({
  label,
  hint,
  className,
  children,
}: {
  label: React.ReactNode;
  /** Sits next to the label — an InfoTip rather than a paragraph. */
  hint?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("block min-w-0", className)}>
      <span className="mb-1 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
        {hint}
      </span>
      {children}
    </label>
  );
}
