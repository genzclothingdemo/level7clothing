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
 * 3. **One writer per column.** A column has exactly one editor. Where the
 *    value is fixed in code, `ManagedElsewhere` states it read-only. Two
 *    editable copies of one column is how they drift — see the
 *    `defaultReturnsInfo` lost update in CLAUDE.md.
 *
 * Explanation lives in an `InfoTip` or behind `ExpandableText`, never in a
 * paragraph under a field — same rule as `form-kit`.
 *
 * ## Two writers, one save bar
 *
 * The order-pipeline columns moved in from the Orders screen, and they keep
 * their own scoped server action (`updateOrderPipelineSettings`). The draft
 * below therefore spans two actions: `PIPELINE_KEYS` is the split, and
 * `settings-form` sends each group only to the action that owns it. That is the
 * opposite of merging them into one payload — merging is precisely what would
 * let a Settings save clobber a column it does not own.
 */

import { TABS, type TabKey } from "@/lib/settings-tabs";
import Link from "next/link";
import { ArrowUpRight, Loader2, RotateCcw } from "lucide-react";
import { InfoTip } from "@/components/store/info-tip";
import { Disclosure } from "@/components/store/disclosure";
import { Btn } from "@/components/admin/order-ui";
import { Field } from "@/components/admin/form-kit";
import type {
  CourierChoice,
  DispatchOnConfirm,
  OrderConfirmMode,
} from "@/lib/orders-pipeline";
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
  razorpayEnabled: boolean;
  nimbusEnabled: boolean;
  defaultMaterialsCare: string;
  defaultShippingInfo: string;

  /* ---- Cash-handling fees. Written by `updatePaymentFees`. ---- */
  /**
   * Whole rupees, held as strings for the same reason as
   * `freeShippingThreshold`: an emptied number input is `""`, not `0`, and a
   * draft that snaps back to 0 under the caret cannot be typed into.
   */
  codFeeAmount: string;
  partialFeeAmount: string;

  /* ---- Order pipeline. Written by `updateOrderPipelineSettings`. ---- */
  orderConfirmMode: OrderConfirmMode;
  autoConfirmPrepaid: boolean;
  autoConfirmPartial: boolean;
  autoConfirmCod: boolean;
  /**
   * Q1 — how far a confirmed order goes on its own. **The enum, not the old
   * `autoShipOnConfirm` boolean**, which could only say draft (false) or book
   * (true) and had no way to express "leave the courier alone". The boolean is
   * still a column and is still written, but it is derived from this one by
   * the action, so it is deliberately absent from the draft: two editable
   * copies of one decision is how they drift apart.
   */
  dispatchOnConfirm: DispatchOnConfirm;
  /**
   * `CourierChoice`, not `AutoShipCourier`: the column accepts a **pinned
   * courier name** as well as the two strategies, and the draft has to hold
   * what the database actually holds. Narrowing it here would show "Cheapest"
   * for a store that had pinned Xpressbees and then write that back — a silent
   * downgrade of a real setting.
   */
  autoShipCourier: CourierChoice;
};

export type DraftKey = keyof SettingsDraft;

/**
 * The six keys `updateSettings` must never see.
 *
 * `settingsSchema` deliberately does not accept them, and Zod strips anything
 * not in the schema *silently* (CLAUDE.md, "Zod strips anything not in the
 * schema") — so sending them there would not error, it would just quietly do
 * nothing. This list is what routes them to their own action instead.
 */
export const PIPELINE_KEYS = [
  "orderConfirmMode",
  "autoConfirmPrepaid",
  "autoConfirmPartial",
  "autoConfirmCod",
  "dispatchOnConfirm",
  "autoShipCourier",
] as const satisfies readonly DraftKey[];

export type PipelineKey = (typeof PIPELINE_KEYS)[number];

const PIPELINE_KEY_SET: ReadonlySet<string> = new Set(PIPELINE_KEYS);

export function isPipelineKey(k: DraftKey): k is PipelineKey {
  return PIPELINE_KEY_SET.has(k);
}

/**
 * The two keys owned by `updatePaymentFees`, for exactly the same reason: a
 * writer only ever receives the columns it owns, and `settingsSchema` would
 * strip these two without a word.
 */
export const FEE_KEYS = [
  "codFeeAmount",
  "partialFeeAmount",
] as const satisfies readonly DraftKey[];

export type FeeKey = (typeof FEE_KEYS)[number];

const FEE_KEY_SET: ReadonlySet<string> = new Set(FEE_KEYS);

export function isFeeKey(k: DraftKey): k is FeeKey {
  return FEE_KEY_SET.has(k);
}

/* ------------------------------------------------------------------ */
/*  Tabs                                                               */
/* ------------------------------------------------------------------ */

/**
 * Grouped by the job being done, not by the order of the columns in the
 * schema. "Change the phone number", "turn COD off for a week" and "rewrite
 * the hero" are three different errands and should not be three scroll
 * positions in one form.
 */
