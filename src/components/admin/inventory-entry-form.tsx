"use client";

/**
 * Record an entry — the four kinds the owner named: stock in, damaged
 * (dead stock), personal use, and a recount.
 *
 * ## One form, a line per size
 *
 * Stock arrives as a delivery of several sizes and a stocktake counts every
 * size, so the form is a sheet: pick the kind once, type a number against each
 * size that moved, give one reason, save. Sizes left blank are not touched.
 *
 * For a **recount** the number typed is *what you counted*, not a difference:
 * someone standing at a shelf knows what they are holding, not a signed delta
 * against a figure on a screen. The engine works the difference out.
 *
 * ## The server decides, this form reports
 *
 * Nothing here refuses anything. No "more than on the shelf" check, no
 * required-reason check, no number parsing beyond drawing a preview: the
 * engine (`lib/inventory.ts`) is the one place those rules live, and its
 * sentence is printed exactly as it comes back. A rule copied into the form
 * would be a rule that one day disagrees with the server. The reason field is
 * *marked* required from the same `MOVEMENT_META.requiresNote` the engine
 * reads, so the marker and the rule cannot drift either.
 *
 * Each size is its own ledger entry, so a refusal is per size: the sizes that
 * saved are cleared (a second press cannot record them twice), the refused
 * ones keep their number and show why.
 */

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { recordStockEntry } from "@/app/actions/inventory";
import {
  MANUAL_MOVEMENT_TYPES,
  MOVEMENT_META,
  type ManualMovementType,
} from "@/lib/inventory-types";
import { Card, Field, Segmented } from "@/components/admin/form-kit";
import { Btn } from "@/components/admin/order-ui";
import { Tag, formatBalance, formatSigned, formatUnits } from "@/components/admin/inventory-ui";
import { cn } from "@/lib/utils";

export type EntrySize = {
  id: string;
  label: string;
  sku: string;
  onHand: number;
  reserved: number;
  retired: boolean;
};

/** What the number typed against a size means, for each kind. */
const COLUMN: Record<ManualMovementType, string> = {
  RECEIPT: "How many arrived",
  DAMAGE: "How many damaged",
  PERSONAL_USE: "How many taken",
  ADJUSTMENT: "What you counted",
};

const SUBMIT: Record<ManualMovementType, string> = {
  RECEIPT: "Record stock in",
  DAMAGE: "Write off as damaged",
  PERSONAL_USE: "Record personal use",
  ADJUSTMENT: "Save the recount",
};

const PLACEHOLDER: Record<ManualMovementType, string> = {
  RECEIPT: "Supplier or invoice number",
  DAMAGE: "What happened — e.g. print cracked in the wash",
  PERSONAL_USE: "What for — e.g. photoshoot, gift for a creator",
  ADJUSTMENT: "Why — e.g. monthly stocktake",
};

type RowState = { saved: string } | { error: string };

/**
 * The shelf after this line, for the preview only. Uses the kind's
 * `direction` from `MOVEMENT_META`, the same field the engine signs by.
 */
function previewOf(type: ManualMovementType, onHand: number, raw: string) {
  const s = raw.trim();
  if (!/^\d{1,9}$/.test(s)) return null;
  const n = Number(s);
  if (type === "ADJUSTMENT") return { after: n, delta: n - onHand };
  const delta = MOVEMENT_META[type].direction === "in" ? n : -n;
  return { after: onHand + delta, delta };
}

