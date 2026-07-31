import { Skeleton, ProductGridSkeleton } from "@/components/store/skeletons";

export default function ShopLoading() {
  return (
    <div className="container-px mx-auto max-w-7xl py-12">
      <Skeleton className="h-2.5 w-28" />
      <Skeleton className="mt-2 h-9 w-56" />

      {/* Filter / sort row */}
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Skeleton className="h-10 w-full max-w-xs rounded-lg" />
        <Skeleton className="h-10 w-36 rounded-lg" />
      </div>

      {/* Category chips */}
      <div className="mt-4 flex gap-2 overflow-hidden">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-32 shrink-0 rounded-full" />
        ))}
      </div>

      <div className="mt-8 md:mt-10">
        <ProductGridSkeleton count={8} />
      </div>
    </div>
  );
}
