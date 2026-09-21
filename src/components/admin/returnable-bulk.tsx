"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { bulkSetReturnable } from "@/app/actions/returns";
import { InfoTip } from "@/components/store/info-tip";

type Breakdown = { inherit: number; yes: number; no: number; total: number };
type Mode = "yes" | "no" | "inherit";

const OPTIONS: { mode: Mode; label: string; detail: string }[] = [
  {
    mode: "inherit",
    label: "Follow the store default",
    detail:
      "Clears the per-product setting so every piece follows the store default above. This is the one to pick if you want to control returns from one switch from now on.",
  },
  {
    mode: "yes",
    label: "Returnable",
    detail:
      "Marks every product returnable explicitly. They will stay returnable even if you later turn the store default off.",
  },
  {
    mode: "no",
    label: "Not returnable",
    detail:
      "Marks every product non-returnable explicitly — for a final-sale drop, say. They stay that way even if you later turn the store default on.",
  },
];

/**
 * Bulk override for `Product.returnable` across the catalogue.
 *
 * The per-product toggle in the product editor is the normal way to set this.
 * This is for the cases where doing it one at a time isn't practical, and for
 * undoing a mess.
 *
 * Why the three-way split is shown rather than a simple on/off: a product can
 * say yes, say no, or say nothing and inherit the store default. "Everything
 * returnable" and "everything inherits" look identical until the store default
 * is later flipped — at which point the first silently ignores it. The counts
 * make that difference visible before the write, and the confirm step makes it
 * deliberate.
 */
export function ReturnableBulk({ breakdown }: { breakdown: Breakdown }) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<Mode | null>(null);
  const [counts, setCounts] = useState(breakdown);

  const apply = (mode: Mode) => {
    startTransition(async () => {
      const res = await bulkSetReturnable(mode);
      setConfirming(null);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(`Updated ${res.updated} product${res.updated === 1 ? "" : "s"}`);
      // Reflect the new state without a round trip; the server has already
      // revalidated the pages that render it.
      setCounts(
        mode === "inherit"
          ? { ...counts, inherit: counts.total, yes: 0, no: 0 }
          : mode === "yes"
            ? { ...counts, inherit: 0, yes: counts.total, no: 0 }
            : { ...counts, inherit: 0, yes: 0, no: counts.total }
      );
    });
  };

  return (
    <section className="rounded-lg border border-border p-4 sm:p-5">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        Apply to every product
        <InfoTip term="Bulk returnable override">
          Sets the Returns switch on all {counts.total} products at once. Each
          product can still be changed individually afterwards in its editor.
        </InfoTip>
      </h3>

      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        Right now:{" "}
        <span className="text-foreground">{counts.inherit} follow the store default</span>,{" "}
        <span className="text-foreground">{counts.yes} set returnable</span>,{" "}
        <span className="text-foreground">{counts.no} set non-returnable</span>.
      </p>

      <div className="mt-4 flex flex-col gap-2">
        {OPTIONS.map(({ mode, label, detail }) => (
          <div key={mode} className="rounded-lg border border-border/70 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-sm font-medium">
                {label}
                <InfoTip term={label}>{detail}</InfoTip>
              </p>

              {confirming === mode ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => apply(mode)}
                    disabled={pending}
                    className="min-h-11 rounded-lg bg-danger px-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-white transition-colors hover:opacity-90 disabled:opacity-60 sm:min-h-9"
                  >
                    {pending ? "Applying…" : `Yes, all ${counts.total}`}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirming(null)}
                    disabled={pending}
                    className="min-h-11 rounded-lg border border-border px-4 text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors hover:bg-muted disabled:opacity-60 sm:min-h-9"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirming(mode)}
                  disabled={pending}
                  className="min-h-11 rounded-lg border border-border px-4 text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors hover:border-accent hover:text-accent disabled:opacity-60 sm:min-h-9"
                >
                  Apply
                </button>
              )}
            </div>

            {confirming === mode && (
              <p className="mt-2 text-xs leading-relaxed text-danger">
                This rewrites the Returns setting on all {counts.total} products
                and cannot be undone in one step.
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
