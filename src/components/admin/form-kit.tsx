"use client";

/**
 * form-kit — the shared layout primitives for the admin product editor.
 *
 * Exists because the editor had drifted into four different card paddings,
 * three control heights and a helper paragraph under every field. Everything
 * here is built on one scale so the page reads as a rhythm rather than a pile:
 *
 *   card padding      p-4 sm:p-5
 *   block padding     p-3
 *   vertical rhythm   space-y-4 inside a card, space-y-3 inside a block
 *   control height    h-11 (44px, the tap-target floor) — h-11 sm:h-9 in tables
 *
 * Explanation lives in an `InfoTip` next to the label, never in a paragraph
 * under the field. The tip component is the storefront one on purpose: it is
 * already portalled (so it escapes `overflow-hidden` accordions), tap-driven,
 * Escape-closing and accessible. There must not be a second one.
 */

import { useEffect, useId, useRef } from "react";
import { InfoTip } from "@/components/store/info-tip";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  Card                                                               */
/* ------------------------------------------------------------------ */

export function Card({
  title,
  tip,
  aside,
  children,
  className,
}: {
  title: string;
  /** Short explanation shown behind an (i) beside the title. */
  tip?: React.ReactNode;
  /** Control pinned to the right of the title row (a switch, a count…). */
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        // `min-w-0` because a card is usually a grid item, and a grid item's
        // automatic minimum size is its content — one long word or a wide table
        // would otherwise widen the column and take the page with it at 320px.
        "min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-5",
        className
      )}
    >
      <div className="mb-4 flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 className="flex items-center gap-1 font-serif text-lg leading-none">
          {title}
          {tip && <InfoTip term={title}>{tip}</InfoTip>}
        </h2>
        {aside}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Field                                                              */
/* ------------------------------------------------------------------ */

/**
 * Label + control. `hint` is for a value the admin cannot work out for
 * themselves (a computed price, a count) — anything explanatory belongs in
 * `tip` instead, which is why it is deliberately awkward to write a paragraph
 * here.
 */
export function Field({
  label,
  tip,
  hint,
  required,
  children,
  className,
}: {
  label: string;
  tip?: React.ReactNode;
  hint?: React.ReactNode;
  required?: boolean;
  /**
   * Either the control, or a function receiving the generated id. Take the
   * function form for a single input/select/textarea so the label actually
   * names it: the `(i)` button cannot live inside a `<label>` without its own
   * accessible name ("What Price means") being folded into the input's.
   */
  children: React.ReactNode | ((id: string) => React.ReactNode);
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn("min-w-0", className)}>
      <div className="label flex items-center gap-1">
        <label htmlFor={id} className="cursor-pointer">
          {label}
          {required && <span className="text-danger"> *</span>}
        </label>
        {tip && <InfoTip term={label}>{tip}</InfoTip>}
      </div>
      {typeof children === "function" ? children(id) : children}
      {hint && (
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Switch                                                             */
/* ------------------------------------------------------------------ */

/**
 * A real `role="switch"` button, 44px tall so a thumb can hit it. Used for
 * every on/off decision in the editor, including "Use store default" — the
 * whole point of requirement 3 is that inheriting is a visible *state*, not
 * the absence of typing.
 */
export function SwitchRow({
  label,
  tip,
  checked,
  onChange,
  icon,
  detail,
  className,
  tone = "card",
}: {
  label: string;
  tip?: React.ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  icon?: React.ReactNode;
  /** One short line under the label — a state readout, not an explanation. */
  detail?: React.ReactNode;
  className?: string;
  /** "card" draws a bordered row; "bare" sits inside something that already has one. */
  tone?: "card" | "bare";
}) {
  return (
    <div
      className={cn(
        "flex min-h-11 w-full items-center gap-1",
        tone === "card" && "rounded-lg border border-border px-2.5",
        className
      )}
    >
      {/*
        The label IS the switch — a full-height, full-width button — so the tap
        target is the row rather than a 20px dot at the end of it. The track to
        its right is decoration: same handler, out of the tab order, hidden from
        assistive tech so the one control is announced once.
      */}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-sm py-1.5 text-left",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        )}
      >
        {icon}
        <span className="min-w-0">
          <span className="block text-sm font-medium">{label}</span>
          {detail && (
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {detail}
            </span>
          )}
        </span>
      </button>

      {tip && <InfoTip term={label}>{tip}</InfoTip>}

      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={() => onChange(!checked)}
        className="grid h-11 w-12 shrink-0 cursor-pointer place-items-center"
      >
        <span
          className={cn(
            "relative block h-6 w-11 rounded-full transition-colors",
            checked ? "bg-accent" : "bg-muted-foreground/30"
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform duration-200 motion-reduce:transition-none",
              checked && "translate-x-5"
            )}
          />
        </span>
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Segmented choice                                                   */
/* ------------------------------------------------------------------ */

/** Two or three mutually exclusive answers, squared per the design system. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        // Always full width: every use sits in a narrow column, and an
        // `inline-flex` sized to its content is exactly what overflows there.
        "flex min-h-11 w-full min-w-0 flex-wrap items-stretch gap-1 rounded-lg border border-border bg-muted/40 p-1",
        className
      )}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "min-h-9 flex-1 basis-20 cursor-pointer rounded-md px-2 text-[11px] font-medium uppercase tracking-widest transition-colors",
              on
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Checkbox                                                           */
/* ------------------------------------------------------------------ */

/**
 * A 16px checkbox inside a 44px hit area. `indeterminate` is a DOM property,
 * not an attribute, so it can only be set through a ref.
 */
export function Check({
  checked,
  indeterminate = false,
  onChange,
  label,
  disabled,
  className,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (v: boolean) => void;
  /** Accessible name — visually hidden; the row's content is the visible label. */
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !checked;
  }, [indeterminate, checked]);

  return (
    <span
      className={cn(
        "grid h-11 w-11 shrink-0 place-items-center",
        disabled && "opacity-40",
        className
      )}
    >
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 cursor-pointer accent-[var(--accent)] disabled:cursor-not-allowed"
      />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Table scroller                                                     */
/* ------------------------------------------------------------------ */

/**
 * Wraps a table so it scrolls inside its own box instead of pushing the page
 * sideways. `overscroll-x-contain` stops the scroll chaining out to the page
 * (and to the browser's back gesture) once the table hits its end.
 */
export function TableScroll({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "w-full max-w-full overflow-x-auto overscroll-x-contain rounded-lg border border-border",
        className
      )}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Toolbar chrome                                                     */
/* ------------------------------------------------------------------ */

/** A compact single-row bar — filters, bulk edit, counts. */
export function Toolbar({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-2.5 py-2",
        className
      )}
    >
      {children}
    </div>
  );
}

/** Squared, uppercase, colour-change-only — the editor's small action button. */
export function MiniButton({
  children,
  className,
  active,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-[11px] font-medium uppercase tracking-widest transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        "disabled:cursor-not-allowed disabled:opacity-40",
        active
          ? "border-accent bg-accent/10 text-accent"
          : "border-border bg-card text-foreground hover:bg-muted",
        className
      )}
    >
      {children}
    </button>
  );
}

/** Small count pill used on the Filters button and section headers. */
export function CountBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-foreground">
      {children}
    </span>
  );
}
