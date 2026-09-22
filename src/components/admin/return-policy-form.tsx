"use client";

/**
 * The store-wide return & refund policy, as a mountable component.
 *
 * ## Why this file exists
 *
 * The policy used to be a form hard-wired into `/admin/returns?tab=policy`.
 * The owner wants **one settings home**, so the editor is extracted here and
 * the returns tab now shows a read-only summary that links across. Two exports,
 * because the two callers need different things:
 *
 *   `ReturnPolicyCard`   — self-contained. Owns its draft, has its own Save,
 *                          calls `updateReturnDefaults` itself. Renders a
 *                          `<div>`, never a `<form>`, so it is safe to drop
 *                          inside a settings page that already has one.
 *   `ReturnPolicyFields` — controlled. No state, no save button. For a caller
 *                          that wants these fields inside its own dirty
 *                          tracking and its own Save.
 *
 * ## The decision tree, which the UI mirrors exactly
 *
 *   returnsEnabled OFF  → nothing else applies. Window, reasons, refund mode,
 *                         fees, waiver and customer copy are all ABSENT, not
 *                         disabled: a greyed-out fee box still reads as a rule
 *                         that is in force.
 *   returnsEnabled ON   → window + catalogue default + accepted reasons.
 *     refund mode FULL  → no fee fields, and no our-fault waiver — there is no
 *                         fee for it to waive.
 *     refund mode FEE   → percent + flat (summed), and the waiver, which is the
 *                         one control that turns a fee-charging store into a
 *                         full refund for damaged / wrong-item returns.
 *   partial payments OFF at checkout → the part-paid advance switch is absent.
 *                         No order can ever be part-paid, so the rule is dead.
 *
 * Every hidden control is hidden because it *cannot apply*, and each branch
 * says so in one line where a reader might otherwise wonder where it went.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, Field, Segmented, SwitchRow } from "@/components/admin/form-kit";
import { InfoTip } from "@/components/store/info-tip";
import { Disclosure } from "@/components/store/disclosure";
import { formatINR } from "@/lib/utils";
import { updateReturnDefaults } from "@/app/actions/returns";
import {
  applyRefundMode,
  computeRefund,
  formatReturnDate,
  isOurFaultReason,
  normaliseReturnReasons,
  refundModeOf,
  type RefundMode,
} from "@/lib/returns";
import {
  ReasonListEditor,
  toReasonRows,
  type ReasonRow,
} from "@/components/admin/reason-list-editor";

/* ------------------------------------------------------------------ types */

/**
 * Exactly the columns `updateReturnDefaults` writes — no more, no strings
 * standing in for numbers. The in-flight text of a half-typed number is this
 * component's private problem, not the caller's.
 */
export type ReturnPolicyValues = {
  returnsEnabled: boolean;
  defaultReturnable: boolean;
  returnWindowDays: number;
  returnReasons: string[];
  returnPolicyNote: string;
  refundFeePercent: number;
  refundFeeFlat: number;
  partialAdvanceRefundable: boolean;
  waiveRefundFeeOnOurFault: boolean;
  refundPolicyNote: string;
  defaultReturnsInfo: string;
};

/**
 * Read-only context. These are **not** editable here — each is owned by another
 * screen — but the tree needs them to know which controls can apply at all.
 */
export type ReturnPolicyFacts = {
  /**
   * `SiteSettings.partialEnabled`, owned by Settings → Payments. When partial
   * payment is off, no order can carry an online advance, so the "refund the
   * advance" rule is unreachable and its switch is not rendered.
   */
  partialEnabled: boolean;
  /** How the catalogue currently answers "returnable?" — inherit / yes / no. */
  returnableSplit?: { inherit: number; yes: number; no: number; total: number };
};

const WINDOW_MIN = 1;
const WINDOW_MAX = 90;
const FEE_PERCENT_MAX = 50;
const FEE_FLAT_MAX = 10_000;