// Moved to lib/settings-tabs.ts. Everything exported from a "use client"
// module is a client reference, so the server page calling `isTabKey()` from
// here threw "Attempted to call isTabKey() from the server". Re-exported so
// client consumers keep their existing import — but the SERVER page must
// import from "@/lib/settings-tabs" directly, not through this file.
//
// Imported as well as re-exported: `export … from` re-publishes the names
// without binding them in this module's scope, and the components below use
// TABS and TabKey directly.
export {
  TABS,
  DEFAULT_TAB,
  TAB_ALIASES,
  isTabKey,
  resolveTab,
  tabMeta,
  type TabKey,
  type SettingsTab,
} from "@/lib/settings-tabs";

/** Label + home tab for every editable field. The one place either is stated. */
export const FIELD_META: Record<DraftKey, { label: string; tab: TabKey }> = {
  brandName: { label: "Brand name", tab: "store" },
  tagline: { label: "Tagline", tab: "store" },
  logoUrl: { label: "Logo", tab: "store" },
  announcement: { label: "Announcement bar", tab: "store" },
  contactEmail: { label: "Contact email", tab: "store" },
  contactPhone: { label: "Contact phone", tab: "store" },
  whatsapp: { label: "WhatsApp number", tab: "store" },
  address: { label: "Studio address", tab: "store" },
  instagram: { label: "Instagram URL", tab: "store" },
  facebook: { label: "Facebook URL", tab: "store" },

  orderConfirmMode: { label: "When orders confirm", tab: "orders" },
  autoConfirmPrepaid: { label: "Auto-confirm prepaid", tab: "orders" },
  autoConfirmPartial: { label: "Auto-confirm part-paid", tab: "orders" },
  autoConfirmCod: { label: "Auto-confirm cash on delivery", tab: "orders" },
  dispatchOnConfirm: { label: "What confirming does", tab: "orders" },
  autoShipCourier: { label: "Courier preference", tab: "orders" },

  codEnabled: { label: "Cash on delivery", tab: "payments" },
  prepaidEnabled: { label: "Pay online in full", tab: "payments" },
  partialEnabled: { label: "Part now, rest on delivery", tab: "payments" },
  codFeeAmount: { label: "Cash on delivery fee", tab: "payments" },
  partialFeeAmount: { label: "Part-payment fee", tab: "payments" },
  freeShippingThreshold: { label: "Free shipping above", tab: "payments" },

  razorpayEnabled: { label: "Razorpay online payments", tab: "integrations" },
  nimbusEnabled: { label: "NimbusPost shipping", tab: "integrations" },

  // Storefront copy and the admin alert address were their own two tabs until
  // they were folded into Store. Their `tab` here is what routes their dirty
  // count to the right badge — a key still pointing at "storefront" would index
  // a tab that no longer exists and drop the count on the floor.
  heroHeadline: { label: "Hero headline", tab: "store" },
  heroSubtext: { label: "Hero subtext", tab: "store" },
  aboutText: { label: "About text", tab: "store" },
  defaultMaterialsCare: { label: "Materials & Care", tab: "store" },
  defaultShippingInfo: { label: "Shipping & Delivery", tab: "store" },

  adminNotifyEmail: { label: "Order & lead emails", tab: "store" },
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
/*  Set-once disclosure                                                */
/* ------------------------------------------------------------------ */

/**
 * The second level of every tab: fields that are set once and then left alone.
 *
 * The screen was a wall of fields because a logo upload and the COD switch were
 * given the same weight, and the logo is chosen on day one while COD is flipped
 * in a bad week. So each tab now opens with what changes often and folds the
 * rest behind one of these. `summary` is what makes a fold honest — "3 of 4
 * filled" answers the question without opening it.
 *
 * **`dirty` is not decoration.** Switching tabs unmounts the section, so a fold
 * would reopen closed and hide an unsaved edit that the save bar is still
 * promising to write. Passing the dirty state re-opens exactly the folds that
 * hold one.
 */
export function SetOnce({
  label,
  summary,
  tip,
  dirty = false,
  children,
}: {
  label: string;
  /** One line readable while closed — a count, a state, never an explanation. */
  summary?: React.ReactNode;
  /**
   * What this group is and where its values show up. Every fold used to open on
   * a paragraph of exactly this before reaching a single control, so the reward
   * for expanding was more reading. It sits on the closed row instead.
   */
  tip?: React.ReactNode;
  /** True when any field inside differs from the last saved value. */
  dirty?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "min-w-0 rounded-2xl border bg-card px-4 sm:px-5",
        dirty ? "border-accent/50" : "border-border"
      )}
    >
      {/* The (i) is a sibling of the Disclosure's button, never inside it: a
          button nested in a button is invalid, and tapping the tip would
          otherwise toggle the fold underneath it. */}
      <div className="flex min-w-0 items-center gap-1">
        <Disclosure
          className="min-w-0 flex-1"
          label={label}
          defaultOpen={dirty}
          summary={
            dirty ? (
              <span className="font-medium text-accent">unsaved changes</span>
            ) : (
              summary
            )
          }
        >
          <div className="space-y-4 pb-4">{children}</div>
        </Disclosure>
        {tip && (
          <span className="grid h-11 w-8 shrink-0 place-items-center self-start">
            <InfoTip term={label}>{tip}</InfoTip>
          </span>
        )}
      </div>
    </section>
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
