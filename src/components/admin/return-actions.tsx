"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  BadgeIndianRupee,
  Check,
  Loader2,
  RefreshCw,
  Truck,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatINR } from "@/lib/utils";
import { InfoTip } from "@/components/store/info-tip";
import {
  decideReturn,
  markRefundPaid,
  retryReturnPickup,
  setReturnStatus,
} from "@/app/actions/returns";
import {
  REFUND_METHODS,
  REFUND_METHOD_LABEL,
  REFUND_PAYMENT_LABEL,
  RETURN_STATUS_LABEL,
  isRefundMethod,
  type RefundBreakdown,
  type RefundMethod,
  type ReturnStatus,
} from "@/lib/returns";

/** What an approved return can move to next, in the order it actually happens.
 *  "refunded" is absent on purpose — it only arrives through the payout panel,
 *  which is what captures the reference. */
const NEXT_STATUS: Partial<Record<ReturnStatus, ReturnStatus[]>> = {
  approved: ["picked_up", "cancelled"],
  picked_up: ["received", "cancelled"],
  received: ["cancelled"],
};

/** The statuses from which money can be sent. */
const PAYABLE: ReturnStatus[] = ["approved", "picked_up", "received"];

/**
 * What was written on the row at the moment of the decision — the figures a
 * later change to the fee settings must not move. Null on a request that was
 * approved before refunds existed; the server backfills those at payout.
 */
export type RecordedRefund = {
  gross: number | null;
  fee: number | null;
  net: number | null;
  method: string | null;
  upi: string | null;
};

