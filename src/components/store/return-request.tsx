"use client";

import { useEffect, useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Loader2, PackageX, Clock, Info } from "lucide-react";
import { formatINR } from "@/lib/utils";
import {
  getReturnPolicySnapshot,
  requestReturn,
  type ReturnPolicySnapshot,
} from "@/app/actions/returns";
import { useSettings } from "@/context/settings";
import { InfoTip } from "@/components/store/info-tip";
import { ExpandableText } from "@/components/store/expandable-text";
import {
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
 * explained, not just a status word), then the form for anything still
 * eligible.
 *
 * **Where the rules come from.** The reason list, the policy text, the window
 * and every per-line verdict are read from the server by
 * `getReturnPolicySnapshot`, not from constants and not from these props. The
 * props are kept as the first-paint fallback (the page has already computed
 * them), but the snapshot wins the moment it lands, because it is produced by
 * the same `evaluateReturnEligibility` call that `requestReturn` enforces. A
 * form that offers what the action would refuse is worse than no form.
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
  /** First-paint hints from the order page; superseded by the snapshot. */
  windowOpen?: boolean;
  daysLeft?: number;
  windowDays?: number;
  /** Why the form isn't offered, when it isn't. */
  closedReason?: "not_delivered" | "window_closed" | "store_disabled" | null;
}) {
  const { brandName } = useSettings();
  const [policy, setPolicy] = useState<ReturnPolicySnapshot | null>(null);
  const [loadingPolicy, startLoad] = useTransition();
  const [openFor, setOpenFor] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [form, setForm] = useState({ reason: "", note: "", quantity: 1 });

  // Read the live policy once per order. Wrapped in a transition, which is how
  // Next documents calling a Server Action from an effect.
  useEffect(() => {
    let alive = true;
    startLoad(async () => {
      try {
        const snap = await getReturnPolicySnapshot(orderNumber);
        if (alive && snap.ok) setPolicy(snap);
      } catch {
        // Keep the props-based view; submitting is blocked until it loads.
      }
    });
    return () => {
      alive = false;
    };
  }, [orderNumber]);

  const reasons = policy?.reasons ?? [];
  const effWindowDays = policy?.windowDays ?? windowDays ?? 0;
  const effDaysLeft = policy?.daysLeft ?? daysLeft ?? 0;
  // The snapshot is authoritative; the props only cover the first paint.
  const storeCode = policy ? policy.code : null;
  const open = policy ? policy.code === "ok" : !!windowOpen;

  function verdictFor(index: number) {
    return policy?.lines.find((l) => l.index === index) ?? null;
  }

  /** Lines that can still be requested — nothing already in flight for them. */
  const inFlight = (name: string) =>
    existing.some(
      (e) =>
        e.productName === name &&
        !["rejected", "cancelled", "refunded"].includes(e.status)
    );

  const offered = lines.filter((l) => !inFlight(l.name));
  const requestable = offered.filter((l) =>
    policy ? (verdictFor(l.index)?.allowed ?? false) : l.eligible
  );
  const blocked = offered.filter((l) => !requestable.includes(l));

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
      // The server just re-decided eligibility — pick up its verdict so the UI
      // stops offering a form that has already been refused once.
      startLoad(async () => {
        const snap = await getReturnPolicySnapshot(orderNumber);
        if (snap.ok) setPolicy(snap);
      });
    }
  }

  // Nothing has happened and nothing can: stay out of the way entirely.
  const quiet = storeCode ?? closedReason;
  if (
    existing.length === 0 &&
    (quiet === "not_delivered" || quiet === "store_disabled")
  ) {
    return null;
  }

  const closedMessage =
    policy?.code && policy.code !== "ok"
      ? policy.message
      : closedReason === "window_closed"
        ? `The ${effWindowDays}-day return window for this order has closed.`
        : closedReason === "store_disabled"
          ? "Returns are paused right now — please message us directly."
          : "You can raise a return once this order has been delivered.";

  return (
    <section className="mt-6 rounded-2xl border border-border p-4 sm:p-5">
      <h2 className="flex items-center gap-2 font-serif text-xl">
        <PackageX className="h-5 w-5" /> Returns
      </h2>

      {/* ── Already requested ── */}
      {existing.length > 0 && (
        <ul className="mt-3 space-y-2">
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
                <span className="min-w-0 break-words text-xs text-muted-foreground">
                  {e.productName}
                </span>
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
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-success/10 px-3 py-2 text-sm text-success">
          <Check className="mt-0.5 h-4 w-4 shrink-0" />
          {done}
        </p>
      )}

      {/* ── Start a new request ── */}
      {!open ? (
        // Explained, never silently hidden: a shopper who thinks the button is
        // missing writes in; one who reads the closing date does not.
        <p className="mt-3 text-sm text-muted-foreground">
          {closedMessage}{" "}
          {(policy?.code ?? closedReason) === "window_closed" &&
            "Message us on WhatsApp if something's wrong and we'll still take a look."}
        </p>
      ) : (
        <>
          {policy?.policyNote && (
            <ExpandableText
              lines={3}
              className="mt-3 rounded-lg bg-muted/40 p-3"
              contentClassName="whitespace-pre-line text-xs leading-relaxed text-muted-foreground"
            >
              {policy.policyNote}
            </ExpandableText>
          )}

          <p className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5 shrink-0" />
            <span>
              {effDaysLeft} day{effDaysLeft === 1 ? "" : "s"} left to raise a
              return
              {policy?.closesOn ? ` — until ${policy.closesOn}` : ""}.
            </span>
            <InfoTip term="Return window">
              {effWindowDays} days from the day the courier marks your order
              delivered, not the day you ordered. After that the request is
              refused automatically.
            </InfoTip>
          </p>

          {requestable.length === 0 ? (
            blocked.length === 0 && existing.length > 0 ? null : (
              <p className="mt-3 text-sm text-muted-foreground">
                {blocked[0] && verdictFor(blocked[0].index)?.message
                  ? verdictFor(blocked[0].index)?.message
                  : "The pieces in this order can't be returned. If something arrived damaged, message us — we'll sort it out."}
              </p>
            )
          ) : (
            <ul className="mt-3 space-y-2">
              {requestable.map((line) => (
                <li key={line.index} className="rounded-xl border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0 flex-1 basis-40">
                      <p className="break-words text-sm font-medium">{line.name}</p>
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
                        className="inline-flex min-h-11 shrink-0 cursor-pointer items-center rounded-lg border border-border px-3 text-xs font-medium uppercase tracking-wide transition-colors hover:bg-muted"
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
                              disabled={reasons.length === 0}
                              onChange={(e) =>
                                setForm((p) => ({ ...p, reason: e.target.value }))
                              }
                              className="input"
                            >
                              <option value="">
                                {reasons.length === 0
                                  ? loadingPolicy
                                    ? "Loading reasons…"
                                    : "Reasons unavailable — please refresh"
                                  : "Choose a reason…"}
                              </option>
                              {reasons.map((r) => (
                                <option key={r} value={r}>
                                  {r}
                                </option>
                              ))}
                            </select>
                          </label>

                          {line.quantity > 1 && (
                            <label className="block max-w-32">
                              <span className="label">How many?</span>
                              <input
                                type="number"
                                inputMode="numeric"
                                min={1}
                                max={line.quantity}
                                value={form.quantity}
                                onChange={(e) =>
                                  setForm((p) => ({
                                    ...p,
                                    quantity: Number(e.target.value) || 1,
                                  }))
                                }
                                className="input"
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

                          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            Reviewed within 24 hours. If approved we arrange a
                            pickup — keep the original packaging.
                          </p>

                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={busy || reasons.length === 0}
                              onClick={() => submit(line)}
                              className="inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold uppercase tracking-wide text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                              Submit request
                            </button>
                            <button
                              type="button"
                              onClick={() => setOpenFor(null)}
                              className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-border px-4 text-sm uppercase tracking-wide transition-colors hover:bg-muted"
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
          )}

          {/* Excluded lines are named, not dropped — "why isn't my hoodie
              listed?" is the support message this prevents. */}
          {blocked.length > 0 && requestable.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {blocked.map((line) => (
                <li
                  key={line.index}
                  className="rounded-xl border border-dashed border-border px-3 py-2 text-xs text-muted-foreground"
                >
                  <b className="font-medium text-foreground">{line.name}</b>
                  {" — "}
                  {verdictFor(line.index)?.message ?? "Not eligible for return."}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
