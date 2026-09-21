"use client";

/**
 * "Use store default" ⟷ "Write custom for this product".
 *
 * These columns (`materialsCare`, `shippingInfo`, `returnsInfo`, `returnable`)
 * are nullable, and NULL means *inherit from SiteSettings* — it is not the same
 * as an empty string, which is a deliberate "this product says nothing here".
 * The old editor expressed that difference as a pill whose caption changed, so
 * the two states looked like one field that happened to be greyed out.
 *
 * Two rules this component exists to enforce:
 *
 * 1. **Inheriting is an explicit switch position**, not the absence of typing.
 * 2. **Turning the switch back on writes `null`, never `""`.** Anything else
 *    silently converts "inherit" into "this product has no materials section".
 *
 * While inheriting, the store copy is shown read-only and muted so the admin can
 * see what they are getting before deciding to break away from it. It is clamped
 * behind "View more" rather than given a scrollbar, because three of these sit
 * side by side and a store default can run to a dozen bullets.
 */

import { ExpandableText } from "@/components/store/expandable-text";
import { Segmented } from "@/components/admin/form-kit";
import { InfoTip } from "@/components/store/info-tip";

/** Bullets an admin-authored block resolves to — one non-blank line each. */
function bulletCount(text: string) {
  return text.split("\n").filter((l) => l.trim()).length;
}

export function StoreDefaultText({
  label,
  tip,
  value,
  fallback,
  onChange,
}: {
  label: string;
  /** What this block is, behind the (i). */
  tip: React.ReactNode;
  /** `null` = inherit the store default. */
  value: string | null;
  /** The store-wide copy, shown read-only while inheriting. */
  fallback: string;
  onChange: (next: string | null) => void;
}) {
  const custom = value !== null;
  const points = bulletCount(custom ? value : fallback);

  return (
    <div className="flex min-w-0 flex-col rounded-lg border border-border p-3">
      <div className="flex items-center gap-1">
        <h4 className="text-sm font-medium">{label}</h4>
        <InfoTip term={label}>{tip}</InfoTip>
      </div>

      <Segmented
        ariaLabel={`${label} source`}
        className="mt-2"
        value={custom ? "custom" : "default"}
        // Switching to custom seeds the box with the store copy, so the admin
        // edits from it instead of staring at an empty field. Switching back
        // writes null — the inherit sentinel — and discards the draft, which is
        // the point: there is no half state where both exist.
        onChange={(v) => onChange(v === "custom" ? fallback : null)}
        options={[
          { value: "default", label: "Store default" },
          { value: "custom", label: "Custom" },
        ]}
      />

      {custom ? (
        <>
          <textarea
            rows={5}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="One point per line"
            aria-label={`${label} — custom copy for this product`}
            className="input mt-3 resize-y font-mono text-xs leading-relaxed"
          />
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {points === 0
              ? "Empty — this section is hidden on the product page."
              : `${points} bullet${points === 1 ? "" : "s"}`}
          </p>
        </>
      ) : (
        <div className="mt-3 min-w-0 rounded-lg bg-muted/50 px-3 py-2.5">
          {fallback.trim() ? (
            <ExpandableText
              lines={5}
              contentClassName="whitespace-pre-line font-mono text-xs leading-relaxed text-muted-foreground"
            >
              {fallback}
            </ExpandableText>
          ) : (
            <p className="text-xs text-muted-foreground">
              The store default is empty, so this section is hidden.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The boolean sibling: `returnable` is `true | false | null`, where null again
 * means inherit. Same two switch positions, so the admin learns the pattern
 * once.
 */
export function StoreDefaultChoice({
  label,
  tip,
  value,
  fallback,
  fallbackLabel,
  onChange,
  options,
}: {
  label: string;
  tip: React.ReactNode;
  /** `null` = inherit the store default. */
  value: boolean | null;
  /**
   * What the store currently says. Switching to Custom starts from it, so the
   * first click states the product's own answer without silently changing it.
   */
  fallback?: boolean;
  /** How that default reads in a sentence, e.g. "returnable". */
  fallbackLabel: string;
  onChange: (next: boolean | null) => void;
  options: { yes: string; no: string };
}) {
  const custom = value !== null;

  return (
    <div className="flex min-w-0 flex-col rounded-lg border border-border p-3">
      <div className="flex items-center gap-1">
        <h4 className="text-sm font-medium">{label}</h4>
        <InfoTip term={label}>{tip}</InfoTip>
      </div>

      <Segmented
        ariaLabel={`${label} source`}
        className="mt-2"
        value={custom ? "custom" : "default"}
        onChange={(v) => onChange(v === "custom" ? (fallback ?? true) : null)}
        options={[
          { value: "default", label: "Store default" },
          { value: "custom", label: "Custom" },
        ]}
      />

      {custom ? (
        <Segmented
          ariaLabel={label}
          className="mt-3"
          value={value ? "yes" : "no"}
          onChange={(v) => onChange(v === "yes")}
          options={[
            { value: "yes", label: options.yes },
            { value: "no", label: options.no },
          ]}
        />
      ) : (
        <p className="mt-3 rounded-lg bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
          Currently <b className="text-foreground">{fallbackLabel}</b> for the
          whole store.
        </p>
      )}
    </div>
  );
}
