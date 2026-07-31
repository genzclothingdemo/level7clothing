import { cn } from "@/lib/utils";

/** Single placeholder block. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} />;
}

/**
 * Mirrors ProductCard's real geometry — portrait 4:5 tile, category line, name,
 * price, action button. Matching the layout is the point: the page shouldn't
 * jump when real content replaces this.
 */
export function ProductCardSkeleton() {
  return (
    <div className="flex flex-col">
      <Skeleton className="aspect-[4/5] w-full rounded-lg" />
      <div className="mt-2.5 sm:mt-4">
        <Skeleton className="h-2.5 w-1/2" />
        <Skeleton className="mt-2 h-4 w-4/5" />
        <Skeleton className="mt-2 h-4 w-1/3" />
        <Skeleton className="mt-3 h-9 w-full rounded-lg" />
      </div>
    </div>
  );
}

export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-7 sm:gap-x-5 sm:gap-y-10 md:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <ProductCardSkeleton key={i} />
      ))}
    </div>
  );
}
