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
 * ## Four ways to say something, and which one to reach for
 *
 * The owner reads a tab in three passes — the first five seconds, one tap in,
 * and the explanation — so every sentence on this screen has to pick one:
 *
 *   **Printed** — a value, a state, or a warning about *this* configuration.
 *     `Callout` is the only printed paragraph shape, and its body is one line:
 *     the headline is what must be read, the why is behind its `(i)`.
 *   **`(i)`** — what a term means, in two or three sentences. `InfoTip`.
 *   **`Explainer`** — how something works, when it is a paragraph long. One
 *     quiet row that opens in place; a paragraph in a bubble is a wall in a
 *     smaller box.
 *   **`SetOnce`** — controls that are decided once. Folded, with a summary
 *     that answers the question without opening it.
 *
 * Anything that is true on every visit forever is onboarding text, and never
 * belongs in the first pass.
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
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowUpRight,
  Eye,
  Info,
  Loader2,
  RotateCcw,
} from "lucide-react";
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

  /* ---- Identity verification. Written by `updateVerificationSettings`. ----
   *
   * Four, not two, because the two channels and the two moments really are
   * independent: a store may want a confirmed email to open an account and not
   * ask again at checkout, or the exact reverse.
   */
  requireSignupEmailOtp: boolean;
  requireSignupPhoneOtp: boolean;
  requireVerifiedEmailToOrder: boolean;
  requireVerifiedPhoneToOrder: boolean;

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

/**
 * The four verification switches, owned by `updateVerificationSettings`.
 *
 * Third writer, same rule as the other two: `settingsSchema` does not declare
 * these columns, and Zod drops what it does not declare **without a word**, so
 * sending them through `updateSettings` would look like a save and write
 * nothing. That is the failure this split exists to make impossible.
 */
export const VERIFY_KEYS = [
  "requireSignupEmailOtp",
  "requireSignupPhoneOtp",
  "requireVerifiedEmailToOrder",
  "requireVerifiedPhoneToOrder",
] as const satisfies readonly DraftKey[];

export type VerifyKey = (typeof VERIFY_KEYS)[number];

const VERIFY_KEY_SET: ReadonlySet<string> = new Set(VERIFY_KEYS);

