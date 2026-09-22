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
 *   returnsEnabled OFF  → nothing else applies. Window, reasons, the refund
 *                         rules and the customer copy are all ABSENT, not
 *                         disabled: a greyed-out rule still reads as one that
 *                         is in force.
 *   returnsEnabled ON   → window + catalogue default + accepted reasons, and a
 *                         statement of how refunds work.
 *   partial payments OFF at checkout → the part-paid advance rule is absent.
 *                         No order can ever be part-paid, so it cannot apply.
 *
 * Every hidden control is hidden because it *cannot apply*, and each branch
 * says so in one line where a reader might otherwise wonder where it went.
 *
 * ## There is nothing left to configure about the money
 *
 * The four refund settings — a percentage kept, a flat amount kept, whether a
 * part-paid advance came back, and a waiver for our own mistakes — are gone.
 * The rule is fixed in `computeRefund` and stated here instead: **a return is a
 * full refund of the goods.** The store keeps only what it genuinely spent
 * (shipping, the cash-handling fee, and the advance that committed the piece),
 * and it *pays* the return leg itself when the fault was its own.
 *
 * That is a deliberate loss of flexibility. A settings screen that can quietly
 * make a refund smaller is a screen somebody has to check before they can
 * answer "what does this customer get?" — and the answer was being worked out
 * in three places. Now it is one sentence, and the card's job is to say it and
 * show it in rupees.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, ShieldCheck, ShieldOff, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, Field, SwitchRow } from "@/components/admin/form-kit";
