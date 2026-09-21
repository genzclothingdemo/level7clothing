"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/store/info-tip";
import { formatINR } from "@/lib/utils";
import { updateReturnDefaults } from "@/app/actions/returns";
import {
  computeRefund,
  formatReturnDate,
  normaliseReturnReasons,
} from "@/lib/returns";
import {
  ReasonListEditor,
  toReasonRows,
  type ReasonRow,
} from "@/components/admin/reason-list-editor";

/**
 * The store-wide return policy — the single editor for it, and the only screen
 * that writes these fields. The same copy used to live under Branding &
 * settings › Product defaults; it moved here so returns have one owner screen,
 * and that box now links across instead of duplicating the field.
 *
 * Everything here is re-validated in `updateReturnDefaults`, and the rules it
 * sets are re-applied on every request by `evaluateReturnEligibility`. This
 * form is an editor, never a gate.
 */
export function ReturnPolicyForm({
  initial,
  todayISO,
}: {
  initial: {
    returnsEnabled: boolean;
    defaultReturnable: boolean;
    returnWindowDays: number;
    defaultReturnsInfo: string;
    returnReasons: string[];
    returnPolicyNote: string;
    refundFeePercent: number;
    refundFeeFlat: number;
    partialAdvanceRefundable: boolean;
    waiveRefundFeeOnOurFault: boolean;
    refundPolicyNote: string;
  };
  /**
   * Today, stamped on the server. The "closes on" preview is computed from it
   * rather than from `new Date()` in the render body, so the server and client
   * markup agree and the date can't drift across a hydration boundary.
   */
  todayISO: string;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({
    returnsEnabled: initial.returnsEnabled,
    defaultReturnable: initial.defaultReturnable,
    returnWindowDays: String(initial.returnWindowDays),
    defaultReturnsInfo: initial.defaultReturnsInfo,
    returnPolicyNote: initial.returnPolicyNote,
    refundFeePercent: String(initial.refundFeePercent),
    refundFeeFlat: String(initial.refundFeeFlat),
    partialAdvanceRefundable: initial.partialAdvanceRefundable,
    waiveRefundFeeOnOurFault: initial.waiveRefundFeeOnOurFault,
    refundPolicyNote: initial.refundPolicyNote,
  });
  const [reasons, setReasons] = useState<ReasonRow[]>(() =>
    toReasonRows(initial.returnReasons)
  );

  const days = Math.min(90, Math.max(1, Number(f.returnWindowDays) || 1));
  const closesOn = formatReturnDate(
    new Date(new Date(todayISO).getTime() + days * 86_400_000)
  );
  const rules = f.returnPolicyNote.split("\n").filter((l) => l.trim()).length;
  const bullets = f.defaultReturnsInfo.split("\n").filter((l) => l.trim()).length;

  const feePercent = Math.min(50, Math.max(0, Math.trunc(Number(f.refundFeePercent) || 0)));
  const feeFlat = Math.min(10000, Math.max(0, Math.trunc(Number(f.refundFeeFlat) || 0)));
  const refundRules = {
    refundFeePercent: feePercent,
    refundFeeFlat: feeFlat,
    partialAdvanceRefundable: f.partialAdvanceRefundable,
    waiveRefundFeeOnOurFault: f.waiveRefundFeeOnOurFault,
  };

  // A worked example, so the owner sees the effect of a fee in rupees rather
  // than having to do the percentage in their head. A plain prepaid ₹1,000
  // return, and the part-paid case that behaves differently.
  const examplePrepaid = computeRefund({
    order: {
      total: 1000,
      amountPaid: 1000,
      balanceDue: 0,
      subtotal: 1000,
      discountTotal: 0,
      status: "delivered",
      paymentStatus: "paid",
    },
    lines: [{ unitPrice: 1000, quantity: 1 }],
    settings: refundRules,
    reason: "Wrong size",
  });
  const examplePartial = computeRefund({
    order: {
      total: 1000,
      amountPaid: 200,
      balanceDue: 800,
      subtotal: 1000,
      discountTotal: 0,
      status: "delivered",
      paymentStatus: "partial",
    },
    lines: [{ unitPrice: 1000, quantity: 1 }],
    settings: refundRules,
    reason: "Wrong size",
  });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await updateReturnDefaults({
      returnsEnabled: f.returnsEnabled,
      defaultReturnable: f.defaultReturnable,
      returnWindowDays: days,
      defaultReturnsInfo: f.defaultReturnsInfo,
      returnPolicyNote: f.returnPolicyNote,
      returnReasons: reasons.map((r) => r.value),
      refundFeePercent: feePercent,
      refundFeeFlat: feeFlat,
      partialAdvanceRefundable: f.partialAdvanceRefundable,
      waiveRefundFeeOnOurFault: f.waiveRefundFeeOnOurFault,
      refundPolicyNote: f.refundPolicyNote,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error || "Could not save");
      return;
    }
    // Show what was actually stored — blanks and duplicates are dropped on the
    // server, and an empty list falls back to the standard reasons. Reflecting
    // that back stops the form claiming an edit the database didn't keep.
    const saved = res.returnReasons ?? normaliseReturnReasons(reasons.map((r) => r.value));
    setReasons(toReasonRows(saved));
    setF((p) => ({
      ...p,
      returnWindowDays: String(days),
      refundFeePercent: String(feePercent),
      refundFeeFlat: String(feeFlat),
    }));
    toast.success("Return policy saved");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Section
        title="Accepting returns"
        hint="The master switch sits above every other rule here and every product's own setting."
      >
        <Toggle
          label="Accept return requests"
          checked={f.returnsEnabled}
          onChange={(v) => setF((p) => ({ ...p, returnsEnabled: v }))}
          icon={
            f.returnsEnabled ? (
              <ShieldCheck className="h-4 w-4" />
            ) : (
              <ShieldOff className="h-4 w-4" />
            )
          }
        />
        {!f.returnsEnabled && (
          <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            Off: the form is hidden on every order and any request posted
            directly is refused. Existing requests still work.
          </p>
        )}

        <div
          className={
            f.returnsEnabled ? "space-y-3" : "pointer-events-none space-y-3 opacity-50"
          }
        >
          <Toggle
            label="Products are returnable by default"
            checked={f.defaultReturnable}
            onChange={(v) => setF((p) => ({ ...p, defaultReturnable: v }))}
          />
          <p className="text-xs text-muted-foreground">
            A product can override this under <b>Products → Product information</b>.
            Made-to-order pieces are never returnable unless that override says so.
          </p>
        </div>
      </Section>

      <Section
        title="Return window"
        hint="Counted from the delivery scan, or the order date when an order was marked delivered by hand."
      >
        <div className="flex flex-wrap items-end gap-3">
          <label className="block w-32">
            <span className="label">
              Days
              <InfoTip term="Return window">
                The number of days after delivery in which a customer can raise
                a return. A parcel delivered today can be returned up to, but
                not including, {closesOn}.
              </InfoTip>
            </span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={90}
              value={f.returnWindowDays}
              onChange={(e) =>
                setF((p) => ({ ...p, returnWindowDays: e.target.value }))
              }
              onBlur={() => setF((p) => ({ ...p, returnWindowDays: String(days) }))}
              className="input h-11"
            />
          </label>
          <p className="min-w-0 flex-1 basis-48 pb-3 text-xs text-muted-foreground">
            Delivered today → open until <b>{closesOn}</b>. Requests after that
            are refused, whoever sends them.
          </p>
        </div>
      </Section>

      <Section
        title="Accepted reasons"
        hint="What a customer may pick on the return form. Add, rename, reorder or remove."
      >
        <ReasonListEditor rows={reasons} onChange={setReasons} disabled={saving} />
      </Section>

      <Section
        title="Money back"
        hint="What a customer gets when a return is approved. Recorded on the request at that moment — changing this later never rewrites a refund that already went out."
      >
        <div className="flex flex-wrap gap-3">
          <label className="block min-w-0 flex-1 basis-32">
            <span className="label">
              We keep %
              <InfoTip term="Restocking percentage">
                A slice of the refund the store holds back to cover handling
                and the return courier. Leave it at 0 for a full refund.
              </InfoTip>
            </span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={50}
              value={f.refundFeePercent}
              onChange={(e) =>
                setF((p) => ({ ...p, refundFeePercent: e.target.value }))
              }
              onBlur={() =>
                setF((p) => ({ ...p, refundFeePercent: String(feePercent) }))
              }
              className="input h-11"
            />
          </label>
          <label className="block min-w-0 flex-1 basis-32">
            <span className="label">
              …plus ₹
              <InfoTip term="Flat return fee">
                A fixed amount kept on top of the percentage — the two are
                added together. If they come to more than the refund itself,
                the customer is simply paid nothing; they are never billed.
              </InfoTip>
            </span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={10000}
              value={f.refundFeeFlat}
              onChange={(e) =>
                setF((p) => ({ ...p, refundFeeFlat: e.target.value }))
              }
              onBlur={() => setF((p) => ({ ...p, refundFeeFlat: String(feeFlat) }))}
              className="input h-11"
            />
          </label>
        </div>

        <Toggle
          label="Never charge the fee when it's our mistake"
          checked={f.waiveRefundFeeOnOurFault}
          onChange={(v) => setF((p) => ({ ...p, waiveRefundFeeOnOurFault: v }))}
        />
        <p className="text-xs text-muted-foreground">
          Damaged, defective, wrong item or not as described → the fee is
          waived, whatever the two numbers above say.
        </p>

        <Toggle
          label="Refund the online advance on part-paid orders"
          checked={f.partialAdvanceRefundable}
          onChange={(v) => setF((p) => ({ ...p, partialAdvanceRefundable: v }))}
        />
        <p className="text-xs text-muted-foreground">
          Off (the usual setting): the advance is kept, and only the cash the
          courier collected is returned. Cash-on-delivery refunds are always
          paid out by UPI — the customer gives their UPI ID once you approve.
        </p>

        {/* Rupees, not percentages: the owner should never have to do the
            arithmetic to know what this setting costs them. */}
        <div className="space-y-1 rounded-lg border border-border bg-muted/40 p-3 text-xs">
          <p className="font-medium">On a ₹1,000 return</p>
          <p className="flex justify-between gap-2 text-muted-foreground">
            <span>Paid in full online</span>
            <span className="tabular-nums text-foreground">
              customer gets {formatINR(examplePrepaid.net)}
            </span>
          </p>
          <p className="flex justify-between gap-2 text-muted-foreground">
            <span>₹200 advance + ₹800 on delivery</span>
            <span className="tabular-nums text-foreground">
              customer gets {formatINR(examplePartial.net)}
            </span>
          </p>
          <p className="flex justify-between gap-2 text-muted-foreground">
            <span>Arrived damaged</span>
            <span className="tabular-nums text-foreground">
              {f.waiveRefundFeeOnOurFault
                ? "customer gets ₹1,000"
                : `customer gets ${formatINR(examplePrepaid.net)}`}
            </span>
          </p>
        </div>
      </Section>

      <Section
        title="Refund rules on the form"
        hint="Shown beside the refund figure the customer is quoted. One rule per line."
      >
        <textarea
          rows={3}
          value={f.refundPolicyNote}
          onChange={(e) => setF((p) => ({ ...p, refundPolicyNote: e.target.value }))}
          placeholder="Prepaid orders are refunded to the original payment method within 5–7 working days."
          className="input resize-y font-mono text-xs leading-relaxed"
          aria-label="Refund rules shown on the return form"
        />
        <p className="text-xs text-muted-foreground">
          {f.refundPolicyNote.split("\n").filter((l) => l.trim()).length === 0
            ? "Nothing shown beside the refund figure"
            : `${f.refundPolicyNote.split("\n").filter((l) => l.trim()).length} line(s)`}
        </p>
      </Section>

      <Section
        title="Rules on the return form"
        hint="Shown above the form, before a customer fills it in. One rule per line."
      >
        <textarea
          rows={4}
          value={f.returnPolicyNote}
          onChange={(e) => setF((p) => ({ ...p, returnPolicyNote: e.target.value }))}
          placeholder="Items must be unworn, unwashed and returned with their original tags."
          className="input resize-y font-mono text-xs leading-relaxed"
          aria-label="Rules shown on the return form"
        />
        <p className="text-xs text-muted-foreground">
          {rules === 0 ? "Nothing shown above the form" : `${rules} rule${rules === 1 ? "" : "s"}`}
        </p>
      </Section>

      <Section
        title="Product page copy"
        hint="The Returns & Refunds block under the buy button. One point per line; blank hides it."
      >
        <textarea
          rows={4}
          value={f.defaultReturnsInfo}
          onChange={(e) => setF((p) => ({ ...p, defaultReturnsInfo: e.target.value }))}
          placeholder="One point per line"
          className="input resize-y font-mono text-xs leading-relaxed"
          aria-label="Returns and refunds copy on product pages"
        />
        <p className="text-xs text-muted-foreground">
          {bullets === 0
            ? "Hidden on product pages"
            : `${bullets} bullet${bullets === 1 ? "" : "s"}`}
        </p>
      </Section>

      <div className="flex justify-end">
        <Button type="submit" disabled={saving} className="min-h-11">
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Saving…
            </>
          ) : (
            "Save policy"
          )}
        </Button>
      </div>
    </form>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h3 className="font-serif text-base">{title}</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  icon,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex min-h-11 w-full cursor-pointer items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
    >
      <span className="flex items-center gap-2 font-medium">
        {icon}
        {label}
      </span>
      <span
        className={`relative ml-2 h-6 w-11 shrink-0 rounded-full transition-colors ${
          checked ? "bg-accent" : "bg-muted-foreground/30"
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
            checked ? "left-0.5 translate-x-5" : "left-0.5"
          }`}
        />
      </span>
    </button>
  );
}
