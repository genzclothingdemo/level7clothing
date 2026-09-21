"use client";

/**
 * settings-ui — the shape of Admin → Settings, and the pieces every section
 * is built from.
 *
 * Three ideas hold this screen together:
 *
 * 1. **One draft, many tabs.** `SettingsDraft` is the whole editable surface
 *    as flat strings and booleans. The tab only decides what is on screen; it
 *    never decides what gets saved. That is what stops the old failure mode
 *    where a section you never opened is written back with a stale value.
 * 2. **One registry.** `FIELD_META` gives every field a human label and a home
 *    tab, so the dirty count per tab, the "what will be written" list in the
 *    save bar and the section headings all derive from the same table instead
 *    of drifting apart.
 * 3. **One writer per column.** Anything owned by another screen is rendered
 *    through `ManagedElsewhere` — current value, read-only, with a link. Two
 *    editors for one column is how they drift.
 *
 * Explanation lives in an `InfoTip` or behind `ExpandableText`, never in a
 * paragraph under a field — same rule as `form-kit`.
 */

import Link from "next/link";
import { ArrowUpRight, Loader2, RotateCcw } from "lucide-react";
import { InfoTip } from "@/components/store/info-tip";
import { Btn } from "@/components/admin/order-ui";
import { Field } from "@/components/admin/form-kit";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  The editable surface                                               */
/* ------------------------------------------------------------------ */

/**
 * Every column Admin → Settings writes, and nothing else.
 *
 * Nullable columns are held as `""` rather than `null` so a comparison against
 * the baseline is exact — `null` vs `""` would report a phantom change on
 * every load, and a phantom change makes the dirty indicator useless.
 * `freeShippingThreshold` is a string for the same reason: an empty number
 * input is `""`, not `0`.
 */
export type SettingsDraft = {
  brandName: string;
  tagline: string;
  logoUrl: string;
  announcement: string;
  heroHeadline: string;
  heroSubtext: string;
  aboutText: string;
  contactEmail: string;
  contactPhone: string;
  whatsapp: string;
  address: string;
  instagram: string;
  facebook: string;
  adminNotifyEmail: string;
  freeShippingThreshold: string;
  codEnabled: boolean;
  prepaidEnabled: boolean;
  partialEnabled: boolean;
  directEnabled: boolean;
  razorpayEnabled: boolean;
  nimbusEnabled: boolean;
  defaultMaterialsCare: string;
  defaultShippingInfo: string;
};

export type DraftKey = keyof SettingsDraft;

/* ------------------------------------------------------------------ */
/*  Tabs                                                               */
/* ------------------------------------------------------------------ */

/**
 * Grouped by the job being done, not by the order of the columns in the
 * schema. "Change the phone number", "turn COD off for a week" and "rewrite
 * the hero" are three different errands and should not be three scroll
 * positions in one form.
 */
export const TABS = [
  { key: "brand", label: "Brand", heading: "Brand & identity" },
  { key: "contact", label: "Contact", heading: "Contact & social" },
  { key: "copy", label: "Copy", heading: "Storefront copy" },
  { key: "payments", label: "Payments", heading: "Payments" },
  { key: "shipping", label: "Shipping", heading: "Shipping & fulfilment" },
  { key: "product", label: "Products", heading: "Product defaults" },
  { key: "email", label: "Email", heading: "Notifications & email" },
] as const;

export type TabKey = (typeof TABS)[number]["key"];

export const DEFAULT_TAB: TabKey = "brand";

export function isTabKey(v: string | undefined): v is TabKey {
  return TABS.some((t) => t.key === v);
}

/** Label + home tab for every editable field. The one place either is stated. */
export const FIELD_META: Record<DraftKey, { label: string; tab: TabKey }> = {
  brandName: { label: "Brand name", tab: "brand" },
  tagline: { label: "Tagline", tab: "brand" },
  logoUrl: { label: "Logo", tab: "brand" },
  announcement: { label: "Announcement bar", tab: "brand" },
  heroHeadline: { label: "Hero headline", tab: "copy" },
  heroSubtext: { label: "Hero subtext", tab: "copy" },
  aboutText: { label: "About text", tab: "copy" },
  contactEmail: { label: "Contact email", tab: "contact" },
  contactPhone: { label: "Contact phone", tab: "contact" },
  whatsapp: { label: "WhatsApp number", tab: "contact" },
  address: { label: "Studio address", tab: "contact" },
  instagram: { label: "Instagram URL", tab: "contact" },
  facebook: { label: "Facebook URL", tab: "contact" },
  adminNotifyEmail: { label: "Order & lead emails", tab: "email" },
  freeShippingThreshold: { label: "Free shipping above", tab: "shipping" },
  codEnabled: { label: "Cash on Delivery", tab: "payments" },
  prepaidEnabled: { label: "Prepaid", tab: "payments" },
  partialEnabled: { label: "Advance + COD", tab: "payments" },
  directEnabled: { label: "Customised order", tab: "payments" },
  razorpayEnabled: { label: "Razorpay online payments", tab: "payments" },
  nimbusEnabled: { label: "NimbusPost shipping", tab: "shipping" },
  defaultMaterialsCare: { label: "Materials & Care", tab: "product" },
  defaultShippingInfo: { label: "Shipping & Delivery", tab: "product" },
};