import { InfoTip } from "@/components/store/info-tip";
import { Disclosure } from "@/components/store/disclosure";
import { formatINR } from "@/lib/utils";
import { updateReturnDefaults } from "@/app/actions/returns";
import {
  RETURN_OUTCOMES,
  RETURN_OUTCOME_BLURB,
  RETURN_OUTCOME_LABEL,
  computeRefund,
  formatReturnDate,
  isOurFaultReason,
  normaliseReturnReasons,
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
  /**
   * A worked example in rupees.
   *
   * The rule is fixed, so these are not a preview of a setting — they are the
   * proof that "full refund" survives contact with a ₹1,000 order, and the one
   * place the owner can see what *is* held back (shipping, the cash-handling
   * fee, a part-paid advance) as money rather than as prose.
   *
   * The same `computeRefund` the approval action and the customer's form run,
   * so an example on this screen can never disagree with a real payout.
   */
  const example = (
    reason: string,
    amountPaid: number,
    balanceDue: number,
    extra?: { shipping?: number; paymentFee?: number }
  ) =>
    computeRefund({
      order: {
        total: 1000 + (extra?.shipping ?? 0) + (extra?.paymentFee ?? 0),
        amountPaid,
        balanceDue,
        subtotal: 1000,
        shipping: extra?.shipping ?? 0,
        paymentFee: extra?.paymentFee ?? 0,
        discountTotal: 0,
        status: "delivered",
        paymentStatus: balanceDue > 0 ? "partial" : "paid",
      },
      lines: [{ unitPrice: 1000, quantity: 1 }],
      reason,
    });
  // Not memoised: `computeRefund` is pure integer arithmetic over one line, and
  // three calls per render cost far less than the dependency list needed to
  // memoise them correctly — which is exactly the kind of list that goes stale.
  const prepaid = example("Wrong size", 1000, 0);
  const ourFault = example("Damaged or defective", 1000, 0);
  const partPaid = example("Wrong size", 200, 800);

  // The owner's own reason list, split by the rule that actually decides it.
  // The waiver used to be a toggle whose effect you had to imagine against a
  // list on another screen; the rule it became — we carry the return leg when
  // the fault is ours — is worth showing the same way.
  const split = useMemo(() => {
    const live = normaliseReturnReasons(value.returnReasons);
    return {
      ours: live.filter(isOurFaultReason),
      theirs: live.filter((r) => !isOurFaultReason(r)),
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
            tip="What a customer gets when a return is approved. There is nothing to set: a return is a full refund of the goods. The figure is still recorded on the request at the moment you approve it, so a request decided today reads the same next month."
          >
            <div className="space-y-1 rounded-lg border border-success/40 bg-success/5 p-3">
              <p className="flex items-start gap-1.5 text-sm font-medium text-success">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>Full refund of the goods, every time.</span>
              </p>
              <p className="pl-6 text-xs leading-relaxed text-muted-foreground">
                No handling fee, no restocking cut, nothing deducted for the
                reason. What you keep is only what you actually spent.
              </p>
            </div>

            {/* What is kept, and why — stated as three facts rather than three
                switches, because none of them is a choice any more. */}
            <dl className="space-y-1.5 rounded-lg border border-border bg-muted/40 p-3 text-xs">
              <p className="font-medium">What stays with you</p>
              <Kept
                label="Shipping"
                value="Never refunded"
                tip="The parcel was carried whatever happens to the goods afterwards, so the delivery charge is a cost that was genuinely incurred."
              />
              <Kept
                label="Cash-handling fee"
                value="Never refunded"
                tip="The COD or part-payment fee charged at checkout, frozen onto the order. The courier's collection charge was paid, so it is not given back — it is shown to the customer as its own line at checkout for exactly this reason."
              />
              {facts.partialEnabled ? (
                <Kept
                  label="Part-paid advance"
                  value="Never refunded"
                  tip="The advance is what commits a made-to-order piece to production, and the checkout copy tells the customer it is non-refundable before they agree to it. It is spread across the lines pro rata, so returning one of three items forfeits a third of it."
                />
              ) : (
                <p className="text-muted-foreground">
                  Part payment is switched off at checkout, so no order can carry
                  an advance and that rule cannot apply.
                </p>
              )}
            </dl>

            {/* The one thing that runs the other way. It is a cost to the
                owner, so it is stated as one rather than buried as the absence
                of a deduction. */}
            <div className="space-y-1 rounded-lg border border-accent/40 bg-accent/5 p-3 text-xs">
              <p className="flex items-start gap-1.5 font-medium">
                <Truck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
                <span>When it&apos;s our fault, we pay the return leg.</span>
              </p>
              <p className="pl-5 leading-relaxed text-muted-foreground">
                Damaged, defective, wrong item, missing or not as described: the
                reverse courier charge is yours, not the customer&apos;s. It is
                never deducted from their refund — it shows up on your NimbusPost
                wallet when the pickup is booked, and the returns queue names it
                as a cost on those requests.
              </p>
            </div>

            <ReasonSplit ours={split.ours} theirs={split.theirs} />

            {/* Rupees, not prose. */}
            <div className="space-y-1 rounded-lg border border-border bg-muted/40 p-3 text-xs">
              <p className="font-medium">On a ₹1,000 return</p>
              <ExampleRow label="Paid in full online" value={prepaid.net} />
              <ExampleRow
                label="Arrived damaged"
                value={ourFault.net}
                note="return leg on you"
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

          {/* ── 3. What the customer may ask for ──────────────────────────── */}
          <Card
            title="What a customer can ask for"
            tip="Three outcomes, chosen by the customer on the return form. Only the first moves money — a replacement and a size exchange send a parcel instead, and the refund columns on those requests are written as zero so nothing downstream can pay one out by mistake. This is fixed in code, not a setting."
          >
            <ul className="space-y-1.5">
              {RETURN_OUTCOMES.map((o) => (
                <li
                  key={o}
                  className="rounded-lg border border-border bg-muted/30 p-2.5 text-xs"
                >
                  <p className="font-medium">{RETURN_OUTCOME_LABEL[o]}</p>
                  <p className="mt-0.5 leading-relaxed text-muted-foreground">
                    {RETURN_OUTCOME_BLURB[o]}
                  </p>
                </li>
              ))}
            </ul>
            <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
              A refund goes back the way it came where it can — to the card or
              UPI the customer paid with — and by UPI where it cannot, which is
              every cash-on-delivery order. The customer is only ever offered the
              destinations their own order can support, so nobody picks
              &ldquo;back to my card&rdquo; on an order they paid for in cash.
            </p>
          </Card>

          {/* ── 4. Set once, so folded away ───────────────────────────────── */}
          <Fold
            label="Accepted reasons"
            summary={`${split.ours.length + split.theirs.length} offered`}
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
 * function `computeRefund` uses, so this can never disagree with what the
 * returns queue flags.
 *
 * The customer's refund is identical on both sides, so this is not about their
 * money: it is about **yours**. It answers "which of the reasons I offer will
 * cost me a reverse courier leg?", which is a question the owner otherwise has
 * to ask one request at a time.
 */
function ReasonSplit({ ours, theirs }: { ours: string[]; theirs: string[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <ReasonGroup
        title="We pay the return leg"
        tone="success"
        reasons={ours}
        empty="None of your reasons currently count as our fault."
        tip="Matched on the words in the reason itself — damaged, defective, broken, faulty, wrong item, missing, not as described. “Wrong size” is deliberately not one: that is the shopper guessing, not us mis-picking."
      />
      <ReasonGroup
        title="Ordinary return"
        tone="muted"
        reasons={theirs}
        empty="Every reason you offer counts as our fault."
        tip="The refund is exactly the same — full value of the goods. The difference is only who carries the cost of collecting the parcel."
      />
    </div>
  );
}

/** One `term — value` line in "what stays with you". Never an input. */
function Kept({
  label,
  value,
  tip,
}: {
  label: string;
  value: string;
  tip: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b border-border/60 pb-1 last:border-0 last:pb-0">
      <dt className="flex items-center gap-1 text-muted-foreground">
        {label}
        <InfoTip term={label}>{tip}</InfoTip>
      </dt>
      <dd className="font-medium">{value}</dd>
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