const clampInt = (raw: unknown, min: number, max: number, fallback: number) => {
  const n = Math.trunc(Number(raw));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/* -------------------------------------------------------- controlled body */

export function ReturnPolicyFields({
  value,
  onChange,
  facts,
  todayISO,
  disabled = false,
}: {
  value: ReturnPolicyValues;
  onChange: (next: ReturnPolicyValues) => void;
  facts: ReturnPolicyFacts;
  /**
   * Today, stamped on the server. The "closes on" preview is computed from it
   * rather than `new Date()` in the render body, so server and client markup
   * agree and the date can't drift across hydration.
   */
  todayISO: string;
  disabled?: boolean;
}) {
  const set = <K extends keyof ReturnPolicyValues>(
    key: K,
    v: ReturnPolicyValues[K]
  ) => onChange({ ...value, [key]: v });

  /* ---- numeric drafts -------------------------------------------------
     A number input the caller re-renders from a parsed value cannot be
     cleared: delete the last digit and it snaps back to 0 under the caret.
     The raw text lives here; the parent only ever sees a clamped number. */
  const [draft, setDraft] = useState<Record<string, string>>({});
  const text = (key: keyof ReturnPolicyValues, n: number) =>
    draft[key] ?? String(n);
  const typed = (key: keyof ReturnPolicyValues, raw: string) =>
    setDraft((d) => ({ ...d, [key]: raw }));
  const settled = (key: keyof ReturnPolicyValues) =>
    setDraft((d) => {
      const next = { ...d };
      delete next[key];
      return next;
    });

  /* ---- reason rows ----------------------------------------------------
     `ReasonListEditor` keys rows by a generated id so renaming then moving a
     reason doesn't remount the input under the caret. Rebuilding those rows
     from `value.returnReasons` on every render would throw that away, so the
     rows are state — resynced only when the incoming list differs from what we
     last emitted (which is what a post-save normalisation echo looks like). */
  const [rows, setRows] = useState<ReasonRow[]>(() =>
    toReasonRows(value.returnReasons)
  );
  const emitted = useRef<string[]>(value.returnReasons);
  useEffect(() => {
    const incoming = value.returnReasons;
    const same =
      incoming.length === emitted.current.length &&
      incoming.every((r, i) => r === emitted.current[i]);
    if (same) return;
    emitted.current = incoming;
    setRows(toReasonRows(incoming));
  }, [value.returnReasons]);

  function setReasonRows(next: ReasonRow[]) {
    setRows(next);
    const values = next.map((r) => r.value);
    emitted.current = values;
    set("returnReasons", values);
  }

  /* ---- derived --------------------------------------------------------- */
  const days = clampInt(value.returnWindowDays, WINDOW_MIN, WINDOW_MAX, 7);
  const closesOn = formatReturnDate(
    new Date(new Date(todayISO).getTime() + days * 86_400_000)
  );
  const mode: RefundMode = refundModeOf(value);

  // A worked example in rupees, so the owner never has to do the percentage in
  // their head to know what a setting costs them.
  const refundRules = {
    refundFeePercent: value.refundFeePercent,
    refundFeeFlat: value.refundFeeFlat,
    partialAdvanceRefundable: value.partialAdvanceRefundable,
    waiveRefundFeeOnOurFault: value.waiveRefundFeeOnOurFault,
  };
  const example = (reason: string, amountPaid: number, balanceDue: number) =>
    computeRefund({
      order: {
        total: 1000,
        amountPaid,
        balanceDue,
        subtotal: 1000,
        discountTotal: 0,
        status: "delivered",
        paymentStatus: balanceDue > 0 ? "partial" : "paid",
      },
      lines: [{ unitPrice: 1000, quantity: 1 }],
      settings: refundRules,
      reason,
    });
  // Not memoised: `computeRefund` is pure integer arithmetic over one line, and
  // three calls per render cost far less than the dependency list needed to
  // memoise them correctly — which is exactly the kind of list that goes stale.
  const prepaid = example("Wrong size", 1000, 0);
  const ourFault = example("Damaged or defective", 1000, 0);
  const partPaid = example("Wrong size", 200, 800);

  // The owner's own reason list, split by the rule that actually decides it.
  // This is the whole point of requirement 2: the waiver stops being a toggle
  // whose effect you have to imagine and becomes a visible partition.
  const split = useMemo(() => {
    const live = normaliseReturnReasons(value.returnReasons);
    return {
      waived: live.filter(isOurFaultReason),
      charged: live.filter((r) => !isOurFaultReason(r)),
    };
  }, [value.returnReasons]);

  const bullets = (s: string) => s.split("\n").filter((l) => l.trim()).length;

  return (
    <div className={disabled ? "pointer-events-none space-y-4 opacity-60" : "space-y-4"}>
      {/* ── 1. The master switch, and what depends on it ────────────────── */}
      <Card
        title="Accepting returns"
        tip="The master switch. It sits above every other rule here and above every product's own setting — off means no return can be raised, whatever a product says."
      >
        <SwitchRow
          label="Accept return requests"
          checked={value.returnsEnabled}
          onChange={(v) => set("returnsEnabled", v)}
          icon={
            value.returnsEnabled ? (
              <ShieldCheck className="h-4 w-4 text-success" />
            ) : (
              <ShieldOff className="h-4 w-4 text-danger" />
            )
          }
          detail={
            value.returnsEnabled
              ? `${days}-day window · closes ${closesOn} for a parcel delivered today`
              : "The form is hidden on every order; a request posted directly is refused"
          }
        />

        {!value.returnsEnabled ? (
          // The one line that explains the absence, so nothing looks lost.
          <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            Returns are off, so the window, the accepted reasons, the refund
            rules and the customer-facing wording are all hidden — none of them
            can apply while no return can be raised. Requests already in
            progress carry on as normal.
          </p>
        ) : (
          <>
            <SwitchRow
              label="Products are returnable by default"
              checked={value.defaultReturnable}
              onChange={(v) => set("defaultReturnable", v)}
              tip="Applies to every product that hasn't set its own answer. A product can override it, and a made-to-order piece is never returnable unless its own switch says so."
              detail={
                facts.returnableSplit
                  ? `${facts.returnableSplit.inherit} of ${facts.returnableSplit.total} products follow this`
                  : undefined
              }
            />

            <Field
              label="Return window"
              tip={`How many days after delivery a customer can still raise a return. Counted from the courier's delivery scan, or the order date when an order was marked delivered by hand. A parcel delivered today can be returned up to, but not including, ${closesOn}.`}
              hint={
                <>
                  Delivered today → open until <b>{closesOn}</b>. Later requests
                  are refused by the server, not just hidden.
                </>
              }
            >
              {(id) => (
                <div className="flex items-center gap-2">
                  <input
                    id={id}
                    type="number"
                    inputMode="numeric"
                    min={WINDOW_MIN}
                    max={WINDOW_MAX}
                    value={text("returnWindowDays", days)}
                    onChange={(e) => {
                      typed("returnWindowDays", e.target.value);
                      set(
                        "returnWindowDays",
                        clampInt(e.target.value, WINDOW_MIN, WINDOW_MAX, days)
                      );
                    }}
                    onBlur={() => settled("returnWindowDays")}
                    className="input h-11 w-24"
                  />
                  <span className="text-sm text-muted-foreground">days</span>
                </div>
              )}
            </Field>
          </>
        )}
      </Card>

      {/* Everything past here is meaningless while returns are off. */}
      {value.returnsEnabled && (
        <>
          {/* ── 2. Money back ─────────────────────────────────────────────── */}
          <Card
            title="Money back"
            tip="What a customer gets when a return is approved. The figure is recorded on the request at the moment you approve it — changing this later never rewrites a refund that has already gone out."
          >
            <Field
              label="On an approved return"
              tip="Full refund pays back the value of the returned goods. Keep a fee holds a slice of it back to cover handling and the return courier."
            >
              <Segmented<RefundMode>
                ariaLabel="Refund mode"
                value={mode}
                // `Segmented`'s own options are `min-h-9`, which is 36px inside a
                // 44px track — under the touch floor on the phone this is worked
                // from. Raised here rather than in form-kit, which is shared.
                className="[&_[role=radio]]:min-h-11 sm:[&_[role=radio]]:min-h-9"
                onChange={(next) =>
                  onChange({ ...value, ...applyRefundMode(next, value) })
                }
                options={[
                  { value: "full", label: "Full refund" },
                  { value: "fee", label: "Keep a fee" },
                ]}
              />
            </Field>

            {mode === "full" ? (
              <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                Every approved return pays back the full value of the goods, so
                there is no fee to set and nothing to waive. Shipping is never
                refunded — the parcel was still carried.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap gap-3">
                  <Field
                    label="We keep"
                    className="flex-1 basis-32"
                    tip="A slice of the refund the store holds back. Added to the flat amount beside it — both apply."
                  >
                    {(id) => (
                      <div className="flex items-center gap-2">
                        <input
                          id={id}
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={FEE_PERCENT_MAX}
                          value={text("refundFeePercent", value.refundFeePercent)}
                          onChange={(e) => {
                            typed("refundFeePercent", e.target.value);
                            set(
                              "refundFeePercent",
                              clampInt(e.target.value, 0, FEE_PERCENT_MAX, 0)
                            );
                          }}
                          onBlur={() => settled("refundFeePercent")}
                          className="input h-11 min-w-0 flex-1"
                        />
                        <span className="text-sm text-muted-foreground">%</span>
                      </div>
                    )}
                  </Field>

                  <Field
                    label="…plus a flat"
                    className="flex-1 basis-32"
                    tip="A fixed amount kept on top of the percentage. If the two together come to more than the refund, the customer is simply paid nothing — they are never billed."
                  >
                    {(id) => (
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">₹</span>
                        <input
                          id={id}
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={FEE_FLAT_MAX}
                          value={text("refundFeeFlat", value.refundFeeFlat)}
                          onChange={(e) => {
                            typed("refundFeeFlat", e.target.value);
                            set(
                              "refundFeeFlat",
                              clampInt(e.target.value, 0, FEE_FLAT_MAX, 0)
                            );
                          }}
                          onBlur={() => settled("refundFeeFlat")}
                          className="input h-11 min-w-0 flex-1"
                        />
                      </div>
                    )}
                  </Field>
                </div>

                {/* The waiver only exists because a fee does. */}
                <SwitchRow
                  label="Full refund anyway when it's our fault"
                  checked={value.waiveRefundFeeOnOurFault}
                  onChange={(v) => set("waiveRefundFeeOnOurFault", v)}
                  tip="Damaged, defective, wrong item or not as described. On those the fee is dropped entirely and the customer gets the whole amount back, whatever the two numbers above say."
                  detail={
                    value.waiveRefundFeeOnOurFault
                      ? `${split.waived.length} of your ${split.waived.length + split.charged.length} reasons refund in full`
                      : "The fee applies to every reason, including damage"
                  }
                />

                <ReasonSplit
                  waived={split.waived}
                  charged={split.charged}
                  active={value.waiveRefundFeeOnOurFault}
                />
              </>
            )}

            {/* Unreachable unless checkout actually offers partial payment. */}
            {facts.partialEnabled ? (
              <SwitchRow
                label="Refund the online advance on part-paid orders"
                checked={value.partialAdvanceRefundable}
                onChange={(v) => set("partialAdvanceRefundable", v)}
                tip="Off (the usual setting): the advance is kept and only the cash the courier collected comes back. The advance is spread across the lines pro rata, so returning one of three items forfeits a third of it."
                detail={
                  value.partialAdvanceRefundable
                    ? "The advance comes back too"
                    : "The advance is kept; only the cash collected is returned"
                }
              />
            ) : (
              <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                Partial payment is switched off at checkout, so no order can
                carry an online advance and the rule for refunding one is hidden.
              </p>
            )}

            {/* Rupees, not percentages. */}
            <div className="space-y-1 rounded-lg border border-border bg-muted/40 p-3 text-xs">
              <p className="font-medium">On a ₹1,000 return</p>
              <ExampleRow label="Paid in full online" value={prepaid.net} />
              <ExampleRow
                label="Arrived damaged"
                value={ourFault.net}
                note={
                  ourFault.waivedFee > 0
                    ? `${formatINR(ourFault.waivedFee)} fee waived`
                    : undefined
                }
              />
              {facts.partialEnabled && (
                <ExampleRow
                  label="₹200 advance + ₹800 on delivery"
                  value={partPaid.net}
                  note={
                    partPaid.advanceForfeited > 0
                      ? `${formatINR(partPaid.advanceForfeited)} advance kept`
                      : undefined
                  }
                />
              )}
            </div>
          </Card>

          {/* ── 3. Set once, so folded away ───────────────────────────────── */}
          <Fold
            label="Accepted reasons"
            summary={`${split.waived.length + split.charged.length} offered`}
          >
            <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
              What a customer may pick on the return form. Add, rename, reorder
              or remove — an empty list falls back to the standard five rather
              than leaving the dropdown blank.
            </p>
            <ReasonListEditor rows={rows} onChange={setReasonRows} disabled={disabled} />
          </Fold>

          <Fold
            label="Wording customers see"
            summary={`${bullets(value.returnPolicyNote) + bullets(value.refundPolicyNote) + bullets(value.defaultReturnsInfo)} lines`}
          >
            <div className="space-y-4">
              <Lines
                label="Rules on the return form"
                tip="Shown above the form, before a customer fills it in. One rule per line."
                placeholder="Items must be unworn, unwashed and returned with their original tags."
                value={value.returnPolicyNote}
                onChange={(v) => set("returnPolicyNote", v)}
                empty="Nothing shown above the form"
                rows={3}
              />
              <Lines
                label="Rules beside the refund figure"
                tip="Shown next to the amount the customer is quoted on the return form. One rule per line."
                placeholder="Prepaid orders are refunded to the original payment method within 5–7 working days."
                value={value.refundPolicyNote}
                onChange={(v) => set("refundPolicyNote", v)}
                empty="Nothing shown beside the refund figure"
                rows={3}
              />
              <Lines
                label="Returns & Refunds block on product pages"
                tip="The block under the buy button. One point per line; blank hides it. A product can override this with its own copy, and it is never shown on a product that isn't returnable."
                placeholder="One point per line"
                value={value.defaultReturnsInfo}
                onChange={(v) => set("defaultReturnsInfo", v)}
                empty="Hidden on product pages"
                rows={4}
              />
            </div>
          </Fold>
        </>
      )}
    </div>
  );
}

/* --------------------------------------------------------- self-contained */

/**
 * The drop-in: state, save and toasts included.
 *
 * Renders a `<div>` with a `type="button"` submit, **not** a `<form>` — nesting
 * a form inside the settings form would be invalid HTML and the inner submit
 * would be swallowed by the outer one.
 */
export function ReturnPolicyCard({
  initial,
  facts,
  todayISO,
  onSaved,
}: {
  initial: ReturnPolicyValues;
  facts: ReturnPolicyFacts;
  todayISO: string;
  /** Called after a successful save, with what the server actually stored. */
  onSaved?: (saved: ReturnPolicyValues) => void;
}) {
  const router = useRouter();
  const [value, setValue] = useState<ReturnPolicyValues>(initial);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const res = await updateReturnDefaults(value);
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error || "Could not save");
      return;
    }
    // Show what was actually stored: blanks and duplicates are dropped on the
    // server and an empty list falls back to the standard reasons. Reflecting
    // that back stops the form claiming an edit the database didn't keep.
    const saved: ReturnPolicyValues = {
      ...value,
      returnReasons: res.returnReasons ?? normaliseReturnReasons(value.returnReasons),
    };
    setValue(saved);
    onSaved?.(saved);
    toast.success("Return policy saved");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <ReturnPolicyFields
        value={value}
        onChange={setValue}
        facts={facts}
        todayISO={todayISO}
        disabled={saving}
      />
      <div className="flex justify-end">
        <Button
          type="button"
          onClick={save}
          disabled={saving}
          className="min-h-11"
        >
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Saving…
            </>
          ) : (
            "Save policy"
          )}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ parts */

