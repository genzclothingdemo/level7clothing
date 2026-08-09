"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  Loader2,
  RefreshCw,
  Truck,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatINR } from "@/lib/utils";
import {
  decideReturn,
  retryReturnPickup,
  setReturnStatus,
} from "@/app/actions/returns";
import { RETURN_STATUS_LABEL, type ReturnStatus } from "@/lib/returns";

/** What an approved return can move to next, in the order it actually happens. */
const NEXT_STATUS: Partial<Record<ReturnStatus, ReturnStatus[]>> = {
  approved: ["picked_up", "cancelled"],
  picked_up: ["received", "cancelled"],
  received: ["refunded", "cancelled"],
};

export function ReturnActions({
  id,
  status,
  suggestedRefund,
  nimbusError,
  nimbusOrderId,
  nimbusEnabled,
}: {
  id: string;
  status: ReturnStatus;
  /** Line total — prefilled as the refund so the common case is one click. */
  suggestedRefund: number;
  nimbusError: string | null;
  nimbusOrderId: string | null;
  nimbusEnabled: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"idle" | "approve" | "reject">("idle");
  const [note, setNote] = useState("");
  const [refund, setRefund] = useState(String(suggestedRefund));
  const [refundMethod, setRefundMethod] =
    useState<"original" | "upi" | "bank" | "replacement">("original");
  const [bookPickup, setBookPickup] = useState(true);

  function decide(approve: boolean) {
    start(async () => {
      try {
        const res = await decideReturn({
          id,
          approve,
          adminNote: note,
          refundAmount: approve ? Number(refund || 0) : null,
          refundMethod: approve ? refundMethod : null,
          bookPickup: approve && bookPickup,
        });
        if (!res.ok) {
          toast.error(res.error || "Could not update");
          return;
        }
        setMode("idle");
        setNote("");
        if (approve) {
          // The approval and the courier booking succeed independently — say so,
          // rather than letting a green toast imply a pickup that isn't booked.
          if (res.pickupBooked) toast.success("Approved · reverse pickup drafted");
          else if (res.pickupIssue)
            toast.warning(`Approved, but pickup not booked: ${res.pickupIssue}`, {
              duration: 8000,
            });
          else toast.success("Approved");
        } else {
          toast.success("Rejected — the customer sees your note");
        }
        router.refresh();
      } catch {
        toast.error("Could not update — are you still signed in?");
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

  const btn =
    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50";

  /* ------------------------------------------------------ pending: decide it */
  if (status === "pending") {
    if (mode === "idle") {
      return (
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
      );
    }

    const approving = mode === "approve";
    return (
      <div className="w-full max-w-md space-y-2 rounded-xl border border-border bg-background p-3">
        <p className="text-xs font-medium">
          {approving ? "Approve this return" : "Reject this return"}
        </p>

        <textarea
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={
            approving
              ? "Note for the customer (optional) — e.g. pickup in 2–3 days"
              : "Why are you rejecting? The customer will see this."
          }
          className="input resize-none text-xs"
        />

        {approving && (
          <>
            <div className="flex gap-2">
              <label className="block flex-1">
                <span className="label text-[11px]">Refund amount</span>
                <input
                  type="number"
                  min={0}
                  value={refund}
                  onChange={(e) => setRefund(e.target.value)}
                  className="input h-9 text-xs"
                />
              </label>
              <label className="block flex-1">
                <span className="label text-[11px]">Method</span>
                <select
                  value={refundMethod}
                  onChange={(e) =>
                    setRefundMethod(e.target.value as typeof refundMethod)
                  }
                  className="input h-9 text-xs"
                >
                  <option value="original">Original payment</option>
                  <option value="upi">UPI</option>
                  <option value="bank">Bank transfer</option>
                  <option value="replacement">Send a replacement</option>
                </select>
              </label>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Line total is {formatINR(suggestedRefund)}. The refund itself is
              recorded here, not moved — pay it out in Razorpay or your bank.
            </p>

            <label className="flex items-start gap-2 text-xs">
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
          </>
        )}

        <div className="flex gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            variant={approving ? "primary" : "outline"}
            disabled={pending || (!approving && !note.trim())}
            onClick={() => decide(approving)}
            className="h-8 flex-1 text-xs"
          >
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : approving ? (
              "Approve return"
            ) : (
              "Reject return"
            )}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setMode("idle")}
            className="h-8 text-xs"
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  /* ------------------------------------------- decided: move it along / retry */
  const next = NEXT_STATUS[status] ?? [];
  return (
    <div className="space-y-2">
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
            className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-danger/40 px-2.5 py-1 font-medium hover:bg-danger/10"
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
