"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  BadgeIndianRupee,
  Check,
  ExternalLink,
  Loader2,
  PackageCheck,
  RefreshCw,
  Truck,
  Wallet,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatINR } from "@/lib/utils";
import { InfoTip } from "@/components/store/info-tip";
import {
  bookReturnPickupAction,
  decideReturn,
  markRefundPaid,
  quoteReturnPickupAction,
  retryReturnPickup,
  setReturnStatus,
  syncReturnPickupAction,
} from "@/app/actions/returns";
import {
  PARCEL_HOLDER_LABEL,
  REFUND_METHODS,
  REFUND_METHOD_LABEL,
  REFUND_PAYMENT_LABEL,
  REVERSE_LEG_LABEL,
  RETURN_STATUS_LABEL,
  isRefundMethod,
  outcomeOfRefundMethod,
  parcelHolder,
  refundMovesMoney,
  reverseLegOf,
  type RefundBreakdown,
  type RefundMethod,
  type ReturnOutcome,
  type ReturnStatus,
} from "@/lib/returns";

/** What `quoteReturnPickupAction` hands back, kept local so no server-only type crosses. */
type PickupQuote = {
  options: {
    courierId: string;
    name: string;
    total: number;
    tatDays: number | null;
    type: string | null;
  }[];
  walletBalance: number | null;
  pincode: string;
};

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
  nimbusAwb,
  nimbusCourier,
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
  /** The REVERSE AWB. Never the order's — see lib/nimbus-returns.ts. */
  nimbusAwb: string | null;
  nimbusCourier: string | null;
  nimbusEnabled: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<
    "idle" | "approve" | "reject" | "payout" | "book"
  >("idle");
  const [note, setNote] = useState("");
  const [bookPickup, setBookPickup] = useState(true);

  // Booking panel
  const [quote, setQuote] = useState<PickupQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [courierId, setCourierId] = useState<string>("");

  // Payout panel — "I know the goods aren't back".
  const [payAnyway, setPayAnyway] = useState(false);

  /* Where the parcel physically is, from the same function the server enforces
     `markRefundPaid` with. The status word alone can't answer this: `approved`
     is payable, and an approved return is normally still in the customer's
     hallway. */
  const leg = reverseLegOf({ status, nimbusOrderId, nimbusAwb, nimbusError });
  const holder = parcelHolder(leg);
  const goodsBack = holder === "store";

  // Approval form.
  //
  // The method opens on **what the customer asked for** (it was written onto
  // `refundMethod` when they raised the request), not on a default. Approving a
  // size exchange as a refund now takes a deliberate change of this control.
  const [override, setOverride] = useState(false);
  // Seeded from `gross`, not `net`. `net` is already zero when the customer
  // asked for a replacement, and seeding the override box with 0 would offer a
  // ₹0 goodwill payment the moment the admin switched the outcome to a refund.
  const [overrideNet, setOverrideNet] = useState(String(refund.gross));
  const [overrideReason, setOverrideReason] = useState("");
  const [method, setMethod] = useState<RefundMethod>(
    recorded.method && isRefundMethod(recorded.method)
      ? recorded.method
      : refund.method
  );
  const [upi, setUpi] = useState("");

  /** True while the chosen method actually pays money out. */
  const paysOut = refundMovesMoney(method);
  /** What the customer originally asked for, for the one-line reminder. */
  const asked = outcomeOfRefundMethod(recorded.method);

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
          // An override is only ever sent when money is actually moving — the
          // server refuses one on a replacement, and sending it here would be
          // asking for that refusal.
          refundOverride:
            approve && paysOut && override ? Number(overrideNet || 0) : null,
          overrideReason: approve && paysOut && override ? overrideReason : undefined,
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
          const paid = res.refund
            ? res.refund.net > 0
              ? ` · refund ${formatINR(res.refund.net)}`
              : res.refund.outcome === "replace"
                ? " · replacement, no refund"
                : res.refund.outcome === "exchange"
                  ? " · different size, no refund"
                  : ""
            : "";
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
          acknowledgeNotReceived: payAnyway,
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

  /**
   * Open the booking confirmation. The quote is fetched *before* the panel can
   * be confirmed so the charge is named rather than implied — booking is the
   * only action in this flow that spends the NimbusPost wallet.
   */
  function openBooking() {
    setMode("book");
    setQuote(null);
    setQuoteError(null);
    start(async () => {
      const res = await quoteReturnPickupAction(id);
      if (res.ok) {
        setQuote(res.quote);
        setCourierId(res.quote.options[0]?.courierId ?? "");
      } else {
        setQuoteError(res.error);
      }
    });
  }

  function confirmBooking() {
    start(async () => {
      try {
        const res = await bookReturnPickupAction(id, courierId || null);
        if (!res.ok) {
          toast.error(res.error || "Could not book the pickup", { duration: 8000 });
          router.refresh();
          return;
        }
        setMode("idle");
        toast.success(
          `Pickup booked — AWB ${res.awb}${res.courier ? ` (${res.courier})` : ""}`
        );
        router.refresh();
      } catch {
        toast.error("Could not book — are you still signed in?");
      }
    });
  }

  function sync() {
    start(async () => {
      const res = await syncReturnPickupAction(id);
      if (!res.ok) {
        toast.error(res.error || "Could not reach NimbusPost");
        return;
      }
      if (res.outcome === "booked") {
        toast.success(`Booked in NimbusPost — AWB ${res.awb} pulled across`);
      } else if (res.outcome === "tracked") {
        toast.success(res.raw ? `Courier says: ${res.raw}` : "No new scan yet");
      } else if (res.outcome === "not-booked") {
        toast.info("Still an unbooked draft in NimbusPost.");
      } else {
        toast.info("No reverse pickup is staged for this return.");
      }
      router.refresh();
    });
  }

  // 44px minimum height on every control: this queue is worked from a phone,
  // and approve/reject sit next to each other.
  const btn =
    "inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";

  /**
   * What approving *right now* would pay.
   *
   * Derived from `gross`, not from `refund.net`. The breakdown arrives from the
   * server already resolved against the **stored** outcome, so on a replacement
   * its `net` is zero — and switching the method in this panel to a refund
   * would then have shown "nothing is payable" while `decideReturn`, which
   * recomputes against the method it is sent, went on to write the full amount.
   * A panel that under-promises and then overpays is worse than one that never
   * mentioned a figure. `gross` is the refundable goods value and is the same
   * whichever outcome is chosen, which is exactly what this needs.
   */
  const netNow = !paysOut
    ? 0
    : override
      ? Math.max(0, Number(overrideNet || 0))
      : refund.gross;

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
            {asked === "refund" ? (
              <>
                Refund if approved: <b>{formatINR(refund.net)}</b>
              </>
            ) : (
              <>
                Customer wants{" "}
                <b>{asked === "replace" ? "a replacement" : "a different size"}</b>{" "}
                — no refund
              </>
            )}
            {refund.storePaysReturnShipping && (
              <span className="block text-accent">
                Our fault — we pay the return leg
              </span>
            )}
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
        {/* `payNow` rather than `refund.net`: the sum has to follow the method
            chosen below, which the server-computed breakdown cannot know. */}
        <Breakdown refund={refund} payNow={netNow} outcome={outcomeOfRefundMethod(method)} />

        <textarea
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note for the customer (optional) — e.g. pickup in 2–3 days"
          className="input resize-none text-xs"
        />

        {/* ── How this return is settled ──────────────────────────────────
            First, because it decides whether anything below is about money at
            all. It opens on what the customer asked for; changing it is a
            deliberate act, which is the point. */}
        <label className="block">
          <span className="label text-[11px]">
            Settle this return by
            <InfoTip term="Settling a return">
              The customer chose this when they raised the request. A
              replacement or a size exchange sends a parcel and records a ₹0
              refund — change it here only if you have agreed something
              different with them.
            </InfoTip>
          </span>
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
          {outcomeOfRefundMethod(method) !== asked && (
            <span className="mt-1 block text-[11px] text-accent">
              The customer asked for{" "}
              {asked === "refund"
                ? "a refund"
                : asked === "replace"
                  ? "a replacement"
                  : "a different size"}
              . Say why in the note above.
            </span>
          )}
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

        {/* Absent, not dimmed: there is no amount to override on a return that
            pays nothing, and a greyed-out money box reads as a rule in force. */}
        {paysOut && (
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
              Use this for goodwill or to cover a courier charge the customer
              paid. It cannot go above {formatINR(refund.payable)} — that is all
              this customer has actually paid in, and refunding more would send
              out money the store never received.
            </InfoTip>
          </label>
        )}

        {paysOut && override && (
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

        <p className="text-[11px] text-muted-foreground">
          {netNow > 0 ? (
            <>
              <b>{formatINR(netNow)}</b> is recorded now and paid out separately —
              money never moves from this screen.
            </>
          ) : paysOut ? (
            <>Nothing is payable on this return.</>
          ) : (
            <>
              No money moves. Send the{" "}
              {method === "exchange" ? "replacement size" : "replacement"} once
              the item is back.
            </>
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

  /* ------------------------------------------------- book the reverse pickup */
  if (mode === "book") {
    const chosen = quote?.options.find((o) => o.courierId === courierId);
    const balance = quote?.walletBalance ?? null;
    // Only ever a warning, never a block: the wallet figure and the rate are
    // both estimates, and refusing on them would stop a legitimate booking.
    const tight = balance != null && chosen != null && balance < chosen.total;

    return (
      <Panel title="Book this pickup — this charges your wallet">
        {pending && !quote && !quoteError && (
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking rates and
            wallet…
          </p>
        )}

        {quoteError && (
          <p className="rounded-lg border border-border bg-muted/40 p-2.5 text-[11px] text-muted-foreground">
            Couldn&apos;t price this lane ({quoteError}). You can still book —
            NimbusPost will allocate a courier and charge the going rate.
          </p>
        )}

        {quote && quote.options.length > 0 && (
          <label className="block">
            <span className="label text-[11px]">
              Courier
              <InfoTip term="Reverse rate">
                NimbusPost only prices outward from your warehouse, so these are
                the same lane quoted the other way — the right parcel and the
                right pincode ({quote.pincode}), but an estimate, not the exact
                charge. Leave it as the cheapest unless you have a reason.
              </InfoTip>
            </span>
            <select
              value={courierId}
              onChange={(e) => setCourierId(e.target.value)}
              className="input h-11 text-xs"
            >
              {quote.options.map((o) => (
                <option key={o.courierId} value={o.courierId}>
                  {o.name} · ~{formatINR(o.total)}
                  {o.tatDays ? ` · ${o.tatDays}d` : ""}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="space-y-1 rounded-lg border border-border bg-muted/40 p-2.5 text-[11px]">
          <Line
            label="Estimated charge"
            value={chosen ? `~${formatINR(chosen.total)}` : "Set by NimbusPost"}
            strong
          />
          {balance != null && (
            <Line label="Wallet balance" value={formatINR(balance)} />
          )}
          <p className="pt-0.5 text-muted-foreground">
            Booking allocates a courier, generates the reverse AWB and takes the
            money from your NimbusPost wallet. It cannot be undone from here.
          </p>
        </div>

        {tight && (
          <p className="flex items-start gap-1.5 rounded-lg border border-danger/40 bg-danger/5 p-2.5 text-[11px] text-danger">
            <Wallet className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Your wallet holds {formatINR(balance!)} and this looks like about{" "}
              {formatINR(chosen!.total)}. Top up first or the booking will be
              refused.
            </span>
          </p>
        )}

        <Actions
          confirmLabel={
            chosen ? `Book & charge ~${formatINR(chosen.total)}` : "Book & generate AWB"
          }
          variant="primary"
          disabled={pending}
          pending={pending}
          onConfirm={confirmBooking}
          onCancel={() => setMode("idle")}
        />
      </Panel>
    );
  }

  /* ------------------------------------------------------------- pay it out */
  if (mode === "payout") {
    // What was agreed, not what today's rules would produce. A replacement or
    // an exchange settled at zero, so this panel closes the request instead of
    // paying anything — the labels say which, rather than saying "refund" over
    // a ₹0 payout.
    const settledOutcome = outcomeOfRefundMethod(recorded.method);
    const owed = settledOutcome === "refund" ? (recorded.net ?? refund.net) : 0;
    return (
      <Panel
        title={
          settledOutcome === "refund"
            ? "Record the refund"
            : settledOutcome === "replace"
              ? "Close — replacement sent"
              : "Close — different size sent"
        }
      >
        <p className="text-[11px] text-muted-foreground">
          {settledOutcome === "refund"
            ? "Send the money first, then record it here. This does not move money."
            : "Recording this closes the request. No money is paid on a replacement or an exchange."}
        </p>

        {/*
          Where the goods actually are, stated beside the payout rather than
          used to block it. `approved` is a payable status and an approved
          return's parcel is normally still with the customer, so without this
          the commonest early-refund mistake is completely invisible.
        */}
        <div
          className={`space-y-1 rounded-lg border p-2.5 text-[11px] ${
            goodsBack
              ? "border-success/40 bg-success/5"
              : "border-accent/40 bg-accent/5"
          }`}
        >
          <p className="flex items-start gap-1.5 font-medium">
            {goodsBack ? (
              <PackageCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
            ) : (
              <Truck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
            )}
            <span>{PARCEL_HOLDER_LABEL[holder]}</span>
          </p>
          {/* Only the evidence the headline doesn't already carry. For a parcel
              that is back, the leg label says "Back with you" too, and printing
              it twice makes the panel look broken. */}
          {(!goodsBack || nimbusAwb) && (
            <p className="break-all text-muted-foreground">
              {[goodsBack ? null : REVERSE_LEG_LABEL[leg], nimbusAwb ? `AWB ${nimbusAwb}` : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
        </div>

        {!goodsBack && owed > 0 && (
          <label className="flex min-h-11 cursor-pointer items-start gap-2 py-1 text-xs">
            <input
              type="checkbox"
              checked={payAnyway}
              onChange={(e) => setPayAnyway(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 accent-[var(--accent)]"
            />
            <span>
              Pay before it arrives
              <InfoTip term="Paying early">
                Perfectly legitimate — goodwill, a trusted customer, or an item
                not worth collecting. It is a tick rather than a block so nobody
                is pushed into marking a return &ldquo;received&rdquo; when it
                isn&apos;t, and it is written into the timeline so the decision
                can be found later.
              </InfoTip>
            </span>
          </label>
        )}

        {/* The sum is only worth printing when there is one. On a replacement
            the whole box would read "₹0 · ₹0", which is noise pretending to be
            an audit trail. */}
        {settledOutcome === "refund" ? (
          <div className="space-y-1 rounded-lg border border-border bg-muted/40 p-2.5 text-[11px]">
            {recorded.gross != null && (
              <Line label="Refundable goods value" value={formatINR(recorded.gross)} />
            )}
            {/* Only ever present on a request decided under the old fee policy. */}
            {recorded.fee != null && recorded.fee > 0 && (
              <Line label="Return fee (legacy)" value={`− ${formatINR(recorded.fee)}`} />
            )}
            <Line label="Agreed at approval" value={formatINR(owed)} strong />
          </div>
        ) : (
          <p className="rounded-lg border border-border bg-muted/40 p-2.5 text-[11px] text-muted-foreground">
            Agreed at approval:{" "}
            <b className="text-foreground">
              {settledOutcome === "replace"
                ? "a replacement, no refund"
                : "a different size, no refund"}
            </b>
            . Send it once the item is back.
          </p>
        )}

        <label className="block">
          <span className="label text-[11px]">
            {settledOutcome === "refund" ? "Paid by" : "Settled as"}
          </span>
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

        {/* Absent on a replacement: there is no payment to reference, and a
            blank UTR box on a settlement that moves no money is a control that
            cannot apply. */}
        {refundMovesMoney(payMethod) && (
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
        )}

        <textarea
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Anything to add for the customer (optional)"
          className="input resize-none text-xs"
        />

        <Actions
          // Same rule the server enforces in `markRefundPaid`, so the button
          // and the endpoint agree instead of the endpoint rejecting a press
          // the UI had just invited.
          confirmLabel={
            !goodsBack && owed > 0
              ? "Refund early — goods not back"
              : settledOutcome === "refund"
                ? "Mark refunded"
                : "Close this return"
          }
          variant="primary"
          disabled={pending || (!goodsBack && owed > 0 && !payAnyway)}
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
        {/* One button, two meanings named apart: a refund is money leaving,
            a replacement is a request being closed. Same panel, honest label. */}
        {PAYABLE.includes(status) &&
          (outcomeOfRefundMethod(recorded.method) === "refund" ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => setMode("payout")}
              className={`${btn} border-success/40 bg-success/10 text-success hover:bg-success/20`}
            >
              <BadgeIndianRupee className="h-3.5 w-3.5" /> Record refund
            </button>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={() => setMode("payout")}
              className={`${btn} border-border hover:bg-muted`}
            >
              <Check className="h-3.5 w-3.5" />{" "}
              {outcomeOfRefundMethod(recorded.method) === "replace"
                ? "Replacement sent"
                : "New size sent"}
            </button>
          ))}
      </div>

      {/*
        The reverse leg. Draft-first, exactly like forward dispatch: the draft
        is staged free at approval, and booking — the one call that spends the
        wallet — is a separate, named act behind its own confirmation.

        Every control here is conditional on the leg it belongs to rather than
        rendered-and-dimmed: there is no Book button without a draft, none once
        an AWB exists, and no Retry on a shipment that has already been paid for.
      */}
      {leg !== "none" && (
        <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-2.5 text-[11px]">
          <p className="flex items-start gap-1.5">
            <Truck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span>
              <b>{REVERSE_LEG_LABEL[leg]}</b>
              {nimbusCourier && (
                <span className="text-muted-foreground"> · {nimbusCourier}</span>
              )}
            </span>
          </p>

          {nimbusAwb ? (
            <p className="break-all text-muted-foreground">
              Reverse AWB{" "}
              <a
                href={`https://track.nimbuspost.com/track/${nimbusAwb}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-mono text-foreground hover:text-accent"
              >
                {nimbusAwb}
                <ExternalLink className="h-3 w-3" />
              </a>
            </p>
          ) : (
            nimbusOrderId && (
              <p className="break-all text-muted-foreground">
                Draft <span className="font-mono">{nimbusOrderId}</span> —{" "}
                {goodsBack
                  ? // The parcel came back another way. The draft is harmless
                    // (nothing was charged) but it is litter in the NimbusPost
                    // account, so say it is still sitting there.
                    "still unbooked in NimbusPost and never charged. Cancel it there if you don't need it."
                  : "no courier allocated and nothing charged yet."}
              </p>
            )
          )}

          {nimbusError && (
            <p className="flex items-start gap-1.5 text-danger">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{nimbusError}</span>
            </p>
          )}

          <div className="flex flex-wrap items-center gap-1.5">
            {/* Book: a draft exists, no AWB does, NimbusPost is on — and the
                goods are not already here. Paying a courier to collect a parcel
                that is back on the shelf is never the right move, so the button
                is absent rather than offered and regretted. */}
            {nimbusOrderId && !nimbusAwb && nimbusEnabled && !goodsBack && (
              <button
                type="button"
                disabled={pending}
                onClick={openBooking}
                className={`${btn} border-accent/40 bg-accent/10 text-accent hover:bg-accent/20`}
              >
                <Truck className="h-3.5 w-3.5" /> Book &amp; generate AWB
              </button>
            )}

            {/* Sync: the only way an AWB booked in the NimbusPost dashboard
                reaches us — and without it the webhook, which matches on AWB,
                can never find this return. Pointless once the parcel is back and
                no shipment was ever booked, so it goes too. */}
            {(nimbusAwb || !goodsBack) && (
              <button
                type="button"
                disabled={pending}
                onClick={sync}
                className={`${btn} border-border hover:bg-muted`}
              >
                <RefreshCw className="h-3.5 w-3.5" /> Sync from NimbusPost
              </button>
            )}

            {/* Retry re-drafts. Absent once booked: clearing the draft id then
                would orphan a courier job that has already been paid for. */}
            {nimbusError && !nimbusAwb && !goodsBack && (
              <button
                type="button"
                disabled={pending}
                onClick={retry}
                className={`${btn} border-danger/40 text-danger hover:bg-danger/10`}
              >
                <RefreshCw className="h-3.5 w-3.5" /> Retry draft
              </button>
            )}
          </div>
        </div>
      )}

      {/* No courier leg at all. Says so rather than staying silent — an approved
          return with no pickup looks finished until someone asks the customer
          where their parcel went. Drafting is free, so the button is offered
          right here; it books nothing. */}
      {leg === "none" && status === "approved" && (
        <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-2.5 text-[11px]">
          <p className="flex items-start gap-1.5">
            <Truck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span>
              <b>No pickup arranged.</b>{" "}
              <span className="text-muted-foreground">
                {nimbusEnabled
                  ? "Nothing is coming to collect this."
                  : "NimbusPost is switched off — arrange collection yourself."}
              </span>
            </span>
          </p>
          {nimbusEnabled && (
            <button
              type="button"
              disabled={pending}
              onClick={retry}
              className={`${btn} border-border hover:bg-muted`}
            >
              <Truck className="h-3.5 w-3.5" /> Draft a pickup
            </button>
          )}
        </div>
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
function Breakdown({
  refund,
  payNow,
  outcome,
}: {
  refund: RefundBreakdown;
  /** What approving right now would pay — follows the method control above. */
  payNow: number;
  /** The outcome currently selected, which may differ from the stored one. */
  outcome: ReturnOutcome;
}) {
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
      <Line label="Refundable goods value" value={formatINR(refund.gross)} strong />

      {/* What stays with the store, itemised. Not deductions from the refund —
          neither was ever part of the goods value — but the owner is asked
          "why isn't it the order total?" and this is the answer in rupees. */}
      {refund.keptShipping > 0 && (
        <Line
          label="Shipping kept"
          value={formatINR(refund.keptShipping)}
          tip="Never refunded: the parcel was carried whatever happened to the goods afterwards."
        />
      )}
      {refund.keptPaymentFee > 0 && (
        <Line
          label="Cash-handling fee kept"
          value={formatINR(refund.keptPaymentFee)}
          tip="The COD or part-payment fee charged at checkout. The courier's collection charge was paid, so it is not returned."
        />
      )}

      <div className="border-t border-border pt-1">
        <Line
          label={outcome === "refund" ? "Pay the customer" : "Money to pay"}
          value={formatINR(payNow)}
          strong
        />
      </div>

      {/* The one cost that runs the other way, named as a cost to the owner
          rather than as the absence of a deduction. */}
      {refund.storePaysReturnShipping && (
        <p className="flex items-start gap-1.5 text-accent">
          <Truck className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          <span>
            Our fault — full refund, and the return courier charge is yours. It
            lands on your NimbusPost wallet when you book the pickup.
          </span>
        </p>
      )}
      {outcome !== "refund" && (
        <p className="text-muted-foreground">
          {outcome === "replace"
            ? "Settling with a replacement, so no money is paid."
            : "Settling with a different size, so no money is paid."}
        </p>
      )}
      {outcome === "refund" && refund.collected <= 0 && (
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