/** A bordered card whose body is folded away — for what is set once. */
function Fold({
  label,
  summary,
  children,
}: {
  label: string;
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-2xl border border-border bg-card px-4 sm:px-5">
      <Disclosure label={label} summary={summary}>
        {children}
      </Disclosure>
    </section>
  );
}

function ExampleRow({
  label,
  value,
  note,
}: {
  label: string;
  value: number;
  note?: string;
}) {
  return (
    <p className="flex flex-wrap justify-between gap-x-2 text-muted-foreground">
      <span className="min-w-0">{label}</span>
      <span className="shrink-0 tabular-nums text-foreground">
        {note && <span className="mr-1.5 font-normal text-muted-foreground">{note} ·</span>}
        customer gets {formatINR(value)}
      </span>
    </p>
  );
}

/**
 * The owner's own reason list, partitioned by `isOurFaultReason` — the same
 * function `computeRefund` uses, so this can never disagree with the money.
 *
 * Without it the waiver is a switch whose effect you have to imagine against a
 * list on another screen. With it, "this one is full refund because it's our
 * fault" is readable at a glance, per reason.
 */
function ReasonSplit({
  waived,
  charged,
  active,
}: {
  waived: string[];
  charged: string[];
  active: boolean;
}) {
  if (!active) {
    return (
      <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
        The fee is charged on every reason, including damaged and wrong-item
        returns. Turn the switch on to refund those in full.
      </p>
    );
  }
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <ReasonGroup
        title="Full refund — our fault"
        tone="success"
        reasons={waived}
        empty="None of your reasons currently count as our fault."
        tip="Matched on the words in the reason itself — damaged, defective, broken, faulty, wrong item, missing, not as described. “Wrong size” is deliberately not one: that is the shopper guessing, not us mis-picking."
      />
      <ReasonGroup
        title="Fee applies"
        tone="muted"
        reasons={charged}
        empty="Every reason you offer refunds in full."
      />
    </div>
  );
}

