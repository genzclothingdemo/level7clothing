"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Loader2, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { InfoTip } from "@/components/store/info-tip";
import { ExpandableText } from "@/components/store/expandable-text";
import { Check } from "@/components/admin/form-kit";
import { Badge, Btn } from "@/components/admin/order-ui";
import {
  BULK_ACTION_META,
  BULK_ORDER_ACTIONS,
  type BulkOrderAction,
  type BulkRunResult,
} from "@/components/admin/order-types";
import { bulkOrderAction } from "@/app/actions/admin";

/**
 * Select rows, then act on the selection.
 *
 * Two things this is careful about, because both are how bulk tools lose an
 * operator's trust:
 *
 * 1. **Select-all agrees with the filters.** The tick box selects the rows the
 *    current filters are showing on this page — never the whole table. The
 *    readout says so, and the (i) spells out how many orders the filters match
 *    in total, so "select all" can never quietly mean more than it appears to.
 * 2. **Every row reports back.** A run renders one line per order, success and
 *    failure alike. A bulk action that fails three rows silently is worse than
 *    no bulk action, because the operator stops checking.
 */
export function OrderBulkBar({
  visibleIds,
  selectedIds,
  totalMatching,
  onToggleAll,
  onClear,
  onDone,
}: {
  /** The order ids rendered on this page, in display order. */
  visibleIds: string[];
  selectedIds: string[];
  /** Orders matching the active filters across every page. */
  totalMatching: number;
  onToggleAll: (next: boolean) => void;
  onClear: () => void;
  /** Called after a run so the parent can drop the now-stale selection. */
  onDone: () => void;
}) {
  const router = useRouter();
  const [running, start] = useTransition();
  const [busyAction, setBusyAction] = useState<BulkOrderAction | null>(null);
  const [report, setReport] = useState<BulkRunResult | null>(null);

  const shown = visibleIds.length;
  const selected = selectedIds.length;
  const allShownSelected = shown > 0 && selected === shown;
  const morePages = totalMatching > shown;

  function run(action: BulkOrderAction) {
    const meta = BULK_ACTION_META[action];
    if (selected === 0) return;
    if (meta.confirm && !confirm(`${meta.confirm}\n\n${selected} order(s) selected.`)) {
      return;
    }

    setBusyAction(action);
    start(async () => {
      try {
        const res = await bulkOrderAction(selectedIds, action);
        if (!res.ok) {
          toast.error(res.error || "Could not run that on the selection");
          return;
        }

        setReport({
          action: res.action,
          results: res.results,
          succeeded: res.succeeded,
          failed: res.failed,
        });

        if (res.failed === 0) {
          toast.success(`${meta.label}: ${res.succeeded} order(s) done`);
        } else {
          toast.warning(
            `${meta.label}: ${res.succeeded} done, ${res.failed} failed — see the results below`,
            { duration: 10000 }
          );
        }

        onDone();
        router.refresh();
      } finally {
        setBusyAction(null);
      }
    });
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1.5 py-1">
        <Check
          checked={allShownSelected}
          indeterminate={selected > 0}
          onChange={onToggleAll}
          label={allShownSelected ? "Clear selection" : "Select every order on this page"}
          disabled={shown === 0}
        />

        <span className="flex min-w-0 items-center text-[11px] text-muted-foreground tabular-nums">
          <span className={cn(selected > 0 && "font-medium text-foreground")}>
            {selected} of {shown} selected
          </span>
          <InfoTip term="What “select all” covers">
            The tick box selects the {shown} order{shown === 1 ? "" : "s"} on
            this page — the ones the filters above are showing.
            {morePages
              ? ` Your filters match ${totalMatching} orders in all, so the rest are on other pages; page through and tick again, or narrow the filters first.`
              : " That is every order your filters match."}
          </InfoTip>
        </span>

        {selected > 0 && (
          <>
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              {BULK_ORDER_ACTIONS.map((action) => {
                const meta = BULK_ACTION_META[action];
                const busy = busyAction === action;
                return (
                  <Btn
                    key={action}
                    tone={meta.tone === "solid" ? "outline" : meta.tone}
                    onClick={() => run(action)}
                    disabled={running}
                    className="min-h-11 sm:min-h-8"
                    title={meta.confirm ?? `${meta.label} the ${selected} selected order(s)`}
                  >
                    {busy && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
                    {busy ? meta.verb : meta.label}
                  </Btn>
                );
              })}
            </div>

            <Btn
              tone="ghost"
              onClick={onClear}
              disabled={running}
              className="min-h-11 px-2 sm:min-h-8"
              title="Clear the selection"
            >
              <X className="h-3.5 w-3.5" aria-hidden /> Clear
            </Btn>
          </>
        )}
      </div>

      {/* ---- Per-row report ---- */}
      {report && (
        <div className="border-t border-border p-2.5">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {BULK_ACTION_META[report.action].label} results
            </span>
            <Badge tone="success">{report.succeeded} done</Badge>
            {report.failed > 0 && <Badge tone="danger">{report.failed} failed</Badge>}
            <button
              type="button"
              onClick={() => setReport(null)}
              className="ml-auto inline-flex min-h-11 cursor-pointer items-center text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground sm:min-h-0"
            >
              Dismiss
            </button>
          </div>

          <ExpandableText lines={10} moreLabel="Show all rows" lessLabel="Show fewer">
            <ol className="space-y-1">
              {/* Failures first: they are the only rows that need doing again. */}
              {[...report.results]
                .sort((a, b) => Number(a.ok) - Number(b.ok))
                .map((r) => (
                  <li key={r.id} className="flex gap-1.5 text-xs">
                    {r.ok ? (
                      <CheckCircle2
                        className="mt-0.5 h-3 w-3 shrink-0 text-success"
                        aria-hidden
                      />
                    ) : (
                      <XCircle className="mt-0.5 h-3 w-3 shrink-0 text-danger" aria-hidden />
                    )}
                    <span className="min-w-0">
                      <span className="font-mono text-[11px]">{r.orderNumber}</span>{" "}
                      <span className={r.ok ? "text-muted-foreground" : "text-danger"}>
                        {/* The word, not just the colour — see StatusPill. */}
                        {r.ok ? "" : "failed — "}
                        {r.message}
                      </span>
                    </span>
                  </li>
                ))}
            </ol>
          </ExpandableText>
        </div>
      )}
    </div>
  );
}
