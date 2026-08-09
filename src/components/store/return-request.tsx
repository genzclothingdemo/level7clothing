"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Loader2, PackageX, Clock } from "lucide-react";
import { formatINR } from "@/lib/utils";
import { requestReturn } from "@/app/actions/returns";
import { useSettings } from "@/context/settings";
import {
  RETURN_REASONS,
  RETURN_STATUS_COLOR,
  RETURN_STATUS_LABEL,
  returnReasonLabel,
  type ReturnStatus,
} from "@/lib/returns";

export type ReturnableLine = {
  index: number;
  name: string;
  quantity: number;
  price: number;
  variantLabel: string | null;
  /** False when the piece is made to order / excluded by the admin. */
  eligible: boolean;
};

export type ExistingRequest = {
  requestNumber: string;
  productName: string;
  status: ReturnStatus;
  reason: string;
  adminNote: string | null;
  createdAt: string;
};

/**
 * The customer's side of returns, on their order page.
 *
 * Shows what has already been requested (with the admin's note — the decision
 * explained, not just a status word), then the form for anything still eligible.
 * Every rule is re-checked server-side; this UI only decides what to offer.
 */
export function ReturnRequest({
  orderNumber,
  lines,
  existing,
  windowOpen,
  daysLeft,
  windowDays,
  closedReason,
}: {
  orderNumber: string;
  lines: ReturnableLine[];
  existing: ExistingRequest[];
  windowOpen: boolean;
  daysLeft: number;
  windowDays: number;
  /** Why the form isn't offered, when it isn't. */
  closedReason: "not_delivered" | "window_closed" | "store_disabled" | null;
}) {
  const { brandName } = useSettings();
  const [openFor, setOpenFor] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [form, setForm] = useState({ reason: "", note: "", quantity: 1 });

  const requestable = lines.filter(
    (l) =>
      l.eligible &&
      !existing.some(
        (e) =>
          e.productName === l.name &&
          !["rejected", "cancelled", "refunded"].includes(e.status)
      )
  );

  async function submit(line: ReturnableLine) {
    setError(null);
    if (!form.reason) {
      setError("Please choose a reason.");
      return;
    }
    setBusy(true);
    const res = await requestReturn({
      orderNumber,
      itemIndex: line.index,
      quantity: form.quantity,
      reason: form.reason,
      customerNote: form.note,
    });
    setBusy(false);
    if (res.ok) {
      setDone(res.message);
      setOpenFor(null);
      setForm({ reason: "", note: "", quantity: 1 });
    } else {
      setError(res.error);
    }
  }

  // Nothing to say at all: no history and no way to start one.
  if (existing.length === 0 && (closedReason === "not_delivered" || closedReason === "store_disabled")) {
    return null;
  }

  return (
    <section className="mt-8 rounded-2xl border border-border p-5">
      <h2 className="flex items-center gap-2 font-serif text-xl">
        <PackageX className="h-5 w-5" /> Returns
      </h2>

      {/* ── Already requested ── */}
      {existing.length > 0 && (
        <ul className="mt-4 space-y-3">
          {existing.map((e) => (
            <li key={e.requestNumber} className="rounded-xl bg-muted/40 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-medium">
                  {e.requestNumber}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${RETURN_STATUS_COLOR[e.status]}`}
                >
                  {RETURN_STATUS_LABEL[e.status]}
                </span>
                <span className="text-xs text-muted-foreground">{e.productName}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {returnReasonLabel(e.reason)}
              </p>
              {e.adminNote && (
                <p className="mt-1.5 rounded-lg bg-background px-3 py-2 text-xs">
                  <b>From {brandName}:</b> {e.adminNote}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {done && (
        <p className="mt-4 flex items-start gap-2 rounded-lg bg-success/10 px-3 py-2 text-sm text-success">
          <Check className="mt-0.5 h-4 w-4 shrink-0" />
          {done}
        </p>
      )}

      {/* ── Start a new request ── */}
      {!windowOpen ? (
        <p className="mt-4 text-sm text-muted-foreground">
          {closedReason === "window_closed"
            ? `The ${windowDays}-day return window for this order has closed. Message us on WhatsApp if something's wrong and we'll still take a look.`
            : closedReason === "store_disabled"
              ? "Returns are paused right now — please message us directly."
              : "You'll be able to raise a return here once the order is delivered."}
        </p>
      ) : requestable.length === 0 ? (
        existing.length > 0 ? null : (
          <p className="mt-4 text-sm text-muted-foreground">
            The pieces in this order are made to order and can&apos;t be returned.
            If something arrived damaged, message us — we&apos;ll sort it out.
          </p>
        )
      ) : (
        <>
          <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            {daysLeft} day{daysLeft === 1 ? "" : "s"} left to raise a return.
          </p>

          <ul className="mt-3 space-y-2">
            {requestable.map((line) => (
              <li key={line.index} className="rounded-xl border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{line.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {line.variantLabel ? `${line.variantLabel} · ` : ""}
                      Qty {line.quantity} · {formatINR(line.price * line.quantity)}
                    </p>
                  </div>
                  {openFor !== line.index && (
                    <button
                      type="button"
                      onClick={() => {
                        setOpenFor(line.index);
                        setForm({ reason: "", note: "", quantity: 1 });
                        setError(null);
                      }}
                      className="shrink-0 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
                    >
                      Request return
                    </button>
                  )}
                </div>

                <AnimatePresence>
                  {openFor === line.index && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-3 space-y-3 border-t border-border pt-3">
                        <label className="block">
                          <span className="label">What went wrong? *</span>
                          <select
                            value={form.reason}
                            onChange={(e) =>
                              setForm((p) => ({ ...p, reason: e.target.value }))
                            }
                            className="input h-10"
                          >
                            <option value="">Choose a reason…</option>
                            {RETURN_REASONS.map((r) => (
                              <option key={r.value} value={r.value}>
                                {r.label}
                              </option>
                            ))}
                          </select>
                        </label>

                        {line.quantity > 1 && (
                          <label className="block max-w-[8rem]">
                            <span className="label">How many?</span>
                            <input
                              type="number"
                              min={1}
                              max={line.quantity}
                              value={form.quantity}
                              onChange={(e) =>
                                setForm((p) => ({
                                  ...p,
                                  quantity: Number(e.target.value) || 1,
                                }))
                              }
                              className="input h-10"
                            />
                          </label>
                        )}

                        <label className="block">
                          <span className="label">Anything else we should know?</span>
                          <textarea
                            rows={3}
                            value={form.note}
                            onChange={(e) =>
                              setForm((p) => ({ ...p, note: e.target.value }))
                            }
                            className="input resize-none"
                            placeholder="Tell us what happened — it helps us decide faster."
                          />
                        </label>

                        {error && <p className="text-sm text-danger">{error}</p>}

                        <p className="text-xs text-muted-foreground">
                          We&apos;ll review this within 24 hours. If it&apos;s
                          approved we arrange a pickup from your address — please
                          keep the original packaging.
                        </p>

                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => submit(line)}
                            className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
                          >
                            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                            Submit request
                          </button>
                          <button
                            type="button"
                            onClick={() => setOpenFor(null)}
                            className="rounded-full border border-border px-4 py-2.5 text-sm hover:bg-muted"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
