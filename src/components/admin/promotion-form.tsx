"use client";

/**
 * The promotion editor.
 *
 * Three decisions carried over from the coupon editor, for the same reasons:
 *
 * 1. **Every explanation is an `(i)`, never a paragraph under the field.** The
 *    tip is the storefront's `InfoTip`, reached through `form-kit`'s `Field`.
 * 2. **A live verdict sits at the top**, in the same words the list uses, so
 *    "Live now" cannot mean one thing here and another there.
 * 3. **Fields that don't apply aren't shown** — the CTA destination only
 *    matters once there is a label to attach it to.
 *
 * The one thing this editor has that the coupon editor does not is a preview
 * of both surfaces, built from the real storefront components. A promotion is
 * the only thing in this admin whose output is *decoration*: the admin cannot
 * check it by reading a number back, they have to look at it.
 */

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock, Megaphone } from "lucide-react";
import { Card, Field, Segmented, SwitchRow } from "@/components/admin/form-kit";
import { PromotionPreview } from "@/components/admin/promotion-preview";
import {
  PromotionStatusPill,
  promotionDismissSummary,
  promotionStatusFor,
  promotionWindowError,
  promotionWindowSummary,
  storeNowInputValue,
} from "@/components/admin/promotion-summary";
import { formatStoreInputValue } from "@/components/admin/coupon-summary";
import { createPromotion, updatePromotion } from "@/app/actions/promotions";
import type { PromotionKind } from "@/lib/promotions";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ */
/*  The store's clock, read safely                                     */
/* ------------------------------------------------------------------ */

/**
 * "Now" has to come from the browser — it is the admin's wall clock that
 * decides whether a typed window is in the past — but a value read during
 * render would differ between the server pass and the client one and break
 * hydration.
 *
 * `useSyncExternalStore` with a **null server snapshot** solves that without
 * the `useState` + `useEffect` cascade this repo already carries too much of
 * (`react-hooks/set-state-in-effect`). The subscribe is a no-op: the form
 * re-renders on every keystroke anyway, so the cached reading below is
 * refreshed often enough without a timer nobody asked for.
 */
let clockAt = 0;
let clockValue: string | null = null;

function currentStoreNow(): string {
  const t = Date.now();
  // Cached for a minute so consecutive `getSnapshot` calls in one render
  // return an identical string, which is what the hook requires.
  if (clockValue === null || t - clockAt > 60_000) {
    clockAt = t;
    clockValue = storeNowInputValue(new Date(t));
  }
  return clockValue;
}

const noSubscribe = () => () => {};

function useStoreNow(): string | null {
  return useSyncExternalStore(noSubscribe, currentStoreNow, () => null);
}

/* ------------------------------------------------------------------ */
/*  Shape                                                              */
/* ------------------------------------------------------------------ */

/**
 * Everything as strings, because that is what the inputs hold and what the
 * server action parses. The two dates are formatted into the store's time zone
 * on the server, so the value is identical on both renders.
 */
export type PromotionFormValues = {
  title: string;
  body: string;
  ctaLabel: string;
  ctaHref: string;
  kind: PromotionKind;
  isActive: boolean;
  startsAt: string;
  endsAt: string;
  priority: string;
  dismissDays: string;
};

export const EMPTY_PROMOTION: PromotionFormValues = {
  title: "",
  body: "",
  ctaLabel: "",
  ctaHref: "",
  // Banner is the default because it is the quiet surface. Turning a
  // promotion into a popup should be a decision, not what happens when you
  // leave a field alone.
  kind: "banner",
  isActive: true,
  startsAt: "",
  endsAt: "",
  priority: "0",
  dismissDays: "7",
};

/** Blank or nonsense reads as zero rather than NaN. */
function intOr(value: string, fallback: number): number {
  const n = Number(value.trim());
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : fallback;
}

/* ------------------------------------------------------------------ */
/*  The form                                                           */
/* ------------------------------------------------------------------ */