function ReasonGroup({
  title,
  tone,
  reasons,
  empty,
  tip,
}: {
  title: string;
  tone: "success" | "muted";
  reasons: string[];
  empty: string;
  tip?: string;
}) {
  return (
    <div
      className={`min-w-0 rounded-lg border p-2.5 ${
        tone === "success" ? "border-success/40 bg-success/5" : "border-border bg-muted/40"
      }`}
    >
      <p className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-widest">
        <span className={tone === "success" ? "text-success" : "text-muted-foreground"}>
          {title}
        </span>
        {tip && <InfoTip term={title}>{tip}</InfoTip>}
      </p>
      {reasons.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-1 space-y-0.5">
          {reasons.map((r) => (
            <li key={r} className="break-words text-xs text-foreground">
              {r}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Lines({
  label,
  tip,
  placeholder,
  value,
  onChange,
  empty,
  rows,
}: {
  label: string;
  tip: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  empty: string;
  rows: number;
}) {
  const count = value.split("\n").filter((l) => l.trim()).length;
  return (
    <Field
      label={label}
      tip={tip}
      hint={count === 0 ? empty : `${count} line${count === 1 ? "" : "s"}`}
    >
      {(id) => (
        <textarea
          id={id}
          rows={rows}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="input resize-y font-mono text-xs leading-relaxed"
        />
      )}
    </Field>
  );
}
