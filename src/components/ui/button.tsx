import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

type Variant = "primary" | "outline" | "ghost" | "gold" | "danger";
type Size = "sm" | "md" | "lg" | "icon";

const variants: Record<Variant, string> = {
  primary:
    "bg-primary text-primary-foreground border border-primary hover:bg-primary/85",
  outline:
    "bg-transparent text-foreground border border-border hover:border-foreground",
  ghost: "bg-transparent text-foreground hover:bg-muted border border-transparent",
  // `gold` is the legacy name for the brand-accent fill.
  gold: "bg-accent text-accent-foreground border border-accent hover:bg-accent/85",
  danger:
    "bg-transparent text-danger border border-danger/40 hover:bg-danger/10",
};

const sizes: Record<Size, string> = {
  sm: "h-9 px-4 text-[13px]",
  md: "h-11 px-6 text-sm",
  lg: "h-[52px] px-8 text-sm",
  icon: "h-10 w-10",
};

// Squared-off, wide-tracked and uppercase — the retail button language of
// editorial fashion. No lift, no shine: state change only via colour.
const base =
  "inline-flex items-center justify-center gap-2 rounded-lg font-medium uppercase tracking-[0.08em] transition-colors duration-200 disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background cursor-pointer";

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

export function Button({
  className,
  variant = "primary",
  size = "md",
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(base, variants[variant], sizes[size], className)}
      {...props}
    />
  );
}

type ButtonLinkProps = React.ComponentProps<typeof Link> & {
  variant?: Variant;
  size?: Size;
};

export function ButtonLink({
  className,
  variant = "primary",
  size = "md",
  ...props
}: ButtonLinkProps) {
  return (
    <Link
      className={cn(base, variants[variant], sizes[size], className)}
      {...props}
    />
  );
}