export function PromotionForm({
  promotionId,
  initial,
  /**
   * The id of the promotion actually on the storefront right now, straight
   * from `getLivePromotion()`. Without it this editor can only say "eligible";
   * with it, it can say whether something else is outranking this one.
   */
  liveId = null,
}: {
  /** Absent when creating. */
  promotionId?: string;
  initial: PromotionFormValues;
  liveId?: string | null;
}) {
  const router = useRouter();
  const [v, setV] = useState<PromotionFormValues>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = useStoreNow();

  const set = useCallback(
    <K extends keyof PromotionFormValues>(key: K, value: PromotionFormValues[K]) => {
      setV((prev) => ({ ...prev, [key]: value }));
      setError(null);
    },
    []
  );

  const dirty = useMemo(
    () => JSON.stringify(v) !== JSON.stringify(initial),
    [v, initial]
  );

  const windowError = promotionWindowError(v.startsAt, v.endsAt);
  const status = now ? promotionStatusFor(v.isActive, v.startsAt, v.endsAt, now) : null;

  /**
   * The one sentence that answers "is this on the store?". It has to
   * distinguish four things the admin will otherwise confuse: paused, waiting
   * for its start date, eligible-but-outranked, and genuinely showing.
   */
  const verdict = useMemo(() => {
    if (!status) return null;
    if (windowError) {
      return { tone: "bad" as const, line: "This window can never happen — nothing will show." };
    }
    if (status === "paused") {
      return { tone: "idle" as const, line: "Switched off. Nothing is shown to anyone." };
    }
    if (status === "scheduled") {
      return {
        tone: "wait" as const,
        line: `Waiting. It starts ${formatStoreInputValue(v.startsAt)} IST.`,
      };
    }
    if (status === "expired") {
      return {
        tone: "bad" as const,
        line: `Finished. It ended ${formatStoreInputValue(v.endsAt)} IST.`,
      };
    }
    if (!promotionId || dirty) {
      return { tone: "good" as const, line: "This goes live the moment you save." };
    }
    if (liveId && liveId !== promotionId) {
      return {
        tone: "wait" as const,
        line: "Eligible, but another promotion has a higher priority and is showing instead.",
      };
    }
    return {
      tone: "good" as const,
      line: "Live right now — this is what shoppers are seeing.",
    };
  }, [status, windowError, v.startsAt, v.endsAt, promotionId, dirty, liveId]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (windowError) return setError(windowError);

    setSaving(true);
    setError(null);

    const fd = new FormData();
    fd.append("title", v.title);
    fd.append("body", v.body);
    fd.append("ctaLabel", v.ctaLabel);
    fd.append("ctaHref", v.ctaHref);
    fd.append("kind", v.kind);
    fd.append("isActive", String(v.isActive));
    fd.append("startsAt", v.startsAt);
    fd.append("endsAt", v.endsAt);
    fd.append("priority", v.priority);
    fd.append("dismissDays", v.dismissDays);

    const res = promotionId
      ? await updatePromotion(promotionId, fd)
      : await createPromotion(fd);
    setSaving(false);

    if (res.success) {
      router.push("/admin/promotions");
      router.refresh();
    } else {
      setError(res.error ?? "Couldn't save the promotion.");
    }
  }

  const dismissDays = intOr(v.dismissDays, 7);

  return (
    <form onSubmit={onSubmit} className="min-w-0 max-w-3xl space-y-4">
      {/* ---- Is this on the store? ---- */}
      <div
        className={cn(
          "min-w-0 rounded-2xl border p-4 sm:p-5",
          verdict?.tone === "good" && "border-success/40 bg-success/10",
          verdict?.tone === "wait" && "border-accent/30 bg-accent/5",
          verdict?.tone === "bad" && "border-danger/30 bg-danger/10",
          (!verdict || verdict.tone === "idle") && "border-border bg-muted/30"
        )}
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="eyebrow text-muted-foreground">Status</p>
          {status && <PromotionStatusPill status={status} />}
        </div>
        {/*
          `min-h` reserves the line before the clock is read, so the card
          doesn't jump a row taller a frame after hydration.
        */}
        <p className="mt-2 min-h-6 break-words font-serif text-lg leading-snug">
          {verdict?.line ?? ""}
        </p>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger"
        >
          {error}
        </p>
      )}

      {/* ---- Preview ---- */}
      <Card
        title="Preview"
        tip="The real banner and popup components, rendered with your copy. What you see here is what the storefront draws — including the announcement bar above it, so you can check the two bars sit together."
      >
        <PromotionPreview
          title={v.title}
          body={v.body}
          ctaLabel={v.ctaLabel}
          ctaHref={v.ctaHref}
          kind={v.kind}
          dismissDays={dismissDays}
        />
      </Card>

      {/* ---- Message ---- */}
      <Card
        title="Message"
        tip="Keep it short. This store's voice is restrained, and a promotion that shouts reads as someone else's template dropped into the page."
      >
        <Field
          label="Title"
          required
          tip="The line that carries the offer. It is the only part that survives on a narrow phone, so put the substance here — '20% off everything', not 'Big news!'."
          hint={`${v.title.trim().length}/60`}
        >
          {(id) => (
            <input
              id={id}
              value={v.title}
              onChange={(e) => set("title", e.target.value)}
              required
              maxLength={60}
              placeholder="20% off the new drop"
              className="input"
            />
          )}
        </Field>

        <Field
          label="Detail"
          required
          tip="One line that qualifies the offer — the dates, the code, who it applies to. It is hidden on the banner below 640px and always shown in the popup."
          hint={`${v.body.trim().length}/160`}
        >
          {(id) => (
            <textarea
              id={id}
              value={v.body}
              onChange={(e) => set("body", e.target.value)}
              required
              maxLength={160}
              rows={2}
              placeholder="Ends Sunday. Use code DROP20 at checkout."
              className="input"
            />
          )}
        </Field>
      </Card>

      {/* ---- Call to action ---- */}
      <Card
        title="Button"
        tip="Optional. Without one the promotion is a statement; with one it is a route somewhere. On the banner the whole strip becomes the link."
      >
        <Field
          label="Button label"
          tip="Two or three words. Leave it blank for a promotion that only announces something — a shipping cut-off, say."
        >
          {(id) => (
            <input
              id={id}
              value={v.ctaLabel}
              onChange={(e) => set("ctaLabel", e.target.value)}
              maxLength={24}
              placeholder="Shop the drop"
              className="input"
            />
          )}
        </Field>

        {/* Only exists once there is a label to hang it on. */}
        {v.ctaLabel.trim() && (
          <Field
            label="Button link"
            required
            tip="A path on this store, starting with a slash — /shop, /product/oversized-tee. A full https:// address works too and opens in a new tab. Anything else is refused."
          >
            {(id) => (
              <input
                id={id}
                value={v.ctaHref}
                onChange={(e) => set("ctaHref", e.target.value)}
                required
                placeholder="/shop"
                spellCheck={false}
                autoComplete="off"
                className="input font-mono text-xs"
              />
            )}
          </Field>
        )}
      </Card>

      {/* ---- Where it shows ---- */}
      <Card
        title="Where it shows"
        tip="A banner sits in the page chrome and waits to be read. A popup covers the page and demands an answer. Reach for the popup rarely — it is the loudest thing this store can do."
      >
        <Field
          label="Surface"
          tip="Banner is the quiet strip under the announcement bar. Popup appears once per visitor after they have shown some interest. 'Both' does exactly that — the same offer, twice, so dismissing the banner also silences the popup."
        >
          <Segmented
            ariaLabel="Where the promotion appears"
            value={v.kind}
            onChange={(next) => set("kind", next)}
            options={[
              { value: "banner", label: "Banner" },
              { value: "popup", label: "Popup" },
              { value: "both", label: "Both" },
            ]}
          />
        </Field>

        <Field
          label="Hide for (days) after dismissal"
          tip="How long a shopper who waves this away stays free of it. 0 means it comes back on their next visit — use that only for something genuinely time-critical. The popup also counts merely being shown as a dismissal, so it never appears twice in the same window."
          hint={promotionDismissSummary(dismissDays)}
        >
          {(id) => (
            <input
              id={id}
              type="number"
              inputMode="numeric"
              min={0}
              max={365}
              step={1}
              value={v.dismissDays}
              onChange={(e) => set("dismissDays", e.target.value)}
              className="input"
            />
          )}
        </Field>
      </Card>

      {/* ---- When it runs ---- */}
      <Card
        title="When it runs"
        tip="Both times are India Standard Time, whatever time zone the server runs in. Leave either blank for an open end."
      >
        <SwitchRow
          label="Active"
          tip="Off takes the promotion off the store immediately without deleting it. This is the safe way to stop one — the next promotion in priority order takes over."
          checked={v.isActive}
          onChange={(on) => set("isActive", on)}
          icon={<Megaphone className="h-4 w-4 shrink-0 text-muted-foreground" />}
          detail={v.isActive ? "Eligible to show" : "Switched off"}
        />

        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          <Field
            label="Starts"
            tip="Nothing shows before this moment, so a sale can be set up days ahead and left to switch itself on. Blank means it starts as soon as it is saved."
          >
            {(id) => (
              <input
                id={id}
                type="datetime-local"
                value={v.startsAt}
                onChange={(e) => set("startsAt", e.target.value)}
                className="input"
              />
            )}
          </Field>

          <Field
            label="Ends"
            tip="The promotion disappears the instant the clock reaches this, so use 23:59 for 'the last day of the month'. Blank means it runs until you switch it off."
          >
            {(id) => (
              <input
                id={id}
                type="datetime-local"
                value={v.endsAt}
                onChange={(e) => set("endsAt", e.target.value)}
                className={cn("input", windowError && "border-danger")}
                aria-invalid={windowError ? true : undefined}
              />
            )}
          </Field>
        </div>

        {windowError ? (
          <p role="alert" className="text-xs text-danger">
            {windowError}
          </p>
        ) : (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {promotionWindowSummary(
                formatStoreInputValue(v.startsAt),
                formatStoreInputValue(v.endsAt)
              )}{" "}
              (IST)
            </span>
          </p>
        )}

        <Field
          label="Priority"
          tip="Only one promotion is ever on the store. When two are eligible at the same time the higher priority wins, and if they tie, the more recently created one does. Leave it at 0 unless you are deliberately overriding something."
        >
          {(id) => (
            <input
              id={id}
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              step={1}
              value={v.priority}
              onChange={(e) => set("priority", e.target.value)}
              className="input"
            />
          )}
        </Field>
      </Card>

      {/* ---- Save ---- */}
      <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={() => router.push("/admin/promotions")}
          className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-border px-5 text-[11px] font-medium uppercase tracking-widest transition-colors hover:bg-muted"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving || !!windowError}
          className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg bg-foreground px-6 text-[11px] font-medium uppercase tracking-widest text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "Saving…" : promotionId ? "Save changes" : "Create promotion"}
        </button>
      </div>
    </form>
  );
}
