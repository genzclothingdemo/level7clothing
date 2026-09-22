/**
 * The read-only view of the return policy, for `/admin/returns?tab=policy`.
 *
 * The policy **moved to Admin → Settings**: the owner wants one settings home,
 * and `SiteSettings` having two editable copies of a field is the exact failure
 * CLAUDE.md records for `defaultReturnsInfo` (two tabs open, one silent lost
 * update, no error anywhere). So this screen states the rules and links across —
 * it never edits them.
 *
 * A server component: it renders values already fetched by the page, has no
 * state, and nothing here is interactive except the link.
 */

import Link from "next/link";
import { ArrowUpRight, ShieldCheck, ShieldOff } from "lucide-react";
import { InfoTip } from "@/components/store/info-tip";
import { formatINR } from "@/lib/utils";
import { refundModeOf } from "@/lib/returns";

/** Where the editable form lives now. One constant, so the two links agree. */
export const RETURN_POLICY_HREF = "/admin/settings?tab=returns";

export function ReturnPolicySummary({
  policy,
}: {
  policy: {
    returnsEnabled: boolean;
    defaultReturnable: boolean;
    returnWindowDays: number;
    returnReasons: string[];
    refundFeePercent: number;
    refundFeeFlat: number;
    partialAdvanceRefundable: boolean;
    waiveRefundFeeOnOurFault: boolean;
    partialEnabled: boolean;
  };
}) {
  const mode = refundModeOf(policy);

  return (
    <section className="min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <h2 className="flex items-center gap-2 font-serif text-lg leading-none">
          {policy.returnsEnabled ? (
            <ShieldCheck className="h-4 w-4 text-success" />
          ) : (
            <ShieldOff className="h-4 w-4 text-danger" />
          )}
          Return policy
        </h2>
        <Link
          href={RETURN_POLICY_HREF}
          className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-border px-3 text-[11px] font-medium uppercase tracking-widest transition-colors hover:border-accent hover:text-accent sm:min-h-9"
        >
          Edit in settings <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        Set under <b>Branding &amp; settings → Returns</b>, so there is one place
        the store&apos;s rules are edited. Shown here so the queue below can be
        read against the policy that produced it.
      </p>

      <dl className="mt-4 space-y-0.5">
        <Row
          label="Return requests"
          value={policy.returnsEnabled ? "Accepted" : "Switched off"}
          tone={policy.returnsEnabled ? undefined : "warn"}
        />

        {/* Mirrors the editor's tree: with returns off, none of the rest is in
            force, so listing it would describe rules that do not apply. */}
        {!policy.returnsEnabled ? (
          <p className="mt-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            No return can be raised on any order, whatever an individual product
            says, so the window, the accepted reasons and the refund rules are
            not in force. Requests already in progress carry on as normal.
          </p>
        ) : (
          <>
            <Row
              label="Window"
              value={`${policy.returnWindowDays} days after delivery`}
              tip="Counted from the courier's delivery scan, or the order date when an order was marked delivered by hand."
            />
            <Row
              label="Catalogue default"
              value={policy.defaultReturnable ? "Returnable" : "Not returnable"}
              tip="Applies to every product that hasn't set its own answer. Change individual products below."
            />
            <Row label="Reasons offered" value={String(policy.returnReasons.length)} />
            <Row
              label="Refunds"
              value={
                mode === "full"
                  ? "Full refund"
                  : [
                      policy.refundFeePercent > 0 ? `${policy.refundFeePercent}%` : null,
                      policy.refundFeeFlat > 0 ? formatINR(policy.refundFeeFlat) : null,
                    ]
                      .filter(Boolean)
                      .join(" + ") + " kept"
              }
              tip={
                mode === "full"
                  ? "Every approved return pays back the full value of the goods. Shipping is never refunded."
                  : "The percentage and the flat amount are added together, then capped at the refund itself — a customer is never billed."
              }
            />

            {/* Only meaningful when there is a fee to waive. */}
            {mode === "fee" && (
              <Row
                label="Damaged / wrong item"
                value={
                  policy.waiveRefundFeeOnOurFault
                    ? "Full refund — fee waived"
                    : "Fee still applies"
                }
                tone={policy.waiveRefundFeeOnOurFault ? undefined : "warn"}
                tip="Reasons that read as our mistake — damaged, defective, broken, faulty, wrong item, missing, not as described."
              />
            )}

            {/* Only reachable when checkout actually offers partial payment. */}
            {policy.partialEnabled && (
              <Row
                label="Part-paid advance"
                value={policy.partialAdvanceRefundable ? "Refunded" : "Kept"}
                tip="On a part-paid order the online advance is normally kept; only the cash the courier collected comes back."
              />
            )}
          </>
        )}
      </dl>
    </section>
  );
}

function Row({
  label,
  value,
  tip,
  tone,
}: {
  label: string;
  value: string;
  tip?: string;
  tone?: "warn";
}) {
  return (
    <div className="flex min-h-8 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-border/60 py-1.5 last:border-0">
      <dt className="flex items-center text-xs text-muted-foreground">
        {label}
        {tip && <InfoTip term={label}>{tip}</InfoTip>}
      </dt>
      <dd
        className={`text-xs font-medium ${tone === "warn" ? "text-danger" : "text-foreground"}`}
      >
        {value}
      </dd>
    </div>
  );
}
