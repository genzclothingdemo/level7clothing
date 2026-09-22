"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A single collapsible row: a label on the left, a one-glance summary on the
 * right, and the detail underneath once it is opened.
 *
 * This is the second level of disclosure on an order. The first level is the
 * order card itself; inside it, everything a customer *sometimes* wants —
 * payment, address, reference ids — is one of these, so an expanded order is a
 * short list of 44px rows rather than a wall of facts. The summary on the right
 * is what makes that work: "COD · ₹10 due" answers the question without the row
 * ever being opened.
 *
 * Two rules it inherits from the rest of this repo:
 *
 * 1. **The panel is conditionally rendered, never hidden with a transform.**
 *    See the "Modal pattern" note in CLAUDE.md — an element parked with
 *    `translate` relies on the animation finishing to be out of the way.
 * 2. **44px minimum.** These are stacked, so a short row is a mis-tap.
 */
export function Disclosure({
  label,
  icon,
  summary,
  defaultOpen = false,
  children,
  className,
}: {
  label: string;
  /**
   * An already-rendered element (`<Hash className="h-3.5 w-3.5" />`), never the
   * component itself. A server page renders these too, and a component passed
   * as a prop across that boundary fails at runtime with "Functions cannot be
   * passed directly to Client Components" — a rendered node serialises fine.
   */
  icon?: React.ReactNode;
  /** Right-aligned one-liner, readable while closed. */
  summary?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();

  return (
    <div className={cn("min-w-0", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={id}
        className={cn(
          "flex min-h-11 w-full cursor-pointer items-center gap-2 py-2 text-left",
          "rounded-lg transition-colors hover:bg-muted/50",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        )}
      >
        {icon && (
          <span aria-hidden className="shrink-0 text-muted-foreground">
            {icon}
          </span>
        )}
        <span className="shrink-0 text-xs font-medium">{label}</span>
        {summary != null && (
          <span className="ml-auto min-w-0 truncate text-right text-[11px] text-muted-foreground">
            {summary}
          </span>
        )}
        <ChevronDown
          aria-hidden
          className={cn(
            "ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none",
            summary != null && "ml-1.5",
            open && "rotate-180"
          )}
        />
      </button>

      {/* Mounted only while open. Opacity only on the way in — nothing about
          this element's resting position depends on an animation finishing. */}
      {open && (
        <div
          id={id}
          className="animate-[fadeIn_0.15s_ease-out_both] pb-3 motion-reduce:animate-none"
        >
          {children}
        </div>
      )}
    </div>
  );
}
