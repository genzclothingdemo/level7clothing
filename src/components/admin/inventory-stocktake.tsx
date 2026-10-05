"use client";

/**
 * Start tracking — the stocktake.
 *
 * This is the step that decides whether the owner ever uses inventory, so it
 * asks for exactly one thing: **a count of each size**. The product's old
 * `stock` is one number for every size together and cannot be split honestly
 * — "60" says nothing about how many are mediums — so it is shown as a
 * reference, never used as a starting point.
 *
 * Nothing is pre-filled. A size left blank would otherwise start at zero and
 * silently stop selling, which is why the engine refuses until every size has
 * a number, and names the ones that do not. Zero is a real count and has to be
 * typed as one.
 *
 * ## Open orders
 *
 * Orders placed but not shipped are units still on the shelf that already
 * belong to someone. `startTracking` reserves them against the count in the
 * same transaction. So the form says, beside each size, how many are promised,
 * and the instruction is to count *everything* in the store — including what
 * is set aside for those orders — or they would be taken off twice.
 *
 * The per-size "promised" figure is a preview read from the open orders; the
 * engine's own result is what is reported once tracking has started, and any
 * size it reports oversold is the first thing the product page shows.
 */

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { startTrackingProduct } from "@/app/actions/inventory";
import { Card } from "@/components/admin/form-kit";
import { Btn } from "@/components/admin/order-ui";
import { Tag, formatBalance, formatUnits } from "@/components/admin/inventory-ui";
import { cn } from "@/lib/utils";

export type StocktakeSize = {
  id: string;
  label: string;
  sku: string;
  /** Units open orders will reserve from this size's count. */
  promised: number;
};

export function InventoryStocktake({
  productId,
  legacyStock,
  sizes,
  openOrders,
  unmatched,
}: {
  productId: string;
  legacyStock: number;
  sizes: StocktakeSize[];
  /** Open orders with at least one line of this product. */
  openOrders: number;
  /** Open-order units that match no size here — they cannot be reserved. */
  unmatched: { label: string; qty: number }[];
}) {
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const tally = useMemo(() => {
    let counted = 0;
    let units = 0;
    for (const s of sizes) {
      const raw = (counts[s.id] ?? "").trim();
      if (!/^\d{1,9}$/.test(raw)) continue;
      counted += 1;
      units += Number(raw);
    }
    return { counted, units };
  }, [sizes, counts]);

  const unmatchedUnits = unmatched.reduce((n, u) => n + u.qty, 0);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    const filled = Object.fromEntries(
      Object.entries(counts).filter(([, v]) => v.trim() !== "")
    );

    start(async () => {
      const res = await startTrackingProduct({ productId, counts: filled });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setError(null);
      // The page re-renders as a tracked product in the same response, so
      // this form is about to unmount — the toast is the receipt, and an
      // oversold size is also drawn in red at the top of what replaces it.
      if (res.oversold.length > 0) {
        toast.error(
          `Tracking started — ${res.oversold.length} size${res.oversold.length === 1 ? " is" : "s are"} oversold: ${res.oversold.join(", ")}.`,
          {
            description: "Open orders need more than you counted. The red panel lists them.",
            duration: 15000,
          }
        );
      } else {
        toast.success(
          `Tracking started — ${formatUnits(res.opening)} counted${
            res.reservedForOpenOrders > 0
              ? `, ${formatUnits(res.reservedForOpenOrders)} reserved for open orders`
              : ""
          }.`
        );
      }
    });
  }

  return (
    <Card
      title="Start tracking"
      tip="Tracking keeps a separate count for every size. Orders reserve units when they are placed and take them off the shelf when they ship; returns and failed deliveries put them back; and checkout stops selling a size that has run out. It starts from a real count because the old stock number is one figure for all sizes together. You can stop tracking later — the history is kept."
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        <div className="space-y-1">
          <p className="text-sm">
            Count every unit of this product in the store — including any set aside for orders that
            have not shipped yet.
          </p>
          <p className="text-xs text-muted-foreground">
            The store&apos;s record says <strong className="font-medium text-foreground">{formatUnits(legacyStock)}</strong>{" "}
            for all sizes together.
            {openOrders > 0 &&
              ` ${openOrders} open order${openOrders === 1 ? "" : "s"} will be reserved from your count.`}
          </p>
        </div>

        <ul className="divide-y divide-border border-y border-border">
          {sizes.map((s) => {
            const raw = counts[s.id] ?? "";
            const n = /^\d{1,9}$/.test(raw.trim()) ? Number(raw.trim()) : null;
            const left = n === null ? null : n - s.promised;
            return (
              <li
                key={s.id}
                className="grid grid-cols-[minmax(0,1fr)_6.5rem] items-center gap-x-3 gap-y-1 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(8rem,14rem)_7rem]"
              >
                <div className="col-start-1 row-start-1 min-w-0">
                  <p className="text-sm font-medium">{s.label}</p>
                  <p className="truncate font-mono text-[11px] text-muted-foreground">{s.sku}</p>
                </div>
                {s.promised > 0 && (
                  <p className="col-span-2 row-start-2 text-xs text-muted-foreground sm:col-span-1 sm:col-start-2 sm:row-start-1">
                    <Tag className="mr-1">{formatUnits(s.promised)} promised</Tag>
                    {left !== null &&
                      (left < 0 ? (
                        <span className="font-medium text-danger">short by {formatUnits(-left)}</span>
                      ) : (
                        <span>{formatBalance(left)} left to sell</span>
                      ))}
                  </p>
                )}
                <input
                  value={raw}
                  onChange={(e) => {
                    setCounts((prev) => ({ ...prev, [s.id]: e.target.value }));
                    setError(null);
                  }}
                  inputMode="numeric"
                  autoComplete="off"
                  aria-label={`Count of ${s.label} (${s.sku})`}
                  placeholder="Count"
                  disabled={pending}
                  className="input col-start-2 row-start-1 h-11 text-right tabular-nums sm:col-start-3 sm:h-10"
                />
              </li>
            );
          })}
        </ul>

        {unmatchedUnits > 0 && (
          <p className="rounded-lg border border-orange-500/30 bg-orange-500/5 px-3 py-2 text-xs text-orange-600 dark:text-orange-400">
            {unmatchedUnits === 1 ? "1 unit" : `${formatUnits(unmatchedUnits)} units`} in open orders (
            {unmatched.map((u) => u.label).join("; ")}){" "}
            {unmatchedUnits === 1 ? "matches no size of this product, so it" : "match no size of this product, so they"}{" "}
            will not be reserved.
          </p>
        )}

        {error && (
          <p role="alert" className="rounded-lg border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <p className="text-xs tabular-nums text-muted-foreground">
            Counted{" "}
            <strong className={cn("font-medium", tally.counted === sizes.length && "text-foreground")}>
              {formatUnits(tally.units)}
            </strong>{" "}
            {tally.counted === sizes.length
              ? `across all ${sizes.length} size${sizes.length === 1 ? "" : "s"}`
              : `in ${tally.counted} of ${sizes.length} sizes`}
          </p>
          <Btn type="submit" tone="solid" disabled={pending} className="w-full sm:w-auto">
            {pending ? "Starting…" : "Start tracking"}
          </Btn>
        </div>
      </form>
    </Card>
  );
}