const ALL_KEYS = Object.keys(FIELD_META) as DraftKey[];

/** Which fields differ from what the database last confirmed. */
export function changedKeys(
  draft: SettingsDraft,
  baseline: SettingsDraft
): DraftKey[] {
  return ALL_KEYS.filter((k) => draft[k] !== baseline[k]);
}

/** Per-tab counts, so a tab can say "2" without anyone opening it. */
export function countByTab(keys: DraftKey[]): Record<TabKey, number> {
  const out = {} as Record<TabKey, number>;
  for (const t of TABS) out[t.key] = 0;
  for (const k of keys) out[FIELD_META[k].tab] += 1;
  return out;
}

/* ------------------------------------------------------------------ */
/*  Tab bar                                                            */
/* ------------------------------------------------------------------ */

/** The one panel the selected tab controls. */
export const SETTINGS_PANEL_ID = "settings-panel";

/**
 * Horizontally scrollable on a phone rather than wrapped into three rows: the
 * bar stays one line tall so the form starts in the same place on every
 * screen. `overscroll-x-contain` keeps the swipe from chaining out to the
 * browser's back gesture.
 */
export function SettingsTabs({
  tab,
  onChange,
  dirtyByTab,
}: {
  tab: TabKey;
  onChange: (t: TabKey) => void;
  dirtyByTab: Record<TabKey, number>;
}) {
  return (
    <div
      role="tablist"
      aria-label="Settings sections"
      className="-mx-1 flex max-w-full gap-1 overflow-x-auto overscroll-x-contain border-b border-border px-1"
    >
      {TABS.map((t) => {
        const active = t.key === tab;
        const n = dirtyByTab[t.key];
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`settings-tab-${t.key}`}
            aria-selected={active}
            // Only the selected tab names the panel: it is the only one that
            // has a panel on screen to point at.
            aria-controls={active ? SETTINGS_PANEL_ID : undefined}
            onClick={() => onChange(t.key)}
            className={cn(
              "-mb-px inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 border-b-2 px-3 text-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
              active
                ? "border-accent text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
            {n > 0 && (
              <span
                aria-label={`${n} unsaved change${n === 1 ? "" : "s"}`}
                className="grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-foreground"
              >
                {n}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Controls                                                           */
/* ------------------------------------------------------------------ */

/** One-line text input. `dirty` puts the accent ring on the field itself. */
export function TextField({
  label,
  value,
  onChange,
  tip,
  hint,
  type = "text",
  placeholder,
  maxLength,
  inputMode,
  dirty,
  required,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  tip?: React.ReactNode;
  hint?: React.ReactNode;
  type?: string;
  placeholder?: string;
  maxLength?: number;
  inputMode?: "text" | "numeric" | "tel" | "email" | "url";
  dirty?: boolean;
  required?: boolean;
  className?: string;
}) {
  return (
    <Field
      label={label}
      tip={tip}
      hint={hint}
      required={required}
      className={className}
    >
      {(id) => (
        <input
          id={id}
          type={type}
          value={value}
          placeholder={placeholder}
          maxLength={maxLength}
          inputMode={inputMode}
          onChange={(e) => onChange(e.target.value)}
          className={cn("input", dirty && "border-accent")}
        />
      )}
    </Field>
  );
}

/** Free-text block — hero subtext, about copy. */
export function AreaField({
  label,
  value,
  onChange,
  tip,
  hint,
  rows = 3,
  maxLength,
  dirty,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  tip?: React.ReactNode;
  hint?: React.ReactNode;
  rows?: number;
  maxLength?: number;
  dirty?: boolean;
}) {
  return (
    <Field label={label} tip={tip} hint={hint}>
      {(id) => (
        <textarea
          id={id}
          rows={rows}
          value={value}
          maxLength={maxLength}
          onChange={(e) => onChange(e.target.value)}
          className={cn("input resize-y", dirty && "border-accent")}
        />
      )}
    </Field>
  );
}

/**
 * A textarea whose lines each become a bullet on the storefront. The count in
 * the label is the whole explanation — "0 bullets · hidden" says more than a
 * paragraph about what an empty box does.
 */
export function LinesField({
  label,
  value,
  onChange,
  tip,
  rows = 4,
  dirty,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  tip?: React.ReactNode;
  rows?: number;
  dirty?: boolean;
}) {
  const points = value.split("\n").filter((l) => l.trim()).length;
  return (
    <Field
      label={label}
      tip={tip}
      hint={
        points === 0
          ? "Empty — this section is hidden on every product page."
          : `${points} bullet${points === 1 ? "" : "s"}, one per line.`
      }
    >
      {(id) => (
        <textarea
          id={id}
          rows={rows}
          value={value}
          maxLength={4000}
          onChange={(e) => onChange(e.target.value)}
          placeholder="One point per line"
          className={cn(
            "input resize-y font-mono text-xs leading-relaxed",
            dirty && "border-accent"
          )}
        />
      )}
    </Field>
  );
}

/* ------------------------------------------------------------------ */
/*  Read-only mirrors                                                  */
/* ------------------------------------------------------------------ */

/**
 * A setting that lives on another screen: its current value, plainly, and one
 * link to its owner. Never an input — a second editable copy of a column is
 * exactly what this component exists to prevent.
 */
export function ManagedElsewhere({
  title,
  href,
  where,
  why,
  note,
  children,
}: {
  title: string;
  /** The owning screen. Omitted when the value is fixed in code. */
  href?: string;
  /** Human path to the owning screen, e.g. "Returns → Return policy". */
  where?: string;
  /** One line on why it lives there. Shown behind the (i). */
  why: React.ReactNode;
  /** Shown in place of the link when there is no screen to send them to. */
  note?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-2xl border border-dashed border-border bg-muted/20 p-4 sm:p-5">
      <div className="mb-3 flex min-h-8 flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h2 className="flex min-w-0 items-center gap-1 font-serif text-lg leading-none">
          {title}
          <InfoTip term={title}>{why}</InfoTip>
        </h2>
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Read-only here
        </span>
      </div>

      <dl className="space-y-1.5">{children}</dl>

      {href && where ? (
        <Link
          href={href}
          className={cn(
            "mt-3 inline-flex min-h-11 items-center gap-1.5 rounded-lg text-[11px] font-medium uppercase tracking-wider text-accent transition-colors hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          )}
        >
          Edit in {where}
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      ) : (
        note && (
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            {note}
          </p>
        )
      )}
    </section>
  );
}

/**
 * One `term: value` line. Wraps rather than truncates — a policy value the
 * admin cannot read is not a mirror, it is decoration.
 */
export function ReadRow({
  label,
  value,
  tone,
  tip,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "muted" | "warn";
  tip?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-border/60 pb-1.5 last:border-0 last:pb-0">
      <dt className="flex items-center gap-1 text-xs text-muted-foreground">
        {label}
        {tip && <InfoTip term={label}>{tip}</InfoTip>}
      </dt>
      <dd
        className={cn(
          "min-w-0 text-right text-xs font-medium",
          tone === "muted" && "font-normal text-muted-foreground",
          tone === "warn" && "text-orange-600 dark:text-orange-400"
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Save bar                                                           */
/* ------------------------------------------------------------------ */

/**
 * Sticky, and it names the fields. "Unsaved changes" tells an admin that
 * something will be written; a list tells them *what*, which is the only
 * version that lets them catch a stray keystroke in a tab they left open an
 * hour ago.
 *
 * Rendered only while dirty, and animated on opacity alone — never parked
 * offscreen with a transform (see the modal note in CLAUDE.md).
 */
export function SaveBar({
  keys,
  saving,
  onSave,
  onDiscard,
}: {
  keys: DraftKey[];
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  if (keys.length === 0) return null;

  const names = keys.map((k) => FIELD_META[k].label);
  const shown = names.slice(0, 3);
  const extra = names.length - shown.length;

  return (
    // Deliberately not `role="status"`: the list changes on every keystroke,
    // and a live region would read the whole thing out each time.
    <section
      aria-label="Unsaved changes"
      className="sticky bottom-3 z-20 mt-4 rounded-2xl border border-accent/40 bg-card/95 p-3 shadow-lg backdrop-blur animate-[fadeIn_0.15s_ease-out_both] motion-reduce:animate-none"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="min-w-0 flex-1 text-xs leading-relaxed">
          <span className="font-medium">
            {keys.length} unsaved change{keys.length === 1 ? "" : "s"}
          </span>
          <span className="text-muted-foreground">
            {" — "}
            {shown.join(", ")}
            {extra > 0 && ` and ${extra} more`}. Nothing is written until you
            press Save.
          </span>
        </p>

        <div className="flex shrink-0 items-center gap-2">
          <Btn tone="ghost" onClick={onDiscard} disabled={saving}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Discard
          </Btn>
          <Btn tone="solid" onClick={onSave} disabled={saving}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Save changes
          </Btn>
        </div>
      </div>
    </section>
  );
}
