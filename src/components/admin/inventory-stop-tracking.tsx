"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { stopTrackingProduct } from "@/app/actions/inventory";
import { Btn } from "@/components/admin/order-ui";
import { formatUnits } from "@/components/admin/inventory-ui";

/**
 * Stop tracking a product.
 *
 * Deliberately a third-impression control — behind a fold at the foot of the
 * product's page, and behind a confirmation that says exactly what changes:
 * the product goes back to one stock number for all sizes, checkout stops
 * enforcing per-size limits, and the ledger stays. Starting again later is a
 * fresh count (the engine's rule), so the confirmation says that too.
 */
export function InventoryStopTracking({
  productId,
  productName,
  sellsAs,
}: {
  productId: string;
  productName: string;
  /** The number it will sell from afterwards — its current mirror. */
  sellsAs: number;
}) {
  const [pending, start] = useTransition();

  function stop() {
    const sure = window.confirm(
      `Stop tracking “${productName}”?\n\n` +
        `It goes back to selling from one number for all sizes — ${formatUnits(sellsAs)}, what its sizes can sell today — ` +
        "and checkout stops checking each size.\n\n" +
        "The ledger is kept. Tracking it again later starts from a fresh count."
    );
    if (!sure) return;
    start(async () => {
      const res = await stopTrackingProduct(productId);
      if (res.ok) toast.success("Tracking stopped. The history is kept.");
      else toast.error(res.error, { duration: 8000 });
    });
  }

  return (
    <Btn tone="danger" onClick={stop} disabled={pending}>
      {pending ? "Stopping…" : "Stop tracking"}
    </Btn>
  );
}