export function isVerifyKey(k: DraftKey): k is VerifyKey {
  return VERIFY_KEY_SET.has(k);
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

  // Moved from Store to Alerts, with Store keeping a read-only line and a
  // link. It is the private half of the sending identity — the address the
  // store writes to YOU at — and it belongs beside the address it writes FROM.
  // Still exactly one input, still written only by `updateSettings`; the move
  // is which tab draws it, not which action owns it.
  adminNotifyEmail: { label: "Order & lead emails", tab: "alerts" },

  // Verification moved to Alerts with it. It was on Store because it is about
  // the *people* the store deals with and the two contacts it reaches them on
  // — but that is the same sentence as "which channel can actually carry an
  // alert", which is the question the Alerts tab exists to answer. A store
  // that asks for a code before it believes an address is a store whose email
  // alerts land; one that does not is guessing. Splitting the four across two
  // tabs would mean neither tab could state what the store actually asks for,
  // so all four moved together.
  requireSignupEmailOtp: { label: "Confirm email at signup", tab: "alerts" },
  requireSignupPhoneOtp: { label: "Confirm mobile at signup", tab: "alerts" },
  requireVerifiedEmailToOrder: {
    label: "Confirmed email before ordering",
    tab: "alerts",
  },
  requireVerifiedPhoneToOrder: {
    label: "Confirmed mobile before ordering",
    tab: "alerts",
  },
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
 *
 * ## Three things this bar used to get wrong
 *
 * 1. **A stray vertical scrollbar beside the tabs, on every screen.** Each tab
 *    carried `-mb-px` to sit its underline on the bar's `border-b`, which made
 *    the content one pixel taller than the box — and `overflow-x: auto` turns
 *    `overflow-y` to `auto` with it. So there was a 1px vertical scroll, and a
 *    scrollbar to go with it. The baseline is now an inset shadow painted
 *    *under* the tabs, so the underline covers it without overflowing.
 * 2. **On a phone the selected tab could be off screen.** Access is the last of
 *    seven, so `?tab=add_admin` opened on a bar showing Store to Integrations
 *    and nothing saying where you were. The selected tab is now scrolled into
 *    view whenever it changes.
 * 3. **Nothing said the bar scrolled.** The scrollbar is hidden — on a phone it
 *    is noise, and it was the thing drawing the stray bar above — and an edge
 *    fade appears on whichever side has more tabs instead.
 *
 * Arrow keys move between tabs (the WAI-ARIA tabs pattern, activation follows
 * focus), with a roving tabindex so Tab leaves the bar in one press.
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
  const listRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  /** Which sides have tabs scrolled out of sight — drives the edge fade. */
  const readEdges = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdges((prev) =>
      prev.left === left && prev.right === right ? prev : { left, right }
    );
  }, []);

  // Keep the selected tab on screen. `scrollLeft` on the bar itself rather than
  // `scrollIntoView`, which would also scroll the page vertically.
  useEffect(() => {
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>(`[data-tab="${tab}"]`);
    if (!list || !el) return;
    const PAD = 32;
    const start = el.offsetLeft - PAD;
    const end = el.offsetLeft + el.offsetWidth + PAD - list.clientWidth;
    if (list.scrollLeft > start) list.scrollLeft = Math.max(0, start);
    else if (list.scrollLeft < end) list.scrollLeft = end;
    // Measured after the browser has applied the scroll, not inside it.
    const frame = requestAnimationFrame(readEdges);
    return () => cancelAnimationFrame(frame);
  }, [tab, readEdges]);

  useEffect(() => {
    const frame = requestAnimationFrame(readEdges);
    window.addEventListener("resize", readEdges);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", readEdges);
    };
  }, [readEdges]);

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const i = TABS.findIndex((t) => t.key === tab);
    const next =
      e.key === "ArrowRight"
        ? (i + 1) % TABS.length
        : e.key === "ArrowLeft"
          ? (i - 1 + TABS.length) % TABS.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? TABS.length - 1
              : -1;
    if (next < 0) return;
    e.preventDefault();
    const key = TABS[next].key;
    onChange(key);
    listRef.current
      ?.querySelector<HTMLElement>(`[data-tab="${key}"]`)
      ?.focus({ preventScroll: true });
  }

  const FADE = 28;
  const mask =
    edges.left || edges.right
      ? `linear-gradient(to right, ${edges.left ? "transparent" : "#000"} 0, #000 ${
          edges.left ? FADE : 0
        }px, #000 calc(100% - ${edges.right ? FADE : 0}px), ${
          edges.right ? "transparent" : "#000"
        } 100%)`
      : undefined;

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label="Settings sections"
      onKeyDown={onKeyDown}
      onScroll={readEdges}
      style={mask ? { maskImage: mask, WebkitMaskImage: mask } : undefined}
      className={cn(
        "relative -mx-1 flex max-w-full gap-1 overflow-x-auto overflow-y-hidden overscroll-x-contain px-1",
        // The baseline. An inset shadow is painted beneath the tabs, so the
        // selected tab's underline covers it with no negative margin — which
        // is what used to overflow the bar by a pixel.
        "shadow-[inset_0_-1px_0_var(--border)]",
        "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      )}
    >
      {TABS.map((t) => {
        const active = t.key === tab;
        const n = dirtyByTab[t.key];
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            data-tab={t.key}
            id={`settings-tab-${t.key}`}
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            // Only the selected tab names the panel: it is the only one that
            // has a panel on screen to point at.
            aria-controls={active ? SETTINGS_PANEL_ID : undefined}
            onClick={() => onChange(t.key)}
            className={cn(
              "inline-flex min-h-11 shrink-0 cursor-pointer items-center gap-1.5 border-b-2 px-3 text-sm font-medium transition-colors",
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
  onJump,
  where,
  why,
  note,
  children,
}: {
  title: string;
  /** The owning screen. Omitted when the value is fixed in code. */
  href?: string;
  /**
   * Switch to another tab of *this* screen instead of navigating.
   *
   * A `<Link>` to `?tab=…` would be a real navigation, and this form keeps one
   * unsaved draft across every tab — the tab bar itself uses
   * `history.replaceState` for exactly that reason. When the owner is here,
   * this is the same jump without the risk of dropping an edit. Takes
   * precedence over `href`.
   */
  onJump?: () => void;
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

      {onJump && where ? (
        <button
          type="button"
          onClick={onJump}
          className={cn(
            "mt-3 inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg text-[11px] font-medium uppercase tracking-wider text-accent transition-colors hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          )}
        >
          Edit in {where}
          <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      ) : href && where ? (
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

/**
 * A fixed fact that is not a setting, in one line — for what used to take a
 * whole `ManagedElsewhere` card to say "this cannot be changed here".
 *
 * A card with a heading, a "read-only" label and three rows gave a value nobody
 * can edit the same weight as the switches around it. One dashed row with an
 * `(i)` says the same thing at the size it deserves.
 */
export function FixedRow({
  label,
  value,
  tip,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tip?: React.ReactNode;
  tone?: "warn";
}) {
  return (
    <div className="flex min-h-11 min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-2">
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        {label}
        {tip && <InfoTip term={label}>{tip}</InfoTip>}
      </span>
      <span
        className={cn(
          "min-w-0 text-right text-xs font-medium",
          tone === "warn" && "text-orange-700 dark:text-orange-300"
        )}
      >
        {value}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Printed warnings, and prose that opens in place                    */
/* ------------------------------------------------------------------ */

const CALLOUT_TONE = {
  danger: { box: "border-danger/40 bg-danger/10", text: "text-danger" },
  warn: {
    box: "border-orange-500/40 bg-orange-500/10",
    text: "text-orange-700 dark:text-orange-300",
  },
  info: { box: "border-border bg-muted/40", text: "text-foreground" },
} as const;

export type CalloutTone = keyof typeof CALLOUT_TONE;

/**
 * The one printed-paragraph shape on this screen: a warning about the
 * configuration as it stands right now.
 *
 * Every tab had grown its own copy of this box — a bold line, then a paragraph
 * under it — and the paragraph was always the *why*, which is the part you
 * need once. So the headline is printed (a warning behind an `(i)` is a warning
 * nobody reads) and the why is behind the `(i)` beside it. `children` is for a
 * second line only when it is something to act on — a value, a button — never
 * the explanation again.
 *
 * Rendered only while the state it describes is true. A callout that is always
 * on screen is onboarding text wearing a warning's colours.
 */
export function Callout({
  tone = "warn",
  title,
  term,
  tip,
  icon,
  children,
  className,
}: {
  tone?: CalloutTone;
  /** The sentence that must be read. */
  title: React.ReactNode;
  /** Names the `(i)` when `title` is not a plain string. */
  term?: string;
  /** Why it matters and what to do about it. */
  tip?: React.ReactNode;
  /** A rendered element. Defaults to a warning triangle, or (i) for `info`. */
  icon?: React.ReactNode;
  /** One actionable line under the headline — a button, a value. */
  children?: React.ReactNode;
  className?: string;
}) {
  const t = CALLOUT_TONE[tone];
  return (
    <div className={cn("min-w-0 rounded-lg border px-3 py-2", t.box, className)}>
      <div
        className={cn(
          "flex items-start gap-1.5 text-xs font-medium leading-relaxed",
          t.text
        )}
      >
        <span
          aria-hidden="true"
          className="mt-0.5 shrink-0 [&>svg]:h-3.5 [&>svg]:w-3.5"
        >
          {icon ?? (tone === "info" ? <Info /> : <AlertTriangle />)}
        </span>
        <p className="min-w-0 flex-1">
          {title}
          {tip && (
            <InfoTip
              term={term ?? (typeof title === "string" ? title : "More about this")}
            >
              {tip}
            </InfoTip>
          )}
        </p>
      </div>
      {children && (
        <div className="mt-1 pl-5 text-xs leading-relaxed text-foreground">
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * "How does this work?" as one quiet row that opens in place.
 *
 * For a paragraph too long for an `(i)` — a rule with three moving parts, a
 * worked consequence. It used to be printed (or clamped to two lines behind
 * "View more", which is still two lines of standing text on every visit). The
 * label is phrased as the question the owner would ask, so the closed row is
 * itself the table of contents.
 */
export function Explainer({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 border-t border-border/60", className)}>
      <Disclosure
        label={label}
        icon={<Info className="h-3.5 w-3.5" aria-hidden="true" />}
      >
        <div className="space-y-2 pl-5 text-xs leading-relaxed text-muted-foreground">
          {children}
        </div>
      </Disclosure>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Links out                                                          */
/* ------------------------------------------------------------------ */

export type SeeAlsoLink = {
  label: string;
  /** Another admin screen. */
  href?: string;
  /**
   * Another tab of *this* screen. Takes precedence over `href`, for the reason
   * `ManagedElsewhere.onJump` gives: a real navigation would remount the form
   * and drop an unsaved edit.
   */
  onJump?: () => void;
};

/**
 * Redirection instead of duplication: one dashed row of links to where a
 * related thing actually lives.
 *
 * The owner's standing rule is that a fact has one home and every other screen
 * links to it. A mirror card restating another tab's values is the thing that
 * rule removes — this is what replaces it.
 */
export function SeeAlso({
  title = "Elsewhere",
  tip,
  links,
}: {
  title?: string;
  tip?: React.ReactNode;
  links: SeeAlsoLink[];
}) {
  const cls = cn(
    "inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-[11px] font-medium uppercase tracking-wider text-accent transition-colors hover:text-foreground",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
  );
  return (
    <nav
      aria-label={title}
      className="flex min-w-0 flex-wrap items-center gap-x-1 rounded-2xl border border-dashed border-border px-3 py-1 sm:px-4"
    >
      <span className="mr-1 flex items-center gap-1 text-xs text-muted-foreground">
        {title}
        {tip && <InfoTip term={title}>{tip}</InfoTip>}
      </span>
      {links.map((l) =>
        l.onJump ? (
          <button
            key={l.label}
            type="button"
            onClick={l.onJump}
            className={cn(cls, "cursor-pointer")}
          >
            {l.label}
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : l.href ? (
          <Link key={l.label} href={l.href} className={cls}>
            {l.label}
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        ) : null
      )}
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/*  View-only viewers                                                  */
/* ------------------------------------------------------------------ */

/**
 * Printed once, above whichever tab is open, for a view-only temporary admin.
 *
 * It used to exist on the Access tab only, so a view-only holder could edit six
 * tabs' worth of fields and learn at Save that none of it could land. This is
 * the UI reflecting the rule, never the rule: every writer refuses the account
 * in `requireAdminWrite` and records the attempt, whatever this screen shows.
 */
export function ReadOnlyNotice() {
  return (
    <Callout
      tone="warn"
      icon={<Eye />}
      term="View-only access"
      title="View-only access — you can open every tab, but nothing here can be saved."
      tip="The server refuses every change this account tries, on every screen, and records the attempt in the store owner's activity log. Ask the owner for full access if you need to change something."
    />
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
 *
 * `readOnly` drops the Save button rather than disabling it — a control that
 * cannot apply is absent, not greyed — and says why in its place. The form's
 * own `save()` still refuses a view-only viewer, and the server refuses them
 * whatever the browser sends; this is only the screen being honest first.
 *
 * Pinned above the home indicator through `--sa-bottom`, never `env()`
 * directly (CLAUDE.md, "Safe areas").
 */
export function SaveBar({
  keys,
  saving,
  onSave,
  onDiscard,
  readOnly = false,
}: {
  keys: DraftKey[];
  saving: boolean;
  onSave: () => void;
  onDiscard: () => void;
  /** The viewer cannot write. Save is absent; Discard stays. */
  readOnly?: boolean;
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
      className="sticky bottom-[calc(0.75rem+var(--sa-bottom))] z-20 mt-4 rounded-2xl border border-accent/40 bg-card/95 p-3 shadow-lg backdrop-blur animate-[fadeIn_0.15s_ease-out_both] motion-reduce:animate-none"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="min-w-0 flex-1 text-xs leading-relaxed">
          <span className="font-medium">
            {readOnly
              ? "View-only — these edits can't be saved"
              : `${keys.length} unsaved change${keys.length === 1 ? "" : "s"}`}
          </span>
          <span className="text-muted-foreground">
            {" · "}
            {shown.join(", ")}
            {extra > 0 && ` and ${extra} more`}
          </span>
        </p>

        <div className="flex shrink-0 items-center gap-2">
          <Btn tone="ghost" onClick={onDiscard} disabled={saving}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Discard
          </Btn>
          {!readOnly && (
            <Btn tone="solid" onClick={onSave} disabled={saving}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save changes
            </Btn>
          )}
        </div>
      </div>
    </section>
  );
}
