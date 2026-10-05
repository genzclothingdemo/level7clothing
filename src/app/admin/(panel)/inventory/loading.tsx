import { Skeleton } from "@/components/store/skeletons";

/**
 * Shown under the Inventory heading while a view's data is on its way, so a
 * click into the section answers at once instead of appearing to do nothing
 * during the database round trip. Shapes only, built from the storefront's own
 * `Skeleton` so the sheen (and its reduced-motion opt-out) is the house one.
 */
export default function InventoryLoading() {
  return (
    <div className="min-w-0 space-y-4" aria-busy="true" aria-label="Loading inventory">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-16 rounded-2xl" />
      <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-3 p-3">
            <Skeleton className="h-11 w-11 shrink-0" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