export function InventoryEntryForm({
  productId,
  sizes,
  initialType = "RECEIPT",
}: {
  productId: string;
  sizes: EntrySize[];
  initialType?: ManualMovementType;
}) {
  const [type, setType] = useState<ManualMovementType>(initialType);
  const [values, setValues] = useState<Record<string, string>>({});
  const [unitCost, setUnitCost] = useState("");
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const meta = MOVEMENT_META[type];

  /** Switching kind clears the sheet: "10" typed as arrived must not become "10" counted. */
  function changeType(next: ManualMovementType) {
    if (next === type) return;
    setType(next);
    setValues({});
    setRows({});
    setFormError(null);
  }

  function changeValue(id: string, v: string) {
    setValues((prev) => ({ ...prev, [id]: v }));
    setFormError(null);
    setRows((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  /** The line under the button — what pressing it will send. Display only. */
  const summary = useMemo(() => {
    let lines = 0;
    let units = 0;
    for (const s of sizes) {
      const p = previewOf(type, s.onHand, values[s.id] ?? "");
      if (!p) continue;
      lines += 1;
      units += p.delta;
    }
    return { lines, units };
  }, [sizes, type, values]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;

    const lines = sizes
      .map((s) => ({ variantId: s.id, value: values[s.id] ?? "" }))
      .filter((l) => l.value.trim() !== "");

    start(async () => {
      const res = await recordStockEntry({ productId, type, lines, unitCost, note });
      if (!res.ok) {
        setFormError(res.error);
        return;
      }

      const saved = res.results.filter((r) => r.ok);
      const refused = res.results.filter((r) => !r.ok);

      // One reason refused every size ("Say why — …"): say it once, by the
      // button, rather than the same sentence under five rows.
      const oneReason =
        saved.length === 0 && new Set(refused.map((r) => (r.ok ? "" : r.error))).size === 1;
      if (oneReason && !refused[0].ok) {
        setFormError(refused[0].error);
        setRows({});
        return;
      }

      const nextRows: Record<string, RowState> = {};
      const nextValues = { ...values };
      for (const r of res.results) {
        if (r.ok) {
          nextRows[r.variantId] = {
            saved: `${formatSigned(r.delta)} → ${formatUnits(r.onHand)} on hand`,
          };
          delete nextValues[r.variantId];
        } else {
          nextRows[r.variantId] = { error: r.error };
        }
      }
      setRows(nextRows);
      setValues(nextValues);
      setFormError(null);

      if (refused.length === 0) {
        setNote("");
        setUnitCost("");
        toast.success(
          `${meta.label} saved for ${saved.length} size${saved.length === 1 ? "" : "s"}.`
        );
      } else if (saved.length > 0) {
        toast.warning(
          `${saved.length} saved, ${refused.length} refused — the refused sizes say why.`,
          { duration: 8000 }
        );
      }
    });
  }

  return (
    <Card
      title="Record an entry"
      tip="Stock in when a delivery arrives. Damaged for dead stock you are writing off, and personal use for anything taken for the store's own use — both need a reason. Recount when a physical count disagrees with the record: type what you counted and the difference is worked out for you. Each size becomes one line in the ledger, with your name on it."
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        <Segmented<ManualMovementType>
          value={type}
          onChange={changeType}
          ariaLabel="Kind of entry"
          className="grid grid-cols-2 sm:flex"
          options={MANUAL_MOVEMENT_TYPES.map((t) => ({ value: t, label: MOVEMENT_META[t].label }))}
        />

        {/* ---- A line per size ---- */}
        <div className="min-w-0">
          <div className="hidden grid-cols-[minmax(0,1fr)_5rem_8rem_minmax(9rem,12rem)] gap-x-3 border-b border-border pb-2 text-[10px] uppercase tracking-wider text-muted-foreground sm:grid">
            <span>Size</span>
            <span className="text-right">On hand</span>
            <span className="text-right">{COLUMN[type]}</span>
            <span>After</span>
          </div>
          <ul className="divide-y divide-border">
            {sizes.map((s) => {
              const raw = values[s.id] ?? "";
              const p = previewOf(type, s.onHand, raw);
              const state = rows[s.id];
              const uncovered = p ? Math.max(0, s.reserved - p.after) : 0;
              return (
                <li
                  key={s.id}
                  className="grid grid-cols-[minmax(0,1fr)_6.5rem] items-center gap-x-3 gap-y-1 py-2 sm:grid-cols-[minmax(0,1fr)_5rem_8rem_minmax(9rem,12rem)]"
                >
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-1.5 text-sm">
                      <span className="font-medium">{s.label}</span>
                      {s.retired && <Tag>Retired</Tag>}
                    </p>
                    <p className="truncate font-mono text-[11px] text-muted-foreground">
                      {s.sku}
                      <span className="font-sans sm:hidden"> · {formatUnits(s.onHand)} on hand</span>
                    </p>
                  </div>
                  <p className="hidden text-right text-sm tabular-nums sm:block">{formatUnits(s.onHand)}</p>
                  <input
                    value={raw}
                    onChange={(e) => changeValue(s.id, e.target.value)}
                    inputMode="numeric"
                    autoComplete="off"
                    aria-label={`${COLUMN[type]} — ${s.label} (${s.sku})`}
                    placeholder={type === "ADJUSTMENT" ? formatUnits(s.onHand) : "0"}
                    disabled={pending}
                    className={cn(
                      "input h-11 text-right tabular-nums sm:h-10",
                      state && "error" in state && "border-danger"
                    )}
                  />
                  <div className="col-span-2 min-h-5 text-xs sm:col-span-1">
                    {state && "saved" in state ? (
                      <span className="inline-flex items-center gap-1 text-success">
                        <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        Saved {state.saved}
                      </span>
                    ) : state && "error" in state ? (
                      <span role="alert" className="text-danger">
                        {state.error}
                      </span>
                    ) : p ? (
                      <span className="tabular-nums text-muted-foreground">
                        {formatUnits(s.onHand)} →{" "}
                        <span className={cn("font-medium", p.after < 0 ? "text-danger" : "text-foreground")}>
                          {formatBalance(p.after)}
                        </span>{" "}
                        ({formatSigned(p.delta)})
                        {uncovered > 0 && p.after >= 0 && (
                          <span className="block text-orange-600 dark:text-orange-400">
                            {formatUnits(uncovered)} promised to open orders would be left uncovered
                          </span>
                        )}
                      </span>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        {/* ---- The one reason, and the price paid ---- */}
        <div className={cn("grid gap-3", type === "RECEIPT" && "sm:grid-cols-[10rem_minmax(0,1fr)]")}>
          {type === "RECEIPT" && (
            <Field
              label="Unit cost (₹)"
              tip="What one unit of this delivery cost you, in whole rupees. Optional. It is kept on the entry as a record of what was paid. The stock's value uses the cost price set in the product editor."
            >
              {(id) => (
                <input
                  id={id}
                  value={unitCost}
                  onChange={(e) => {
                    setUnitCost(e.target.value);
                    setFormError(null);
                  }}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="Optional"
                  disabled={pending}
                  className="input h-11 tabular-nums sm:h-10"
                />
              )}
            </Field>
          )}
          <Field label={meta.requiresNote ? "Reason" : "Note"} required={meta.requiresNote}>
            {(id) => (
              <input
                id={id}
                value={note}
                onChange={(e) => {
                  setNote(e.target.value);
                  setFormError(null);
                }}
                autoComplete="off"
                placeholder={meta.requiresNote ? PLACEHOLDER[type] : `${PLACEHOLDER[type]} (optional)`}
                disabled={pending}
                className="input h-11 sm:h-10"
              />
            )}
          </Field>
        </div>

        {formError && (
          <p role="alert" className="rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">
            {formError}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <p className="text-xs tabular-nums text-muted-foreground">
            {summary.lines === 0
              ? type === "ADJUSTMENT"
                ? "Type what you counted against each size you checked."
                : "Type a number against each size that moved."
              : type === "ADJUSTMENT"
                ? `${summary.lines} size${summary.lines === 1 ? "" : "s"} recounted · ${formatSigned(summary.units)} overall`
                : `${summary.lines} size${summary.lines === 1 ? "" : "s"} · ${formatSigned(summary.units)} units`}
          </p>
          <Btn type="submit" tone="solid" disabled={pending} className="w-full sm:w-auto">
            {pending ? "Saving…" : SUBMIT[type]}
          </Btn>
        </div>
      </form>
    </Card>
  );
}