export function ReturnActions({
  id,
  status,
  refund,
  recorded,
  nimbusError,
  nimbusOrderId,
  nimbusEnabled,
}: {
  id: string;
  status: ReturnStatus;
  /**
   * The refund as `computeRefund` works it out right now, from the live order
   * row. This is a preview only: the server recomputes it inside
   * `decideReturn`, so nothing shown here is trusted on submit.
   */
  refund: RefundBreakdown;
  /** What is already stored — the figures a later settings change must not move. */
  recorded: RecordedRefund;
  nimbusError: string | null;
  nimbusOrderId: string | null;
  nimbusEnabled: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"idle" | "approve" | "reject" | "payout">("idle");
  const [note, setNote] = useState("");
  const [bookPickup, setBookPickup] = useState(true);

  // Approval form
  const [override, setOverride] = useState(false);
  const [overrideNet, setOverrideNet] = useState(String(refund.net));
  const [overrideReason, setOverrideReason] = useState("");
  const [method, setMethod] = useState<RefundMethod>(refund.method);
  const [upi, setUpi] = useState("");

  // Payout form
  // A row written before refunds existed can hold a method that is no longer
  // in the list ("bank"); fall back rather than putting an unselectable value
  // in the box and failing validation on submit.
  const [payMethod, setPayMethod] = useState<RefundMethod>(
    recorded.method && isRefundMethod(recorded.method)
      ? recorded.method
      : refund.method
  );
  const [payUpi, setPayUpi] = useState(recorded.upi ?? "");
  const [reference, setReference] = useState("");

  function decide(approve: boolean) {
    start(async () => {
      try {
        const res = await decideReturn({
          id,
          approve,
          adminNote: note,
          refundOverride: approve && override ? Number(overrideNet || 0) : null,
          overrideReason: approve && override ? overrideReason : undefined,
          refundMethod: approve ? method : null,
          refundUpi: approve && upi.trim() ? upi.trim() : undefined,
          bookPickup: approve && bookPickup,
        });
        if (!res.ok) {
          toast.error(res.error || "Could not update");
          return;
        }
        setMode("idle");
        setNote("");
        if (approve) {
          const paid = res.refund ? ` · refund ${formatINR(res.refund.net)}` : "";
          // The approval and the courier booking succeed independently — say so,
          // rather than letting a green toast imply a pickup that isn't booked.
          if (res.pickupBooked) toast.success(`Approved${paid} · reverse pickup drafted`);
          else if (res.pickupIssue)
            toast.warning(`Approved${paid}, but pickup not booked: ${res.pickupIssue}`, {
              duration: 8000,
            });
          else toast.success(`Approved${paid}`);
        } else {
          toast.success("Rejected — the customer sees your note");
        }
        router.refresh();
      } catch {
        toast.error("Could not update — are you still signed in?");
      }
    });
  }

  function payout() {
    start(async () => {
      try {
        const res = await markRefundPaid({
          id,
          method: payMethod,
          upi: payUpi.trim() || undefined,
          reference: reference.trim() || undefined,
          note: note.trim() || undefined,
        });
        if (!res.ok) {
          toast.error(res.error || "Could not record the refund");
          return;
        }
        setMode("idle");
        setNote("");
        setReference("");
        toast.success(
          res.net > 0 ? `Refund of ${formatINR(res.net)} recorded` : "Return closed"
        );
        router.refresh();
      } catch {
        toast.error("Could not record the refund — are you still signed in?");
      }
    });
  }

  function move(next: ReturnStatus) {
    start(async () => {
      const res = await setReturnStatus(id, next);
      if (res.ok) {
        toast.success(`Marked ${RETURN_STATUS_LABEL[next].toLowerCase()}`);
        router.refresh();
      } else {
        toast.error(res.error || "Could not update");
      }
    });
  }

  function retry() {
    start(async () => {
      const res = await retryReturnPickup(id);
      if (res.ok) {
        toast.success("Reverse pickup drafted");
        router.refresh();
      } else {
        toast.error(res.error || "Still could not book the pickup");
        router.refresh();
      }
    });
  }

  // 44px minimum height on every control: this queue is worked from a phone,
  // and approve/reject sit next to each other.
  const btn =
    "inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";

  const netNow = override ? Math.max(0, Number(overrideNet || 0)) : refund.net;

  /* ------------------------------------------------------ pending: decide it */
  if (status === "pending") {
    if (mode === "idle") {
      return (
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            <button
              type="button"
              onClick={() => setMode("approve")}
              className={`${btn} border-success/40 bg-success/10 text-success hover:bg-success/20`}
            >
              <Check className="h-3.5 w-3.5" /> Approve
            </button>
            <button
              type="button"
              onClick={() => setMode("reject")}
              className={`${btn} border-danger/40 text-danger hover:bg-danger/10`}
            >
              <X className="h-3.5 w-3.5" /> Reject
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            Refund if approved: <b>{formatINR(refund.net)}</b>
          </p>
        </div>
      );
    }

    if (mode === "reject") {
      return (
        <Panel title="Reject this return">
          <textarea
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why are you rejecting? The customer will see this."
            className="input resize-none text-xs"
          />
          <Actions
            confirmLabel="Reject return"
            variant="outline"
            disabled={pending || !note.trim()}
            pending={pending}
            onConfirm={() => decide(false)}
            onCancel={() => setMode("idle")}
          />
        </Panel>
      );
    }

    return (
      <Panel title="Approve this return">
        <Breakdown refund={refund} />

        <textarea
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note for the customer (optional) — e.g. pickup in 2–3 days"
          className="input resize-none text-xs"
        />

        {/* min-h-11: the whole row is the tap target, not the 14px box. */}
        <label className="flex min-h-11 cursor-pointer items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={override}
            onChange={(e) => {
              setOverride(e.target.checked);
              if (e.target.checked) setOverrideNet(String(refund.net));
            }}
            className="h-3.5 w-3.5 accent-[var(--accent)]"
          />
          <span>Pay something different</span>
          <InfoTip term="Override the refund">
            Use this for goodwill or to cover return postage. It cannot go above{" "}
            {formatINR(refund.payable)} — that is all this customer has actually
            paid in, and refunding more would send out money the store never
            received.
          </InfoTip>
        </label>

        {override && (
          <div className="space-y-2 rounded-lg border border-accent/40 bg-accent/5 p-2.5">
            <label className="block">
              <span className="label text-[11px]">Pay the customer</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={refund.payable}
                value={overrideNet}
                onChange={(e) => setOverrideNet(e.target.value)}
                className="input h-11 text-xs"
              />
            </label>
            <label className="block">
              <span className="label text-[11px]">Why? *</span>
              <input
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="e.g. covering their courier charge"
                className="input h-11 text-xs"
              />
            </label>
            <p className="text-[11px] text-muted-foreground">
              Computed {formatINR(refund.net)} · most this order can pay{" "}
              {formatINR(refund.payable)}
            </p>
          </div>
        )}

        <label className="block">
          <span className="label text-[11px]">Send it back by</span>
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as RefundMethod)}
            className="input h-11 text-xs"
          >
            {REFUND_METHODS.map((m) => (
              <option key={m} value={m}>
                {REFUND_METHOD_LABEL[m]}
              </option>
            ))}
          </select>
        </label>

        {method === "upi" && (
          <label className="block">
            <span className="label text-[11px]">
              Customer&apos;s UPI ID
              <InfoTip term="UPI ID">
                Leave it blank and the customer is asked for it on their own
                order page once this is approved. Fill it in only if they have
                already given it to you over the phone.
              </InfoTip>
            </span>
            <input
              value={upi}
              onChange={(e) => setUpi(e.target.value)}
              placeholder="name@bank — optional"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="input h-11 text-xs"
            />
          </label>
        )}

        <p className="text-[11px] text-muted-foreground">
          {netNow > 0 ? (
            <>
              <b>{formatINR(netNow)}</b> is recorded now and paid out separately —
              money never moves from this screen.
            </>
          ) : (
            <>Nothing is payable on this return.</>
          )}
        </p>

        <label className="flex min-h-11 cursor-pointer items-start gap-2 py-2 text-xs">
          <input
            type="checkbox"
            checked={bookPickup}
            onChange={(e) => setBookPickup(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 accent-[var(--accent)]"
            disabled={!nimbusEnabled}
          />
          <span>
            Draft a reverse pickup in NimbusPost
            {!nimbusEnabled && (
              <span className="block text-muted-foreground">
                NimbusPost is switched off in settings — book it manually.
              </span>
            )}
          </span>
        </label>

        <Actions
          confirmLabel="Approve return"
          variant="primary"
          disabled={pending || (override && !overrideReason.trim())}
          pending={pending}
          onConfirm={() => decide(true)}
          onCancel={() => setMode("idle")}
        />
      </Panel>
    );
  }

  /* ------------------------------------------------------------- pay it out */
  if (mode === "payout") {
    const owed = recorded.net ?? refund.net;
    return (
      <Panel title="Record the refund">
        <p className="text-[11px] text-muted-foreground">
          Send the money first, then record it here. This does not move money.
        </p>

        <div className="space-y-1 rounded-lg border border-border bg-muted/40 p-2.5 text-[11px]">
          {recorded.gross != null && (
            <Line label="Gross" value={formatINR(recorded.gross)} />
          )}
          {recorded.fee != null && recorded.fee > 0 && (
            <Line label="Return fee" value={`− ${formatINR(recorded.fee)}`} />
          )}
          <Line label="Agreed at approval" value={formatINR(owed)} strong />
        </div>

        <label className="block">
          <span className="label text-[11px]">Paid by</span>
          <select
            value={payMethod}
            onChange={(e) => setPayMethod(e.target.value as RefundMethod)}
            className="input h-11 text-xs"
          >
            {REFUND_METHODS.map((m) => (
              <option key={m} value={m}>
                {REFUND_METHOD_LABEL[m]}
              </option>
            ))}
          </select>
        </label>

        {payMethod === "upi" && (
          <label className="block">
            <span className="label text-[11px]">UPI ID it went to</span>
            <input
              value={payUpi}
              onChange={(e) => setPayUpi(e.target.value)}
              placeholder="name@bank"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              className="input h-11 text-xs"
            />
            {!recorded.upi && (
              <span className="mt-1 block text-[11px] text-muted-foreground">
                The customer hasn&apos;t entered one yet.
              </span>
            )}
          </label>
        )}

        <label className="block">
          <span className="label text-[11px]">
            Reference / UTR
            <InfoTip term="Reference">
              The transaction number from your bank, UPI app or Razorpay. The
              customer is shown it on their order page so they can match it to
              their statement.
            </InfoTip>
          </span>
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="e.g. 431299887766"
            className="input h-11 text-xs"
          />
        </label>

        <textarea
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Anything to add for the customer (optional)"
          className="input resize-none text-xs"
        />

        <Actions
          confirmLabel="Mark refunded"
          variant="primary"
          disabled={pending}
          pending={pending}
          onConfirm={payout}
          onCancel={() => setMode("idle")}
        />
      </Panel>
    );
  }

  /* ------------------------------------------- decided: move it along / retry */
  const next = NEXT_STATUS[status] ?? [];
  return (
    <div className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        {next.map((s) => (
          <button
            key={s}
            type="button"
            disabled={pending}
            onClick={() => move(s)}
            className={`${btn} ${
              s === "cancelled"
                ? "border-border text-muted-foreground hover:bg-muted"
                : "border-border hover:bg-muted"
            }`}
          >
            Mark {RETURN_STATUS_LABEL[s].toLowerCase()}
          </button>
        ))}
        {PAYABLE.includes(status) && (
          <button
            type="button"
            disabled={pending}
            onClick={() => setMode("payout")}
            className={`${btn} border-success/40 bg-success/10 text-success hover:bg-success/20`}
          >
            <BadgeIndianRupee className="h-3.5 w-3.5" /> Record refund
          </button>
        )}
      </div>

      {nimbusError && status === "approved" && (
        <div className="rounded-lg border border-danger/40 bg-danger/5 p-2.5 text-[11px] text-danger">
          <p className="flex items-start gap-1.5">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              <b>Pickup not booked.</b> {nimbusError}
            </span>
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={retry}
            className="mt-2 inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border border-danger/40 px-3 font-medium hover:bg-danger/10"
          >
            <RefreshCw className="h-3 w-3" /> Retry pickup
          </button>
        </div>
      )}

      {nimbusOrderId && !nimbusError && (
        <p className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Truck className="h-3.5 w-3.5" />
          Reverse draft <b>{nimbusOrderId}</b> — book the courier in NimbusPost.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="w-full min-w-0 max-w-md space-y-2 rounded-xl border border-border bg-background p-3">
      <p className="text-xs font-medium">{title}</p>
      {children}
    </div>
  );
}

function Actions({
  confirmLabel,
  variant,
  disabled,
  pending,
  onConfirm,
  onCancel,
}: {
  confirmLabel: string;
  variant: "primary" | "outline";
  disabled: boolean;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex gap-2 pt-1">
      <Button
        type="button"
        size="sm"
        variant={variant}
        disabled={disabled}
        onClick={onConfirm}
        className="min-h-11 flex-1 text-xs"
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : confirmLabel}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={onCancel}
        className="min-h-11 text-xs"
      >
        Cancel
      </Button>
    </div>
  );
}

/**
 * Gross → fee → net, with every deduction named. Shown *before* the approve
 * button so the owner never confirms a number they haven't seen broken down.
 */
function Breakdown({ refund }: { refund: RefundBreakdown }) {
  return (
    <div className="space-y-1 rounded-lg border border-border bg-muted/40 p-2.5 text-[11px]">
      <p className="flex items-center justify-between gap-2 font-medium">
        <span>Refund</span>
        <span className="rounded-full bg-background px-2 py-0.5 font-normal text-muted-foreground">
          {REFUND_PAYMENT_LABEL[refund.payment]}
        </span>
      </p>

      <Line label="Item value" value={formatINR(refund.lineValue)} />
      {refund.discountShare > 0 && (
        <Line
          label="Share of order discount"
          value={`− ${formatINR(refund.discountShare)}`}
        />
      )}
      {refund.advanceForfeited > 0 && (
        <Line
          label="Advance kept (part-paid)"
          value={`− ${formatINR(refund.advanceForfeited)}`}
          tip="On a part-paid order the online advance isn't refundable. This line's pro-rata share of it is held back, so returning everything forfeits the whole advance and returning one item forfeits its share."
        />
      )}
      {refund.alreadyRefunded > 0 && (
        <Line
          label="Already refunded on this order"
          value={formatINR(refund.alreadyRefunded)}
        />
      )}
      <Line label="Gross" value={formatINR(refund.gross)} strong />
      <Line
        label={refund.feeWaived ? "Return fee (waived — our fault)" : "Return fee"}
        value={refund.fee > 0 ? `− ${formatINR(refund.fee)}` : "—"}
      />
      <div className="border-t border-border pt-1">
        <Line label="Pay the customer" value={formatINR(refund.net)} strong />
      </div>
      {refund.feeCapped && (
        <p className="text-danger">
          The fee is larger than the refund — capped, so nothing is owed rather
          than the customer being billed.
        </p>
      )}
      {refund.collected <= 0 && (
        <p className="text-danger">
          No money was ever collected for this order, so there is nothing to
          refund.
        </p>
      )}
    </div>
  );
}

function Line({
  label,
  value,
  strong,
  tip,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tip?: string;
}) {
  return (
    <p
      className={`flex items-start justify-between gap-2 ${
        strong ? "font-medium text-foreground" : "text-muted-foreground"
      }`}
    >
      <span className="min-w-0">
        {label}
        {tip && <InfoTip term={label}>{tip}</InfoTip>}
      </span>
      <span className="shrink-0 tabular-nums">{value}</span>
    </p>
  );
}
