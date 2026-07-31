import { Skeleton, ProductGridSkeleton } from "@/components/store/skeletons";

/**
 * Shown the moment a product link is clicked. Mirrors the real page's layout
 * (portrait gallery on the left, detail column on the right) so the swap to real
 * content doesn't shift anything.
 */
export default function ProductLoading() {
  return (
    <div className="container-px mx-auto max-w-7xl py-4 md:py-12">
      {/* Breadcrumb */}
      <div className="mb-2 flex items-center gap-2 md:mb-6">
        <Skeleton className="h-3 w-10" />
        <Skeleton className="h-3 w-10" />
        <Skeleton className="h-3 w-40" />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-10 md:grid-cols-2 lg:gap-16">
        {/* Gallery */}
        <div className="min-w-0">
          <Skeleton className="aspect-[4/5] w-full rounded-lg" />
          <div className="mt-3 flex gap-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-[52px] rounded-md md:h-20 md:w-16" />
            ))}
          </div>
        </div>

        {/* Detail column */}
        <div className="md:pt-4">
          <Skeleton className="h-2.5 w-40" />
          <Skeleton className="mt-3 h-8 w-full" />
          <Skeleton className="mt-2 h-8 w-2/3" />

          <div className="mt-5 flex items-center gap-3">
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-5 w-16" />
          </div>
          <Skeleton className="mt-3 h-3 w-20" />

          <div className="mt-6 h-px bg-border" />

          <div className="mt-6 space-y-2">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-4/5" />
          </div>

          {/* Size row */}
          <div className="mt-8">
            <Skeleton className="h-3 w-16" />
            <div className="mt-2 flex flex-wrap gap-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-16 rounded-lg" />
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="mt-6 space-y-3">
            <div className="flex gap-3">
              <Skeleton className="h-12 w-32 rounded-full" />
              <Skeleton className="h-12 flex-1 rounded-lg" />
            </div>
            <Skeleton className="h-[52px] w-full rounded-lg" />
          </div>

          {/* Trust row */}
          <div className="mt-8 grid gap-4 rounded-lg border border-border p-5 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
        </div>
      </div>

      <section className="mt-24">
        <Skeleton className="h-7 w-56" />
        <div className="mt-8">
          <ProductGridSkeleton count={4} />
        </div>
      </section>
    </div>
  );
}
