import { Skeleton, ProductGridSkeleton } from "@/components/store/skeletons";

/**
 * Group-level fallback for the storefront (home and any route without its own
 * loading file). Approximates the hero split so the shell feels stable.
 */
export default function StoreLoading() {
  return (
    <div>
      <section className="border-b border-border">
        <div className="container-px mx-auto grid max-w-7xl items-center gap-12 py-14 md:grid-cols-[0.9fr_1.1fr] md:gap-16 md:py-24">
          <div>
            <Skeleton className="h-2.5 w-48" />
            <Skeleton className="mt-5 h-12 w-full" />
            <Skeleton className="mt-3 h-12 w-3/4" />
            <div className="mt-6 space-y-2">
              <Skeleton className="h-3.5 w-full max-w-md" />
              <Skeleton className="h-3.5 w-4/5 max-w-md" />
            </div>
            <div className="mt-9 flex gap-3">
              <Skeleton className="h-[52px] w-52 rounded-lg" />
              <Skeleton className="h-[52px] w-32 rounded-lg" />
            </div>
            <div className="mt-12 grid max-w-md grid-cols-3 gap-6 border-t border-border pt-7">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i}>
                  <Skeleton className="h-6 w-14" />
                  <Skeleton className="mt-2 h-2.5 w-20" />
                </div>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 md:gap-4">
            <Skeleton className="mt-8 aspect-[4/5] rounded-lg md:mt-12" />
            <Skeleton className="aspect-[4/5] rounded-lg" />
          </div>
        </div>
      </section>

      <section className="container-px mx-auto max-w-7xl py-16">
        <Skeleton className="h-2.5 w-24" />
        <Skeleton className="mt-2 h-8 w-48" />
        <div className="mt-8">
          <ProductGridSkeleton count={4} />
        </div>
      </section>
    </div>
  );
}
